-- ============================================================================
-- LUMINOVA | Migração 2 (idempotente e NÃO destrutiva)
-- Execute no Supabase > SQL Editor DEPOIS de "Banco de dados.sql" e de
-- "Migracao-completa-LUMINOVA.sql". Pode ser executada mais de uma vez.
-- Nada é apagado: perfis, publicações, comentários, comunidades e membros ficam.
--
-- O que esta migração corrige / cria:
--  1. Chats privados: colunas faltantes, RLS corrigida (havia um bug que deixava
--     qualquer participante ler mensagens de outras conversas), RPC para iniciar
--     conversa, realtime em messages.
--  2. Função de administradora (luminova_is_admin) usada nas políticas.
--  3. Comunidades: entrar respeitando join_policy, moderadores/admin gerenciam,
--     regras por subcomunidade, limite por XP (4 → 5 com 500 XP; admin ilimitado).
--  4. Seguir: contagens e checagem de bloqueio.
--  5. Tópico do dia com início/fim, tendências reais (sem contar IA), feed com is_ai.
--  6. XP + Skill Tree protegidos no banco (desbloqueio só via RPC).
--  7. Perfis de IA (marcados, com limites de frequência e log).
--  8. Índices de pesquisa (pg_trgm).
-- ============================================================================
begin;

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 0) Funções utilitárias
-- ---------------------------------------------------------------------------
create or replace function public.luminova_is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;
grant execute on function public.luminova_is_admin() to anon, authenticated;

create or replace function public.luminova_is_conversation_member(conv uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.conversation_members cm
                 where cm.conversation_id = conv and cm.user_id = auth.uid());
$$;
grant execute on function public.luminova_is_conversation_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1) CHATS PRIVADOS
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_message text,
  add column if not exists last_message_at timestamptz,
  add column if not exists last_sender_id uuid references public.profiles(id) on delete set null;

-- Corrige as políticas (a versão anterior comparava cm.conversation_id com ele mesmo).
drop policy if exists conversations_read_member on public.conversations;
create policy conversations_read_member on public.conversations for select to authenticated
using (public.luminova_is_conversation_member(id));

drop policy if exists conversation_members_read_member on public.conversation_members;
create policy conversation_members_read_member on public.conversation_members for select to authenticated
using (user_id = (select auth.uid()) or public.luminova_is_conversation_member(conversation_id));

-- Participantes só entram via RPC luminova_start_conversation (security definer).
drop policy if exists conversation_members_insert_self_or_creator on public.conversation_members;
drop policy if exists conversations_insert_creator on public.conversations;

drop policy if exists messages_read_member on public.messages;
create policy messages_read_member on public.messages for select to authenticated
using (deleted_at is null and public.luminova_is_conversation_member(conversation_id));

drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages for insert to authenticated
with check (sender_id = (select auth.uid()) and public.luminova_is_conversation_member(conversation_id));

-- Atualiza o resumo da conversa a cada mensagem (sem o cliente precisar de UPDATE).
create or replace function public.luminova_after_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.conversations
     set last_message = left(new.content, 200), last_message_at = new.created_at,
         last_sender_id = new.sender_id, updated_at = new.created_at
   where id = new.conversation_id;
  return new;
end; $$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
for each row execute function public.luminova_after_message();

-- Inicia (ou reaproveita) uma conversa direta entre o usuário atual e outra pessoa.
create or replace function public.luminova_start_conversation(other_user uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); conv uuid;
begin
  if me is null then raise exception 'Entre na sua conta para conversar.'; end if;
  if other_user is null or other_user = me then raise exception 'Escolha outra pessoa para conversar.'; end if;
  if not exists (select 1 from public.profiles where id = other_user) then
    raise exception 'Perfil não encontrado.';
  end if;
  if exists (select 1 from public.blocks b
             where (b.blocker_id = me and b.blocked_id = other_user)
                or (b.blocker_id = other_user and b.blocked_id = me)) then
    raise exception 'Não é possível iniciar conversa com este perfil.';
  end if;
  select c.id into conv
    from public.conversations c
    join public.conversation_members a on a.conversation_id = c.id and a.user_id = me
    join public.conversation_members b on b.conversation_id = c.id and b.user_id = other_user
   where c.context_type = 'direct'
     and (select count(*) from public.conversation_members x where x.conversation_id = c.id) = 2
   limit 1;
  if conv is null then
    insert into public.conversations (created_by, context_type) values (me, 'direct') returning id into conv;
    insert into public.conversation_members (conversation_id, user_id) values (conv, me), (conv, other_user);
  end if;
  return conv;
