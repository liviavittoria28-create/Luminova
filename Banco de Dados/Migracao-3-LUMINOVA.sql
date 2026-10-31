-- ============================================================================
-- LUMINOVA | Migração 3 (idempotente e NÃO destrutiva)
-- Execute no Supabase > SQL Editor DEPOIS de Banco de dados.sql,
-- Migracao-completa-LUMINOVA.sql e Migracao-2-LUMINOVA.sql.
-- Pode ser executada mais de uma vez. Nada é apagado.
--
-- O que esta migração cria / corrige:
--  1. Papéis nas comunidades: Dono > Administrador > Moderador > Membro.
--     Cargos só mudam por RPC (trigger impede alteração direta).
--  2. Certificação de perfis: critérios (seguidores + XP) editáveis pela
--     administração + certificação manual. Usuários não conseguem se certificar.
--  3. Conquistas: catálogo editável e progresso calculado no banco.
--  4. Mural de agradecimentos: qualquer usuário logado agradece uma publicação
--     pública de outra pessoa (uma vez por publicação).
--  5. Limite de comunidades por XP em faixas editáveis (4 → 5 → 6 → 7).
--  6. Certifica @livinha agora (manual).
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1) PAPÉIS NAS COMUNIDADES
-- ---------------------------------------------------------------------------
alter table public.community_members drop constraint if exists community_members_role_check;
alter table public.community_members
  add constraint community_members_role_check
  check (role in ('owner','admin','moderator','member'));

-- Cargo efetivo do usuário atual na comunidade (dono vence qualquer outro cargo).
create or replace function public.luminova_my_community_role(target_community uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from public.communities c
                 where c.id = target_community and c.owner_id = auth.uid()) then 'owner'
    else (select m.role from public.community_members m
           where m.community_id = target_community
             and m.user_id = auth.uid()
             and m.status = 'active')
  end;
$$;
grant execute on function public.luminova_my_community_role(uuid) to anon, authenticated;

-- Gerencia conteúdo e membros: dono, administrador ou moderador.
create or replace function public.luminova_can_manage_community(target_community uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.luminova_my_community_role(target_community) in ('owner','admin','moderator'), false);
$$;

-- Administra a comunidade (configurações e cargos): dono ou administrador.
create or replace function public.luminova_is_community_admin(target_community uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.luminova_my_community_role(target_community) in ('owner','admin'), false);
$$;