end; $$;
grant execute on function public.luminova_start_conversation(uuid) to authenticated;

create index if not exists conversations_updated_idx on public.conversations (updated_at desc);

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2) PERFIS: marca de IA protegida + leitura
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_ai boolean not null default false;

create or replace function public.luminova_protect_profile_flags()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and tg_op = 'UPDATE' and new.is_ai is distinct from old.is_ai then
    raise exception 'A marcação de perfil de IA só pode ser alterada pela administração.';
  end if;
  if auth.uid() is not null and tg_op = 'INSERT' and new.is_ai then
    raise exception 'A marcação de perfil de IA só pode ser definida pela administração.';
  end if;
  return new;
end; $$;
drop trigger if exists profiles_protect_flags on public.profiles;
create trigger profiles_protect_flags before insert or update on public.profiles
for each row execute function public.luminova_protect_profile_flags();

-- ---------------------------------------------------------------------------
-- 3) COMUNIDADES
-- ---------------------------------------------------------------------------
alter table public.community_subcommunities
  add column if not exists rules text[] not null default '{}',
  add column if not exists avatar_url text;

-- Entrar: respeita join_policy (open → active, approval → pending, invite → bloqueado).
drop policy if exists community_members_join_self on public.community_members;
create policy community_members_join_self on public.community_members for insert to authenticated
with check (
  user_id = (select auth.uid()) and role = 'member'
  and exists (
    select 1 from public.communities c
    where c.id = community_id
      and ((c.join_policy = 'open' and status in ('active','pending') and c.visibility <> 'hidden')
        or (c.join_policy = 'approval' and status = 'pending'))
  )
);

-- Gerenciar membros: dono, moderador ativo ou administradora.
drop policy if exists community_members_update_owner on public.community_members;
drop policy if exists community_members_update_managers on public.community_members;
create policy community_members_update_managers on public.community_members for update to authenticated
using (public.luminova_can_manage_community(community_id) or public.luminova_is_admin())
with check (public.luminova_can_manage_community(community_id) or public.luminova_is_admin());

-- Remover membro: o próprio, gestores ou administradora.
drop policy if exists community_members_leave_self on public.community_members;
create policy community_members_leave_self on public.community_members for delete to authenticated
using (user_id = (select auth.uid()) or public.luminova_can_manage_community(community_id) or public.luminova_is_admin());

-- Editar comunidade: dono, moderador ou administradora (owner_id continua protegido).
drop policy if exists communities_update_owner on public.communities;
drop policy if exists communities_update_managers on public.communities;
create policy communities_update_managers on public.communities for update to authenticated
using (public.luminova_can_manage_community(id) or public.luminova_is_admin())
with check (public.luminova_can_manage_community(id) or public.luminova_is_admin());

create or replace function public.luminova_protect_community_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.owner_id is distinct from old.owner_id and not public.luminova_is_admin() then
    raise exception 'Somente a administração pode transferir uma comunidade.';
  end if;
  return new;
end; $$;
drop trigger if exists communities_protect_owner on public.communities;
create trigger communities_protect_owner before update on public.communities
for each row execute function public.luminova_protect_community_owner();

-- A administradora enxerga comunidades privadas para moderar.
drop policy if exists communities_read_public_or_owner on public.communities;
create policy communities_read_public_or_owner on public.communities for select to anon, authenticated
using (visibility = 'public' or owner_id = (select auth.uid()) or public.luminova_is_admin());

-- Moderação de conteúdo: gestores e administradora removem publicações da comunidade.
drop policy if exists community_posts_delete_owner_or_author on public.community_posts;
create policy community_posts_delete_owner_or_author on public.community_posts for delete to authenticated
using (
  public.luminova_can_manage_community(community_id) or public.luminova_is_admin()
  or exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
);