-- Versão usada por outras partes do app: também considera a administração global.
create or replace function public.can_manage_community(target_community uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.luminova_can_manage_community(target_community) or public.luminova_is_admin();
$$;

-- Bloqueia alteração direta de cargo: só a RPC abaixo (ou a administração global) pode mudar.
create or replace function public.luminova_guard_community_roles()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    if coalesce(current_setting('luminova.role_rpc', true), '') <> 'on'
       and not public.luminova_is_admin() then
      raise exception 'Use a gestão de cargos da comunidade para alterar papéis.';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists community_members_guard_roles on public.community_members;
create trigger community_members_guard_roles before update on public.community_members
for each row execute function public.luminova_guard_community_roles();

-- Altera o cargo de um membro, respeitando a hierarquia:
--  • Dono nomeia e remove administradores, moderadores e membros.
--  • Administrador nomeia e remove moderadores e membros (não mexe em outros administradores).
--  • Ninguém altera o dono.
create or replace function public.luminova_set_community_role(p_community uuid, p_user uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  my_role text;
  target_role text;
  v_owner uuid;
begin
  if me is null then raise exception 'Entre na sua conta para gerenciar cargos.'; end if;
  if p_role not in ('admin','moderator','member') then raise exception 'Cargo inválido.'; end if;
  select owner_id into v_owner from public.communities where id = p_community;
  if v_owner is null then raise exception 'Comunidade não encontrada.'; end if;
  if p_user = v_owner then raise exception 'O dono da comunidade não pode ter o cargo alterado.'; end if;

  my_role := public.luminova_my_community_role(p_community);
  if public.luminova_is_admin() then my_role := 'owner'; end if;
  if my_role is null or my_role not in ('owner','admin') then
    raise exception 'Apenas o dono ou administradores podem alterar cargos.';
  end if;
  if my_role = 'admin' and p_role = 'admin' then
    raise exception 'Somente o dono pode nomear administradores.';
  end if;

  select role into target_role from public.community_members
   where community_id = p_community and user_id = p_user and status = 'active';
  if target_role is null then raise exception 'Esta pessoa não é membro ativo da comunidade.'; end if;
  if my_role = 'admin' and target_role = 'admin' then
    raise exception 'Somente o dono pode alterar um administrador.';
  end if;

  if target_role <> p_role then
    perform set_config('luminova.role_rpc', 'on', true);
    update public.community_members set role = p_role
     where community_id = p_community and user_id = p_user;
    perform set_config('luminova.role_rpc', 'off', true);
  end if;
  return jsonb_build_object('ok', true, 'role', p_role);
end; $$;
grant execute on function public.luminova_set_community_role(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) LIMITE DE COMUNIDADES POR XP (faixas editáveis)
-- ---------------------------------------------------------------------------
create table if not exists public.community_limit_tiers (
  min_xp integer primary key check (min_xp >= 0),
  max_communities integer not null check (max_communities >= 1)
);
insert into public.community_limit_tiers (min_xp, max_communities) values
  (0, 4), (500, 5), (1500, 6), (3000, 7)
on conflict (min_xp) do nothing;
alter table public.community_limit_tiers enable row level security;
drop policy if exists community_limit_tiers_read on public.community_limit_tiers;
create policy community_limit_tiers_read on public.community_limit_tiers
for select to anon, authenticated using (true);
drop policy if exists community_limit_tiers_admin_write on public.community_limit_tiers;
create policy community_limit_tiers_admin_write on public.community_limit_tiers
for all to authenticated using (public.luminova_is_admin()) with check (public.luminova_is_admin());
grant select on public.community_limit_tiers to anon, authenticated;
grant insert, update, delete on public.community_limit_tiers to authenticated;

create or replace function public.luminova_community_limit_for(uid uuid)
returns integer language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text; v_xp integer := 0; v_limit integer;
begin
  select role into v_role from public.profiles where id = uid;
  if v_role = 'admin' then return 2147483647; end if;
  select coalesce(xp,0) into v_xp from public.profile_progress where user_id = uid;
  select t.max_communities into v_limit from public.community_limit_tiers t
   where t.min_xp <= coalesce(v_xp,0) order by t.min_xp desc limit 1;
  return coalesce(v_limit, 4);
end; $$;
grant execute on function public.luminova_community_limit_for(uuid) to authenticated;

create or replace function public.luminova_community_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer; v_limit integer;
begin
  v_limit := public.luminova_community_limit_for(new.owner_id);
  select count(*) into v_count from public.community_members where user_id = new.owner_id and status = 'active';
  if v_count >= v_limit then
    raise exception 'Limite de comunidades atingido (%). Ganhe XP para desbloquear mais comunidades.', v_limit;
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
    raise exception 'Limite de comunidades atingido (%). Ganhe XP para desbloquear mais comunidades.', v_limit;
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- 3) CERTIFICAÇÃO DE PERFIS
-- ---------------------------------------------------------------------------
create table if not exists public.certification_settings (
  id smallint primary key default 1 check (id = 1),
  min_followers integer not null default 100 check (min_followers >= 0),
  min_xp integer not null default 500 check (min_xp >= 0),
  updated_at timestamptz not null default now()
);
insert into public.certification_settings (id) values (1) on conflict (id) do nothing;
alter table public.certification_settings enable row level security;
drop policy if exists certification_settings_read on public.certification_settings;
create policy certification_settings_read on public.certification_settings
for select to anon, authenticated using (true);
drop policy if exists certification_settings_admin_write on public.certification_settings;
create policy certification_settings_admin_write on public.certification_settings
for update to authenticated using (public.luminova_is_admin()) with check (public.luminova_is_admin());
grant select on public.certification_settings to anon, authenticated;
grant update on public.certification_settings to authenticated;

-- Selo fica em profile_progress, que o usuário só lê (sem políticas de escrita).
alter table public.profile_progress
  add column if not exists certified boolean not null default false,
  add column if not exists certified_manual boolean not null default false;

create or replace function public.luminova_profile_progress_certify()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.certification_settings; v_followers integer;
begin
  select * into s from public.certification_settings where id = 1;
  select count(*)::int into v_followers from public.follows where followed_id = new.user_id;
  new.certified := coalesce(new.certified_manual, false)
    or (v_followers >= coalesce(s.min_followers, 2147483647)
        and coalesce(new.xp, 0) >= coalesce(s.min_xp, 2147483647));
  return new;
end; $$;
drop trigger if exists profile_progress_certify on public.profile_progress;
create trigger profile_progress_certify before insert or update on public.profile_progress
for each row execute function public.luminova_profile_progress_certify();

-- Seguir / deixar de seguir força a reavaliação do selo da pessoa seguida.
create or replace function public.luminova_follow_recertify()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare target uuid;
begin
  target := case when tg_op = 'DELETE' then old.followed_id else new.followed_id end;
  update public.profile_progress set updated_at = now() where user_id = target;
  return null;
end; $$;
drop trigger if exists follows_recertify on public.follows;
create trigger follows_recertify after insert or delete on public.follows
for each row execute function public.luminova_follow_recertify();

-- Mudar os critérios reavalia todos os perfis.
create or replace function public.luminova_settings_recertify()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profile_progress set updated_at = now();
  return null;
end; $$;
drop trigger if exists certification_settings_recertify on public.certification_settings;
create trigger certification_settings_recertify after update on public.certification_settings
for each row execute function public.luminova_settings_recertify();

-- Certificação manual (administração): concede ou remove pelo @usuário.
create or replace function public.luminova_set_certified(p_username text, p_certified boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; r record;
begin
  if not public.luminova_is_admin() then raise exception 'Somente a administração pode certificar perfis.'; end if;
  select p.id into uid from public.profiles p
   where lower(p.username) = lower(trim(both ' @' from coalesce(p_username,'')))
   limit 1;
  if uid is null then raise exception 'Perfil não encontrado.'; end if;
  update public.profile_progress set certified_manual = p_certified where user_id = uid;
  select pp.user_id, pp.certified, pp.certified_manual into r from public.profile_progress pp where pp.user_id = uid;
  return jsonb_build_object('user_id', r.user_id, 'certified', r.certified, 'certified_manual', r.certified_manual);
end; $$;
grant execute on function public.luminova_set_certified(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) CONQUISTAS
-- ---------------------------------------------------------------------------
create table if not exists public.achievements (
  key text primary key,
  name text not null,
  description text not null default '',
  icon text not null default '✦',
  metric text not null,
  target integer not null check (target >= 1),
  sort_order integer not null default 0,
  is_active boolean not null default true
);
alter table public.achievements enable row level security;
drop policy if exists achievements_read on public.achievements;
create policy achievements_read on public.achievements for select to anon, authenticated using (true);
drop policy if exists achievements_admin_write on public.achievements;
create policy achievements_admin_write on public.achievements for all to authenticated
using (public.luminova_is_admin()) with check (public.luminova_is_admin());
grant select on public.achievements to anon, authenticated;
grant insert, update, delete on public.achievements to authenticated;

-- Métricas usadas por conquistas e pela Skill Tree.
create or replace function public.luminova_metric_value(uid uuid, m text)
returns integer language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case m
    when 'posts' then (select count(*)::int from public.posts where author_id = uid and deleted_at is null)
    when 'comments' then (select count(*)::int from public.comments where author_id = uid and deleted_at is null)
    when 'communities_joined' then (select count(*)::int from public.community_members where user_id = uid and status = 'active')
    when 'communities_created' then (select count(*)::int from public.communities where owner_id = uid)
    when 'following' then (select count(*)::int from public.follows where follower_id = uid)
    when 'followers' then (select count(*)::int from public.follows where followed_id = uid)
    when 'profile_complete' then (select case when coalesce(trim(bio),'') <> '' and display_name <> 'Novo usuário' then 1 else 0 end from public.profiles where id = uid)
    when 'thanks_received' then (select count(*)::int from public.gratitudes where recipient_id = uid)
    when 'thanks_given' then (select count(*)::int from public.gratitudes where giver_id = uid)
    when 'certified' then (select case when pp.certified then 1 else 0 end from public.profile_progress pp where pp.user_id = uid)
    when 'xp' then (select pp.xp from public.profile_progress pp where pp.user_id = uid)
    when 'skills' then (select count(*)::int from public.profile_skills where user_id = uid)
    else 0 end, 0);
end; $$;

insert into public.achievements (key, name, description, icon, metric, target, sort_order) values
  ('primeira-luz',   'Primeira Luz',        'Publique sua primeira ideia.',                 '✦', 'posts', 1, 10),
  ('eco-constante',  'Eco Constante',       'Publique 10 ideias.',                          '✧', 'posts', 10, 20),
  ('dialogo',        'Diálogo',             'Faça 10 comentários.',                         '✶', 'comments', 10, 30),
  ('voz-da-tribo',   'Voz da Tribo',        'Faça 50 comentários.',                         '✹', 'comments', 50, 40),
  ('tribo',          'Tribo',               'Entre em uma comunidade.',                     '◈', 'communities_joined', 1, 50),
  ('fundador',       'Fundador de Mundos',  'Crie uma comunidade.',                         '❂', 'communities_created', 1, 60),
  ('primeiro-obrigado','Gratidão Recebida', 'Receba seu primeiro agradecimento.',           '♥', 'thanks_received', 1, 70),
  ('farol',          'Farol',               'Receba 10 agradecimentos.',                    '♦', 'thanks_received', 10, 80),
  ('generoso',       'Generoso',            'Agradeça 5 publicações de outras pessoas.',    '❣', 'thanks_given', 5, 90),
  ('radiante',       'Radiante',            'Tenha 25 seguidores.',                         '☀', 'followers', 25, 100),
  ('certificado',    'Selo Certificado',    'Tenha seu perfil certificado.',                '✪', 'certified', 1, 110),
  ('chama',          'Chama Crescente',     'Acumule 500 XP.',                              '♨', 'xp', 500, 120),
  ('estrela-polar',  'Estrela Polar',       'Acumule 1.500 XP.',                            '★', 'xp', 1500, 130),
  ('arvore-cheia',   'Árvore Viva',         'Desbloqueie 5 nós da Skill Tree.',             '❋', 'skills', 5, 140)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, icon = excluded.icon,
  metric = excluded.metric, target = excluded.target, sort_order = excluded.sort_order;

-- Progresso de conquistas de um perfil (leitura pública; nada é gravado pelo cliente).
create or replace function public.luminova_profile_achievements(p_user uuid)
returns table (key text, name text, description text, icon text, sort_order integer,
               target integer, progress integer, earned boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.key, a.name, a.description, a.icon, a.sort_order, a.target,
         least(public.luminova_metric_value(p_user, a.metric), a.target),
         public.luminova_metric_value(p_user, a.metric) >= a.target
    from public.achievements a
   where a.is_active
   order by a.sort_order, a.key;
$$;
grant execute on function public.luminova_profile_achievements(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) MURAL DE AGRADECIMENTOS
-- ---------------------------------------------------------------------------
create table if not exists public.gratitudes (
  id uuid primary key default gen_random_uuid(),
  giver_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  message text not null default '' check (char_length(message) <= 280),
  created_at timestamptz not null default now(),
  check (giver_id <> recipient_id),
  check ((post_id is not null)::int + (comment_id is not null)::int = 1)
);
create unique index if not exists gratitudes_giver_post_uq
  on public.gratitudes (giver_id, post_id) where post_id is not null;
create unique index if not exists gratitudes_giver_comment_uq
  on public.gratitudes (giver_id, comment_id) where comment_id is not null;
create index if not exists gratitudes_recipient_idx on public.gratitudes (recipient_id, created_at desc);

alter table public.gratitudes enable row level security;
drop policy if exists gratitudes_read on public.gratitudes;
create policy gratitudes_read on public.gratitudes for select to anon, authenticated using (true);

-- Qualquer usuário logado agradece uma publicação (ou comentário) PÚBLICA de outra pessoa.
-- Bloqueio nos dois sentidos, sem depender da RLS de blocks (que só mostra os bloqueios feitos por quem lê).
create or replace function public.luminova_is_blocked_pair(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.blocks
                  where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

drop policy if exists gratitudes_insert on public.gratitudes;
create policy gratitudes_insert on public.gratitudes for insert to authenticated
with check (
  giver_id = (select auth.uid())
  and not public.luminova_is_blocked_pair(giver_id, recipient_id)
  and (
    (post_id is not null and exists (
       select 1 from public.posts p
        where p.id = post_id and p.author_id = recipient_id
          and p.deleted_at is null and p.visibility = 'public'))
    or
    (comment_id is not null and exists (
       select 1 from public.comments c join public.posts p on p.id = c.post_id
        where c.id = comment_id and c.author_id = recipient_id and c.deleted_at is null
          and p.deleted_at is null and p.visibility = 'public'))
  )
);

drop policy if exists gratitudes_delete_giver on public.gratitudes;
create policy gratitudes_delete_giver on public.gratitudes for delete to authenticated
using (giver_id = (select auth.uid()));

grant select on public.gratitudes to anon, authenticated;
grant insert, delete on public.gratitudes to authenticated;

-- ---------------------------------------------------------------------------
-- 6) CERTIFICA @livinha AGORA (manual)
-- ---------------------------------------------------------------------------
-- Não aborta a migração se o perfil não existir; apenas avisa.
do $$
declare n integer; v_id uuid;
begin
  select count(*) into n from public.profiles where lower(username) = 'livinha';
  if n <> 1 then
    raise notice 'Certificação de @livinha não aplicada: encontrados % perfis. Rode de novo após conferir o username.', n;
    return;
  end if;
  select id into v_id from public.profiles where lower(username) = 'livinha';
  insert into public.profile_progress (user_id) values (v_id) on conflict (user_id) do nothing;
  update public.profile_progress set certified_manual = true where user_id = v_id;
end $$;

commit;

-- Verificação (execute separadamente):
-- select username, certified, certified_manual, xp from public.profile_progress pp join public.profiles p on p.id = pp.user_id where lower(p.username) = 'livinha';
-- select * from public.luminova_profile_achievements((select id from public.profiles where lower(username)='livinha'));
-- select * from public.certification_settings;