-- Postar na comunidade: apenas membro ATIVO e autor do post (já existia; reforçado com admin).
drop policy if exists community_posts_insert_member on public.community_posts;
create policy community_posts_insert_member on public.community_posts for insert to authenticated
with check (
  (public.luminova_is_active_community_member(community_id) or public.luminova_is_admin())
  and exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
);

-- Limite de comunidades por pessoa: 4 (base), 5 a partir de 500 XP, administradora ilimitada.
create or replace function public.luminova_community_limit_for(uid uuid)
returns integer language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text; v_xp integer := 0;
begin
  select role into v_role from public.profiles where id = uid;
  if v_role = 'admin' then return 2147483647; end if;
  select coalesce(xp,0) into v_xp from public.profile_progress where user_id = uid;
  return case when coalesce(v_xp,0) >= 500 then 5 else 4 end;
end; $$;
grant execute on function public.luminova_community_limit_for(uuid) to authenticated;

create or replace function public.luminova_my_limits()
returns table (community_limit integer, communities_joined integer, xp integer, is_admin boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.luminova_is_admin() then null else public.luminova_community_limit_for(auth.uid()) end,
         (select count(*)::int from public.community_members m where m.user_id = auth.uid() and m.status = 'active'),
         coalesce((select pp.xp from public.profile_progress pp where pp.user_id = auth.uid()), 0),
         public.luminova_is_admin();
$$;
grant execute on function public.luminova_my_limits() to authenticated;

create or replace function public.luminova_community_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer; v_limit integer;
begin
  v_limit := public.luminova_community_limit_for(new.owner_id);
  select count(*) into v_count from public.community_members where user_id = new.owner_id and status = 'active';
  if v_count >= v_limit then
    raise exception 'Limite de comunidades atingido (%). Ganhe XP para desbloquear até 5.', v_limit;
  end if;
  return new;
end; $$;

create or replace function public.luminova_member_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer; v_limit integer;
begin
  if new.status <> 'active' then return new; end if;
  v_limit := public.luminova_community_limit_for(new.user_id);
  select count(*) into v_count from public.community_members
   where user_id = new.user_id and status = 'active' and community_id <> new.community_id;
  if v_count >= v_limit then
    raise exception 'Limite de comunidades atingido (%). Ganhe XP para desbloquear até 5.', v_limit;
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- 4) SEGUIR
-- ---------------------------------------------------------------------------
drop policy if exists follows_insert_self on public.follows;
create policy follows_insert_self on public.follows for insert to authenticated
with check (
  follower_id = (select auth.uid())
  and not exists (select 1 from public.blocks b
                  where (b.blocker_id = followed_id and b.blocked_id = follower_id))
);
create index if not exists follows_followed_idx on public.follows (followed_id);

-- ---------------------------------------------------------------------------
-- 5) TÓPICO DO DIA, TENDÊNCIAS E FEED
-- ---------------------------------------------------------------------------
alter table public.daily_topics
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists hashtag text,
  add column if not exists is_active boolean not null default true;

drop policy if exists daily_topics_admin_insert on public.daily_topics;
create policy daily_topics_admin_insert on public.daily_topics for insert to authenticated
with check (public.luminova_is_admin());
drop policy if exists daily_topics_admin_update on public.daily_topics;
create policy daily_topics_admin_update on public.daily_topics for update to authenticated
using (public.luminova_is_admin()) with check (public.luminova_is_admin());
drop policy if exists daily_topics_admin_delete on public.daily_topics;
create policy daily_topics_admin_delete on public.daily_topics for delete to authenticated
using (public.luminova_is_admin());
grant delete on public.daily_topics to authenticated;

-- v_feed_posts agora expõe is_ai (coluna nova no FINAL; create or replace exige isso).
create or replace view public.v_feed_posts with (security_invoker = true) as
select
  p.id as post_id, p.author_id, pr.username, pr.display_name, pr.avatar_url,
  p.interest_id, i.name as interest_name, p.content, p.post_type, p.link_url, p.media_urls,
  p.visibility, p.created_at, p.updated_at,
  coalesce(rx.reaction_count, 0) as reaction_count,
  coalesce(cm.comment_count, 0) as comment_count,
  coalesce(ut.useful_count, 0) as useful_count,
  pr.is_ai as is_ai
from public.posts p
join public.profiles pr on pr.id = p.author_id
left join public.interests i on i.id = p.interest_id
left join (select post_id, count(*)::bigint as reaction_count from public.post_reactions group by post_id) rx on rx.post_id = p.id
left join (select post_id, count(*)::bigint as comment_count from public.comments where deleted_at is null group by post_id) cm on cm.post_id = p.id
left join (select post_id, count(*)::bigint as useful_count from public.post_reactions where reaction = 'useful' group by post_id) ut on ut.post_id = p.id
where p.deleted_at is null;
grant select on public.v_feed_posts to anon, authenticated;

-- Tópico vigente: ativo e dentro da janela (ou, sem janela, o de hoje).
create or replace function public.luminova_current_topic()
returns setof public.daily_topics language sql stable security invoker set search_path = public as $$
  select * from public.daily_topics t
   where t.is_active
     and ((t.starts_at is not null and now() >= t.starts_at and (t.ends_at is null or now() <= t.ends_at))
          or (t.starts_at is null and t.topic_date = current_date))
   order by coalesce(t.starts_at, t.topic_date::timestamptz) desc
   limit 1;
$$;
grant execute on function public.luminova_current_topic() to anon, authenticated;

-- Tendências reais: hashtags de publicações públicas de PESSOAS (perfis de IA não contam),
-- janela em dias; interações = comentários + reações de outras pessoas.
create or replace function public.luminova_trending(window_days integer default 7, result_limit integer default 8, in_community uuid default null)
returns table (tag text, post_count bigint, interaction_count bigint, score bigint)
language sql stable security invoker set search_path = public as $$
  with recent as (
    select p.id, p.content from public.posts p
      join public.profiles pr on pr.id = p.author_id
     where p.deleted_at is null and p.visibility = 'public' and not pr.is_ai
       and p.created_at >= now() - make_interval(days => greatest(1, least(coalesce(window_days,7), 90)))
       and (in_community is null or exists (select 1 from public.community_posts cp where cp.post_id = p.id and cp.community_id = in_community))
  ), tags as (
    select r.id, lower(m[1]) as tag from recent r,
      lateral regexp_matches(r.content, '#([[:alnum:]_]{2,40})', 'g') as m
  ), per_post as (
    select t.tag, t.id,
      (select count(*) from public.comments c join public.profiles pc on pc.id = c.author_id
        where c.post_id = t.id and c.deleted_at is null and not pc.is_ai) +
      (select count(*) from public.post_reactions rx join public.profiles pr2 on pr2.id = rx.user_id
        where rx.post_id = t.id and not pr2.is_ai) as inter
    from (select distinct id, tag from tags) t
  )
  select tag, count(*)::bigint, coalesce(sum(inter),0)::bigint, (count(*) * 3 + coalesce(sum(inter),0))::bigint
    from per_post group by tag
   order by 4 desc, 2 desc, tag
   limit greatest(1, least(coalesce(result_limit,8), 30));
$$;
grant execute on function public.luminova_trending(integer, integer, uuid) to anon, authenticated;

-- Publicações por hashtag (para clicar num assunto).
create or replace function public.luminova_posts_by_tag(tag_text text, in_community uuid default null, result_limit integer default 30)
returns setof public.v_feed_posts language sql stable security invoker set search_path = public as $$
  select v.* from public.v_feed_posts v
   where v.content ~* ('(^|[^[:alnum:]_])#' || regexp_replace(lower(trim(both '#' from tag_text)), '[^[:alnum:]_]', '', 'g') || '([^[:alnum:]_]|$)')
     and (in_community is null or exists (select 1 from public.community_posts cp where cp.post_id = v.post_id and cp.community_id = in_community))
   order by v.created_at desc
   limit greatest(1, least(coalesce(result_limit,30), 100));
$$;
grant execute on function public.luminova_posts_by_tag(text, uuid, integer) to anon, authenticated;

-- Índices de pesquisa (ilike '%texto%').
create index if not exists profiles_username_trgm on public.profiles using gin (lower(username) extensions.gin_trgm_ops);
create index if not exists profiles_display_trgm on public.profiles using gin (lower(display_name) extensions.gin_trgm_ops);
create index if not exists communities_name_trgm on public.communities using gin (lower(name) extensions.gin_trgm_ops);
create index if not exists posts_content_trgm on public.posts using gin (lower(content) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 6) XP + SKILL TREE (desbloqueio somente por RPC validada no banco)
-- ---------------------------------------------------------------------------
create table if not exists public.skill_nodes (
  node_key text primary key,
  name text not null,
  branch text not null check (branch in ('criacao','colaboracao','comunidade','exploracao','origem')),
  description text not null default '',
  xp_required integer not null default 0 check (xp_required >= 0),
  xp_reward integer not null default 0 check (xp_reward >= 0),
  requires text[] not null default '{}',
  metric text not null default 'none' check (metric in ('none','posts','comments','communities_joined','communities_created','following','followers','profile_complete')),
  metric_min integer not null default 0,
  pos_x integer not null default 380,
  pos_y integer not null default 310
);
create table if not exists public.profile_skills (
  user_id uuid not null references public.profiles(id) on delete cascade,
  node_key text not null references public.skill_nodes(node_key) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, node_key)
);
alter table public.skill_nodes enable row level security;
alter table public.profile_skills enable row level security;
drop policy if exists skill_nodes_read on public.skill_nodes;
create policy skill_nodes_read on public.skill_nodes for select to anon, authenticated using (true);
drop policy if exists profile_skills_read on public.profile_skills;
create policy profile_skills_read on public.profile_skills for select to authenticated using (true);
-- Sem política de INSERT/UPDATE/DELETE: o cliente não consegue desbloquear nada diretamente.
grant select on public.skill_nodes to anon, authenticated;
grant select on public.profile_skills to authenticated;
revoke insert, update, delete on public.profile_skills from anon, authenticated;
revoke insert, update, delete on public.profile_progress from anon, authenticated;

insert into public.skill_nodes (node_key,name,branch,description,xp_required,xp_reward,requires,metric,metric_min,pos_x,pos_y) values
 ('centelha','Centelha Primordial','origem','Sua jornada começa ao publicar a primeira ideia.',0,20,'{}','posts',1,380,310),
 ('voz','Primeira Voz','criacao','Publique 3 ideias.',20,20,'{centelha}','posts',3,200,200),
 ('autor','Autor Constante','criacao','Publique 10 ideias.',80,40,'{voz}','posts',10,120,110),
 ('perfil','Perfil Completo','criacao','Preencha nome e biografia.',0,15,'{centelha}','profile_complete',1,140,310),
 ('conversa','Boa Conversa','colaboracao','Faça 3 comentários.',20,20,'{centelha}','comments',3,560,200),
 ('colaborador','Colaborador','colaboracao','Faça 15 comentários.',80,40,'{conversa}','comments',15,640,110),
 ('pertencer','Pertencer','comunidade','Entre em uma comunidade.',20,25,'{centelha}','communities_joined',1,200,420),
 ('fundador','Fundador','comunidade','Crie uma comunidade.',60,40,'{pertencer}','communities_created',1,120,510),
 ('conexao','Conexão','exploracao','Siga 3 pessoas.',20,20,'{centelha}','following',3,560,420),
 ('influente','Influente','exploracao','Tenha 5 seguidores.',100,50,'{conexao}','followers',5,640,510)
on conflict (node_key) do update set name = excluded.name, branch = excluded.branch,
  description = excluded.description, xp_required = excluded.xp_required, xp_reward = excluded.xp_reward,
  requires = excluded.requires, metric = excluded.metric, metric_min = excluded.metric_min,
  pos_x = excluded.pos_x, pos_y = excluded.pos_y;

create or replace function public.luminova_metric_value(uid uuid, m text)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select case m
    when 'posts' then (select count(*)::int from public.posts where author_id = uid and deleted_at is null)
    when 'comments' then (select count(*)::int from public.comments where author_id = uid and deleted_at is null)
    when 'communities_joined' then (select count(*)::int from public.community_members where user_id = uid and status = 'active')
    when 'communities_created' then (select count(*)::int from public.communities where owner_id = uid)
    when 'following' then (select count(*)::int from public.follows where follower_id = uid)
    when 'followers' then (select count(*)::int from public.follows where followed_id = uid)
    when 'profile_complete' then (select case when coalesce(trim(bio),'') <> '' and display_name <> 'Novo usuário' then 1 else 0 end from public.profiles where id = uid)
    else 0 end;
$$;

create or replace function public.luminova_unlock_skill(p_node text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); n public.skill_nodes; v_xp integer; v_missing text[];
begin
  if me is null then raise exception 'Entre na sua conta.'; end if;
  select * into n from public.skill_nodes where node_key = p_node;
  if not found then raise exception 'Habilidade inexistente.'; end if;
  if exists (select 1 from public.profile_skills where user_id = me and node_key = p_node) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  insert into public.profile_progress (user_id) values (me) on conflict (user_id) do nothing;
  select xp into v_xp from public.profile_progress where user_id = me;
  if v_xp < n.xp_required then raise exception 'XP insuficiente: precisa de % XP.', n.xp_required; end if;
  select array_agg(r) into v_missing from unnest(n.requires) r
   where not exists (select 1 from public.profile_skills s where s.user_id = me and s.node_key = r);
  if v_missing is not null then raise exception 'Desbloqueie antes: %.', array_to_string(v_missing, ', '); end if;
  if n.metric <> 'none' and public.luminova_metric_value(me, n.metric) < n.metric_min then
    raise exception 'Requisito não cumprido ainda (% de %).', public.luminova_metric_value(me, n.metric), n.metric_min;
  end if;
  insert into public.profile_skills (user_id, node_key) values (me, p_node);
  update public.profile_progress
     set xp = xp + n.xp_reward, level = 1 + floor((xp + n.xp_reward) / 100.0)::int, updated_at = now()
   where user_id = me;
  return jsonb_build_object('ok', true, 'xp_reward', n.xp_reward);
end; $$;
grant execute on function public.luminova_unlock_skill(text) to authenticated;
grant execute on function public.luminova_metric_value(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) PERFIS DE IA (marcados, com limite de frequência e log)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_agents (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  persona text not null default '',
  style text not null default '',
  interests text[] not null default '{}',
  enabled boolean not null default false,
  max_posts_per_day integer not null default 2 check (max_posts_per_day between 0 and 10),
  max_comments_per_day integer not null default 4 check (max_comments_per_day between 0 and 20),
  min_minutes_between_actions integer not null default 90 check (min_minutes_between_actions >= 5),
  last_action_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.ai_activity_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.ai_agents(profile_id) on delete cascade,
  action text not null check (action in ('post','comment','skip')),
  target_id uuid,
  details text not null default '',
  created_at timestamp with time zone not null default now()
);
create index if not exists ai_activity_agent_idx on public.ai_activity_log (agent_id, created_at desc);
alter table public.ai_agents enable row level security;
alter table public.ai_activity_log enable row level security;
drop policy if exists ai_agents_read on public.ai_agents;
create policy ai_agents_read on public.ai_agents for select to authenticated using (true);
drop policy if exists ai_agents_admin_write on public.ai_agents;
create policy ai_agents_admin_write on public.ai_agents for update to authenticated
using (public.luminova_is_admin()) with check (public.luminova_is_admin());
drop policy if exists ai_log_admin_read on public.ai_activity_log;
create policy ai_log_admin_read on public.ai_activity_log for select to authenticated using (public.luminova_is_admin());
grant select on public.ai_agents to authenticated;
grant update (enabled, max_posts_per_day, max_comments_per_day, min_minutes_between_actions, persona, style, interests) on public.ai_agents to authenticated;
grant select on public.ai_activity_log to authenticated;

-- Usada pela função de borda (service_role): decide se o agente pode agir agora.
create or replace function public.luminova_ai_can_act(p_agent uuid, p_action text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.ai_agents; v_today integer;
begin
  select * into a from public.ai_agents where profile_id = p_agent;
  if not found or not a.enabled then return false; end if;
  if a.last_action_at is not null and a.last_action_at > now() - make_interval(mins => a.min_minutes_between_actions) then return false; end if;
  select count(*) into v_today from public.ai_activity_log
   where agent_id = p_agent and action = p_action and created_at >= date_trunc('day', now());
  return v_today < case p_action when 'post' then a.max_posts_per_day else a.max_comments_per_day end;
end; $$;
revoke execute on function public.luminova_ai_can_act(uuid, text) from anon, authenticated;

commit;
