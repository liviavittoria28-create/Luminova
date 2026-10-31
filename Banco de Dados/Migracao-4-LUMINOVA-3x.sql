-- ============================================================================
-- LUMINOVA 3.x | Migração 4 — schema_version 4 (idempotente e NÃO destrutiva)
-- Execute no Supabase > SQL Editor DEPOIS de: Banco de dados.sql,
-- Migracao-completa-LUMINOVA.sql, Migracao-2-LUMINOVA.sql e Migracao-3-LUMINOVA.sql.
-- Pode ser executada mais de uma vez. Nenhuma tabela, coluna ou linha existente é apagada.
--
-- Versão do PRODUTO: LUMINOVA 3.0.0  ·  Versão do BANCO: 4 (tabela luminova_schema_versions)
--
--  1. SEGURANÇA (falhas confirmadas em teste local — ver testes/10-ataques-rls.sql)
--     a) conversation_members: era possível trocar o próprio conversation_id e entrar
--        em qualquer conversa privada (lia todas as mensagens). Agora só last_read_at é editável.
--     b) messages: UPDATE podia mover mensagens entre conversas; INSERT ignorava bloqueios.
--     c) communities: membros ativos não conseguiam ler comunidades privadas/ocultas.
--     d) username: "Ana" e "ana" podiam coexistir; username em uso derrubava o cadastro.
--     e) posts: perfis bloqueados e contas privadas apareciam no feed.
--  2. LGPD: documentos versionados, registro de aceite, preferências de privacidade,
--     solicitações de titulares, exportação de dados e exclusão de conta.
--  3. Social: notificações automáticas, itens salvos, denúncias moderáveis, chat de comunidade
--     moderável, anti-spam, edição marcada, novos interesses (hobbies, fandoms, criatividade).
--  4. Recomendações por interesses declarados (pessoas, comunidades, publicações, agentes).
--  5. NOVA BRAIN: personalidade, memória de longo prazo com consentimento, relações entre agentes,
--     limites por tipo de ação e horário de atividade.
--  6. Saúde da plataforma (painel admin).
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0) Versão do banco (independente da versão do produto)
-- ---------------------------------------------------------------------------
create table if not exists public.luminova_schema_versions (
  version integer primary key,
  name text not null,
  applied_at timestamptz not null default now()
);
alter table public.luminova_schema_versions enable row level security;
drop policy if exists schema_versions_read on public.luminova_schema_versions;
create policy schema_versions_read on public.luminova_schema_versions for select to anon, authenticated using (true);
grant select on public.luminova_schema_versions to anon, authenticated;
insert into public.luminova_schema_versions (version, name) values
  (1, 'Banco de dados.sql (base)'),
  (2, 'Migracao-completa + Migracao-2'),
  (3, 'Migracao-3 (cargos, conquistas, certificação)'),
  (4, 'Migracao-4 (LUMINOVA 3.x: segurança, LGPD, recomendações, NOVA BRAIN)')
on conflict (version) do nothing;

-- Operações internas do sistema (exclusão de conta, transferência automática) ligam esta flag.
create or replace function public.luminova_system_op()
returns boolean language sql stable as $$
  select coalesce(current_setting('luminova.system_op', true), '') = 'on';
$$;

-- ---------------------------------------------------------------------------
-- 1a) CONVERSAS: participação imutável, só last_read_at editável
-- ---------------------------------------------------------------------------
revoke update on public.conversation_members from anon, authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;

create or replace function public.luminova_guard_conversation_member()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.conversation_id is distinct from old.conversation_id or new.user_id is distinct from old.user_id then
    raise exception 'Participação em conversa não pode ser transferida.';
  end if;
  return new;
end; $$;
drop trigger if exists conversation_members_guard on public.conversation_members;
create trigger conversation_members_guard before update on public.conversation_members
for each row execute function public.luminova_guard_conversation_member();

drop policy if exists conversation_members_update_self on public.conversation_members;
create policy conversation_members_update_self on public.conversation_members for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Sair de uma conversa (remove só a própria participação).
drop policy if exists conversation_members_leave_self on public.conversation_members;
create policy conversation_members_leave_self on public.conversation_members for delete to authenticated
using (user_id = (select auth.uid()));
grant delete on public.conversation_members to authenticated;

-- ---------------------------------------------------------------------------
-- 1b) MENSAGENS: sem mover entre conversas, sem enviar com bloqueio, apagar = soft delete
-- ---------------------------------------------------------------------------
create or replace function public.luminova_is_blocked_pair(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.blocks
                  where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;
grant execute on function public.luminova_is_blocked_pair(uuid, uuid) to anon, authenticated;

-- true se QUALQUER outra pessoa da conversa tem bloqueio com o usuário atual
create or replace function public.luminova_conversation_blocked(conv uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.conversation_members cm
     where cm.conversation_id = conv and cm.user_id <> auth.uid()
       and public.luminova_is_blocked_pair(auth.uid(), cm.user_id)
  );
$$;
grant execute on function public.luminova_conversation_blocked(uuid) to authenticated;

drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and public.luminova_is_conversation_member(conversation_id)
  and not public.luminova_conversation_blocked(conversation_id)
);

revoke update on public.messages from anon, authenticated;
grant update (content, deleted_at) on public.messages to authenticated;
drop policy if exists messages_update_sender on public.messages;
create policy messages_update_sender on public.messages for update to authenticated
using (sender_id = (select auth.uid()))
with check (sender_id = (select auth.uid()) and public.luminova_is_conversation_member(conversation_id));

create or replace function public.luminova_guard_message()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.conversation_id is distinct from old.conversation_id or new.sender_id is distinct from old.sender_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Mensagens não podem ser movidas nem ter o remetente alterado.';
  end if;
  return new;
end; $$;
drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before update on public.messages
for each row execute function public.luminova_guard_message();

-- Bloquear desfaz o "seguir" nos dois sentidos (a RLS só deixa cada pessoa apagar o próprio follow).
create or replace function public.luminova_block_cleanup()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and followed_id = new.blocked_id)
      or (follower_id = new.blocked_id and followed_id = new.blocker_id);
  return null;
end; $$;
drop trigger if exists blocks_cleanup on public.blocks;
create trigger blocks_cleanup after insert on public.blocks
for each row execute function public.luminova_block_cleanup();

-- Iniciar conversa respeita bloqueio e a preferência de quem recebe (dm_policy).
create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  dm_policy text not null default 'everyone' check (dm_policy in ('everyone','following','nobody')),
  discoverable boolean not null default true,          -- aparecer em recomendações de pessoas
  allow_ai_memory boolean not null default false,      -- agentes da NOVA BRAIN podem lembrar fatos (opt-in)
  allow_ai_dm boolean not null default true,           -- agentes podem responder mensagens
  show_ai_content boolean not null default true,       -- mostrar publicações de agentes no feed
  personalization boolean not null default true,       -- recomendações por interesses
  updated_at timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
drop policy if exists user_preferences_self on public.user_preferences;
create policy user_preferences_self on public.user_preferences for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.user_preferences to authenticated;

create or replace function public.luminova_pref(uid uuid, key text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case key
    when 'dm_policy' then coalesce((select dm_policy from public.user_preferences where user_id = uid), 'everyone')
    when 'discoverable' then coalesce((select discoverable from public.user_preferences where user_id = uid), true)::text
    when 'allow_ai_memory' then coalesce((select allow_ai_memory from public.user_preferences where user_id = uid), false)::text
    when 'allow_ai_dm' then coalesce((select allow_ai_dm from public.user_preferences where user_id = uid), true)::text
    else null end;
$$;

create or replace function public.luminova_start_conversation(other_user uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); conv uuid; pol text; other_ai boolean;
begin
  if me is null then raise exception 'Entre na sua conta para conversar.'; end if;
  if other_user is null or other_user = me then raise exception 'Escolha outra pessoa para conversar.'; end if;
  select is_ai into other_ai from public.profiles where id = other_user;
  if not found then raise exception 'Perfil não encontrado.'; end if;
  if public.luminova_is_blocked_pair(me, other_user) then
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
    if not coalesce(other_ai, false) then
      pol := public.luminova_pref(other_user, 'dm_policy');
      if pol = 'nobody' then raise exception 'Este perfil não está recebendo novas mensagens.'; end if;
      if pol = 'following' and not exists (select 1 from public.follows where follower_id = other_user and followed_id = me) then
        raise exception 'Este perfil só recebe mensagens de quem ele segue.';
      end if;
    end if;
    insert into public.conversations (created_by, context_type) values (me, 'direct') returning id into conv;
    insert into public.conversation_members (conversation_id, user_id) values (conv, me), (conv, other_user);
  end if;
  return conv;
end; $$;
grant execute on function public.luminova_start_conversation(uuid) to authenticated;

-- Total de conversas com mensagem não lida (badge da navegação).
create or replace function public.luminova_unread_counts()
returns table (messages integer, notifications integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    (select count(*)::int from public.conversation_members cm
       join public.conversations c on c.id = cm.conversation_id
      where cm.user_id = auth.uid() and c.last_sender_id is not null and c.last_sender_id <> auth.uid()
        and (cm.last_read_at is null or c.last_message_at > cm.last_read_at)),
    (select count(*)::int from public.notifications n where n.recipient_id = auth.uid() and n.read_at is null);
$$;
grant execute on function public.luminova_unread_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 1c) COMUNIDADES: membros ativos leem comunidades privadas/ocultas
-- ---------------------------------------------------------------------------
drop policy if exists communities_read_public_or_owner on public.communities;
create policy communities_read_public_or_owner on public.communities for select to anon, authenticated
using (
  visibility = 'public'
  or owner_id = (select auth.uid())
  or public.luminova_is_active_community_member(id)
  or public.luminova_is_admin()
);
grant execute on function public.luminova_is_active_community_member(uuid) to anon, authenticated;

-- Quem tem pedido pendente pode ver a comunidade privada que pediu para entrar (só a linha da comunidade).
create or replace function public.luminova_has_pending_request(target_community uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.community_members m
                  where m.community_id = target_community and m.user_id = auth.uid() and m.status = 'pending');
$$;
grant execute on function public.luminova_has_pending_request(uuid) to authenticated;
drop policy if exists communities_read_pending on public.communities;
create policy communities_read_pending on public.communities for select to authenticated
using (visibility = 'private' and public.luminova_has_pending_request(id));

-- Gestores não podem mover membros entre comunidades nem trocar a pessoa da linha.
create or replace function public.luminova_guard_member_row()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.community_id is distinct from old.community_id or new.user_id is distinct from old.user_id then
    raise exception 'A participação não pode ser transferida.';
  end if;
  return new;
end; $$;
drop trigger if exists community_members_guard_row on public.community_members;
create trigger community_members_guard_row before update on public.community_members
for each row execute function public.luminova_guard_member_row();

-- Transferência de dono: admin global OU operação interna do sistema (exclusão de conta).
create or replace function public.luminova_protect_community_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.owner_id is distinct from old.owner_id and not public.luminova_is_admin() and not public.luminova_system_op() then
    raise exception 'Somente a administração pode transferir uma comunidade.';
  end if;
  return new;
end; $$;

-- Chat da comunidade: autor, gestores e administração removem mensagens.
drop policy if exists luminova_chat_delete on public.community_chat_messages;
create policy luminova_chat_delete on public.community_chat_messages for delete to authenticated
using (user_id = (select auth.uid()) or public.luminova_can_manage_community(community_id) or public.luminova_is_admin());
grant delete on public.community_chat_messages to authenticated;
-- Chat: pessoa banida/bloqueada pelo dono não envia (status 'banned' já não é 'active').

-- ---------------------------------------------------------------------------
-- 1d) USERNAME: único sem diferenciar maiúsculas + cadastro que nunca quebra
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select lower(username) from public.profiles where username is not null group by lower(username) having count(*) > 1) then
    raise notice 'ATENÇÃO: há usernames que só diferem por maiúsculas. O índice único case-insensitive NÃO foi criado. Resolva os duplicados e rode a migração de novo.';
  else
    create unique index if not exists profiles_username_lower_uq on public.profiles (lower(username)) where username is not null;
  end if;
end $$;

-- Nomes reservados (não podem ser usados por pessoas).
create table if not exists public.reserved_usernames (username text primary key);
insert into public.reserved_usernames (username) values
  ('admin'),('administrador'),('administracao'),('suporte'),('luminova'),('lumi'),('nova'),('novabrain'),('nova.brain'),
  ('oficial'),('moderacao'),('moderador'),('sistema'),('root'),('api'),('www'),('perfil'),('comunidades'),('explorar')
on conflict do nothing;
alter table public.reserved_usernames enable row level security;
drop policy if exists reserved_usernames_read on public.reserved_usernames;
create policy reserved_usernames_read on public.reserved_usernames for select to anon, authenticated using (true);
grant select on public.reserved_usernames to anon, authenticated;

create or replace function public.luminova_normalize_username(raw text)
returns text language sql immutable as $$
  select lower(regexp_replace(trim(both '@ ' from coalesce(raw, '')), '\s+', '', 'g'));
$$;

create or replace function public.luminova_username_available(candidate text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u text := public.luminova_normalize_username(candidate);
begin
  if u !~ '^[a-z0-9_.-]{3,30}$' or u ~ '^[._-]' or u ~ '[._-]$' then return false; end if;
  if u like 'ia.%' then return false; end if;                       -- prefixo dos agentes da NOVA BRAIN
  if exists (select 1 from public.reserved_usernames r where r.username = u) then return false; end if;
  return not exists (select 1 from public.profiles p where lower(p.username) = u and p.id is distinct from auth.uid());
end; $$;
grant execute on function public.luminova_username_available(text) to anon, authenticated;

-- Sugestões REALMENTE disponíveis (verificadas no banco antes de devolver).
create or replace function public.luminova_suggest_usernames(candidate text, how_many integer default 3)
returns setof text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  base text := regexp_replace(public.luminova_normalize_username(candidate), '[^a-z0-9_.-]', '', 'g');
  tries text[]; t text; n integer := 0; yr text := to_char(now(), 'YYYY');
begin
  base := left(regexp_replace(base, '^[._-]+|[._-]+$', '', 'g'), 22);
  if length(base) < 3 then base := rpad(coalesce(nullif(base, ''), 'lumi'), 3, 'x'); end if;
  tries := array[base || '_01', base || '.oficial', base || yr, base || '_' || substr(md5(random()::text), 1, 3),
                 'o.' || base, base || '.art', base || '_lumi', base || '_' || (10 + floor(random() * 89))::int];
  foreach t in array tries loop
    exit when n >= greatest(1, least(coalesce(how_many, 3), 6));
    if public.luminova_username_available(t) then n := n + 1; return next t; end if;
  end loop;
  while n < greatest(1, least(coalesce(how_many, 3), 6)) loop
    t := base || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    if public.luminova_username_available(t) then n := n + 1; return next t; end if;
  end loop;
end; $$;
grant execute on function public.luminova_suggest_usernames(text, integer) to anon, authenticated;

-- Documentos legais versionados e aceites
create table if not exists public.legal_documents (
  doc_key text not null check (doc_key in ('terms','privacy')),
  version text not null,
  title text not null,
  url text not null,
  published_at timestamptz not null default now(),
  is_current boolean not null default true,
  primary key (doc_key, version)
);
alter table public.legal_documents enable row level security;
drop policy if exists legal_documents_read on public.legal_documents;
create policy legal_documents_read on public.legal_documents for select to anon, authenticated using (true);
drop policy if exists legal_documents_admin on public.legal_documents;
create policy legal_documents_admin on public.legal_documents for all to authenticated
using (public.luminova_is_admin()) with check (public.luminova_is_admin());
grant select on public.legal_documents to anon, authenticated;
grant insert, update on public.legal_documents to authenticated;
insert into public.legal_documents (doc_key, version, title, url) values
  ('terms', '2026-10-30', 'Termos de Uso da LUMINOVA', 'termos.html'),
  ('privacy', '2026-10-30', 'Política de Privacidade da LUMINOVA', 'privacidade.html')
on conflict (doc_key, version) do nothing;

create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  doc_key text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  source text not null default 'signup' check (source in ('signup','update','settings')),
  unique (user_id, doc_key, version),
  foreign key (doc_key, version) references public.legal_documents(doc_key, version)
);
alter table public.user_consents enable row level security;
drop policy if exists user_consents_read_self on public.user_consents;
create policy user_consents_read_self on public.user_consents for select to authenticated
using (user_id = (select auth.uid()) or public.luminova_is_admin());
grant select on public.user_consents to authenticated;

-- Aceitar a versão atual (usado quando os documentos mudam).
create or replace function public.luminova_accept_current_documents(p_source text default 'update')
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); n integer;
begin
  if me is null then raise exception 'Entre na sua conta.'; end if;
  insert into public.user_consents (user_id, doc_key, version, source)
  select me, d.doc_key, d.version, case when p_source in ('signup','update','settings') then p_source else 'update' end
    from public.legal_documents d where d.is_current
  on conflict (user_id, doc_key, version) do nothing;
  get diagnostics n = row_count;
  return n;
end; $$;
grant execute on function public.luminova_accept_current_documents(text) to authenticated;

create or replace function public.luminova_pending_documents()
returns table (doc_key text, version text, title text, url text)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.doc_key, d.version, d.title, d.url from public.legal_documents d
   where d.is_current and auth.uid() is not null
     and not exists (select 1 from public.user_consents c
                      where c.user_id = auth.uid() and c.doc_key = d.doc_key and c.version = d.version);
$$;
grant execute on function public.luminova_pending_documents() to authenticated;

-- Cadastro: cria o perfil sem nunca falhar por username (usa alternativa livre) e registra o aceite
-- informado no formulário (metadados terms_version / privacy_version).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted text := public.luminova_normalize_username(coalesce(meta ->> 'username', meta ->> 'nickname'));
  uname text;
  dname text := left(coalesce(nullif(trim(meta ->> 'display_name'), ''), nullif(trim(meta ->> 'name'), ''), 'Novo usuário'), 80);
  is_agent boolean := coalesce(new.email, '') like '%@ia.luminova.invalid';
begin
  if wanted <> '' and (public.luminova_username_available(wanted) or (is_agent and wanted like 'ia.%'
       and not exists (select 1 from public.profiles p where lower(p.username) = wanted))) then
    uname := wanted;
  elsif wanted ~ '^[a-z0-9_.-]{3,30}$' then
    select s into uname from public.luminova_suggest_usernames(wanted, 1) s limit 1;
  else
    uname := null;
  end if;
  insert into public.profiles (id, display_name, username)
  values (new.id, dname, uname)
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id) values (new.id) on conflict (user_id) do nothing;

  if meta ? 'terms_version' then
    insert into public.user_consents (user_id, doc_key, version, source)
    select new.id, d.doc_key, d.version, 'signup' from public.legal_documents d
     where (d.doc_key = 'terms' and d.version = meta ->> 'terms_version')
        or (d.doc_key = 'privacy' and d.version = meta ->> 'privacy_version')
    on conflict do nothing;
  end if;
  return new;
end; $$;

-- Garante preferências para quem já existe.
insert into public.user_preferences (user_id) select id from public.profiles on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 1e) PUBLICAÇÕES: bloqueios, contas privadas, perfis visíveis a visitantes, edição marcada
-- ---------------------------------------------------------------------------
create or replace function public.luminova_can_see_author(author uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select author = auth.uid()
      or (
        not public.luminova_is_blocked_pair(auth.uid(), author)
        and (
          coalesce((select p.account_visibility from public.profiles p where p.id = author), 'public') = 'public'
          or exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followed_id = author)
        )
      );
$$;
grant execute on function public.luminova_can_see_author(uuid) to anon, authenticated;

drop policy if exists posts_read_public on public.posts;
create policy posts_read_public on public.posts for select to anon, authenticated
using (
  deleted_at is null
  and public.luminova_can_see_author(author_id)
  and (
    visibility = 'public'
    or author_id = (select auth.uid())
    or exists (select 1 from public.follows f where f.follower_id = (select auth.uid()) and f.followed_id = author_id)
  )
);
-- Administração modera (soft delete) qualquer publicação.
drop policy if exists posts_admin_moderate on public.posts;
create policy posts_admin_moderate on public.posts for update to authenticated
using (public.luminova_is_admin()) with check (public.luminova_is_admin());
drop policy if exists comments_admin_moderate on public.comments;
create policy comments_admin_moderate on public.comments for update to authenticated
using (public.luminova_is_admin()) with check (public.luminova_is_admin());

-- Visitantes veem perfis públicos (necessário para o feed público e páginas de perfil compartilhadas).
-- Perfis privados: a própria pessoa, quem a segue e quem conversa com ela veem nome e foto.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to anon, authenticated
using (
  account_visibility = 'public'
  or id = (select auth.uid())
  or exists (select 1 from public.follows f where f.follower_id = (select auth.uid()) and f.followed_id = profiles.id)
  or exists (select 1 from public.conversation_members a join public.conversation_members b on a.conversation_id = b.conversation_id
              where a.user_id = (select auth.uid()) and b.user_id = profiles.id)
  or public.luminova_is_admin()
);
grant select on public.profiles to anon, authenticated;

create or replace function public.luminova_mark_post_edit()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.content is distinct from old.content then new.edited_at := now(); end if;
  if new.author_id is distinct from old.author_id then raise exception 'O autor da publicação não pode ser alterado.'; end if;
  return new;
end; $$;
drop trigger if exists posts_mark_edit on public.posts;
create trigger posts_mark_edit before update on public.posts
for each row execute function public.luminova_mark_post_edit();

-- Anti-spam: limites por hora (pessoas). Agentes de IA têm limites próprios em ai_agents.
create or replace function public.luminova_rate_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer; lim integer; uid uuid;
begin
  if auth.uid() is null then return new; end if;               -- service_role / SQL direto
  if tg_table_name = 'posts' then
    uid := new.author_id; lim := 20;
    select count(*) into n from public.posts where author_id = uid and created_at > now() - interval '1 hour';
  elsif tg_table_name = 'comments' then
    uid := new.author_id; lim := 90;
    select count(*) into n from public.comments where author_id = uid and created_at > now() - interval '1 hour';
  elsif tg_table_name = 'messages' then
    uid := new.sender_id; lim := 240;
    select count(*) into n from public.messages where sender_id = uid and created_at > now() - interval '1 hour';
  elsif tg_table_name = 'reports' then
    uid := new.reporter_id; lim := 20;
    select count(*) into n from public.reports where reporter_id = uid and created_at > now() - interval '1 hour';
  else
    return new;
  end if;
  if n >= lim then
    raise exception 'Muitas ações em pouco tempo. Espere alguns minutos e tente de novo.' using errcode = 'P0429';
  end if;
  return new;
end; $$;
do $$ declare t text; begin
  foreach t in array array['posts','comments','messages','reports'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_rate_limit', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.luminova_rate_limit()', t || '_rate_limit', t);
  end loop;
end $$;

-- Itens salvos (favoritos)
create table if not exists public.saved_posts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
alter table public.saved_posts enable row level security;
drop policy if exists saved_posts_self on public.saved_posts;
create policy saved_posts_self on public.saved_posts for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, delete on public.saved_posts to authenticated;

-- ---------------------------------------------------------------------------
-- 3) NOTIFICAÇÕES automáticas (follow, curtida, comentário, resposta, pedido de entrada)
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in ('follow','reaction','comment','reply','mentor_request','mentor_update',
                               'community_invite','community_request','community_approved','gratitude','system'));

drop policy if exists notifications_delete_self on public.notifications;
create policy notifications_delete_self on public.notifications for delete to authenticated
using (recipient_id = (select auth.uid()));
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, delete on public.notifications to authenticated;

create or replace function public.luminova_notify(p_recipient uuid, p_actor uuid, p_type text, p_entity_type text, p_entity uuid, p_message text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  if p_actor is not null and public.luminova_is_blocked_pair(p_recipient, p_actor) then return; end if;
  -- não acumula a mesma notificação repetida (ex.: curtir/descurtir várias vezes)
  if exists (select 1 from public.notifications n where n.recipient_id = p_recipient and n.actor_id is not distinct from p_actor
              and n.notification_type = p_type and n.entity_id is not distinct from p_entity and n.created_at > now() - interval '1 day') then
    return;
  end if;
  insert into public.notifications (recipient_id, actor_id, notification_type, entity_type, entity_id, message)
  values (p_recipient, p_actor, p_type, p_entity_type, p_entity, left(coalesce(p_message, ''), 280));
end; $$;
revoke execute on function public.luminova_notify(uuid, uuid, text, text, uuid, text) from anon, authenticated, public;

create or replace function public.luminova_notify_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare target uuid; parent_author uuid; cname text; r record;
begin
  if tg_table_name = 'follows' then
    perform public.luminova_notify(new.followed_id, new.follower_id, 'follow', 'profile', new.follower_id, 'começou a seguir você');
  elsif tg_table_name = 'post_reactions' then
    select author_id into target from public.posts where id = new.post_id;
    perform public.luminova_notify(target, new.user_id, 'reaction', 'post', new.post_id, 'curtiu sua publicação');
  elsif tg_table_name = 'comments' then
    if new.parent_comment_id is not null then
      select author_id into parent_author from public.comments where id = new.parent_comment_id;
      perform public.luminova_notify(parent_author, new.author_id, 'reply', 'post', new.post_id, 'respondeu seu comentário');
    end if;
    select author_id into target from public.posts where id = new.post_id;
    if target is distinct from parent_author then
      perform public.luminova_notify(target, new.author_id, 'comment', 'post', new.post_id, 'comentou sua publicação');
    end if;
  elsif tg_table_name = 'community_members' then
    select name into cname from public.communities where id = new.community_id;
    if tg_op = 'INSERT' and new.status = 'pending' then
      for r in select m.user_id from public.community_members m
                where m.community_id = new.community_id and m.status = 'active' and m.role in ('owner','admin','moderator') loop
        perform public.luminova_notify(r.user_id, new.user_id, 'community_request', 'community', new.community_id,
          'pediu para entrar em ' || coalesce(cname, 'sua comunidade'));
      end loop;
    elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active' then
      perform public.luminova_notify(new.user_id, auth.uid(), 'community_approved', 'community', new.community_id,
        'aprovou sua entrada em ' || coalesce(cname, 'uma comunidade'));
    end if;
  elsif tg_table_name = 'gratitudes' then
    perform public.luminova_notify(new.recipient_id, new.giver_id, 'gratitude', 'post', new.post_id, 'deixou um agradecimento');
  end if;
  return null;
end; $$;
do $$ declare t text; begin
  foreach t in array array['follows','post_reactions','comments','gratitudes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_notify', t);
    execute format('create trigger %I after insert on public.%I for each row execute function public.luminova_notify_trigger()', t || '_notify', t);
  end loop;
end $$;
drop trigger if exists community_members_notify on public.community_members;
create trigger community_members_notify after insert or update of status on public.community_members
for each row execute function public.luminova_notify_trigger();

-- Realtime das notificações (o sino atualiza sozinho)
do $$ begin alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------------------------------------------------------------------------
-- DENÚNCIAS: captura do conteúdo no momento da denúncia + moderação pela administração
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists target_snapshot text,
  add column if not exists target_owner uuid references public.profiles(id) on delete set null,
  add column if not exists resolution_note text not null default '';
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('profile','post','comment','community','message','community_message'));

create or replace function public.luminova_report_snapshot()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare ok boolean := true;
begin
  if new.target_type = 'post' then
    select left(content, 2000), author_id into new.target_snapshot, new.target_owner from public.posts where id = new.target_id;
  elsif new.target_type = 'comment' then
    select left(content, 2000), author_id into new.target_snapshot, new.target_owner from public.comments where id = new.target_id;
  elsif new.target_type = 'profile' then
    select left(coalesce(display_name,'') || ' @' || coalesce(username,'') || E'\n' || coalesce(bio,''), 2000), id
      into new.target_snapshot, new.target_owner from public.profiles where id = new.target_id;
  elsif new.target_type = 'community' then
    select left(name || E'\n' || description, 2000), owner_id into new.target_snapshot, new.target_owner from public.communities where id = new.target_id;
  elsif new.target_type = 'message' then
    -- só quem participa da conversa pode denunciar uma mensagem privada
    select left(m.content, 2000), m.sender_id into new.target_snapshot, new.target_owner
      from public.messages m where m.id = new.target_id and public.luminova_is_conversation_member(m.conversation_id);
    ok := found;
  elsif new.target_type = 'community_message' then
    select left(m.content, 2000), m.user_id into new.target_snapshot, new.target_owner
      from public.community_chat_messages m where m.id = new.target_id and public.luminova_is_active_community_member(m.community_id);
    ok := found;
  end if;
  if not ok then raise exception 'Você não pode denunciar este conteúdo.'; end if;
  return new;
end; $$;
drop trigger if exists reports_snapshot on public.reports;
create trigger reports_snapshot before insert on public.reports
for each row execute function public.luminova_report_snapshot();

do $$ begin
  if not exists (select 1 from public.reports group by reporter_id, target_type, target_id
                  having count(*) filter (where status in ('open','reviewing')) > 1) then
    create unique index if not exists reports_one_open_per_target
      on public.reports (reporter_id, target_type, target_id) where status in ('open','reviewing');
  end if;
end $$;

drop policy if exists reports_admin_read on public.reports;
create policy reports_admin_read on public.reports for select to authenticated using (public.luminova_is_admin());
drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update on public.reports for update to authenticated
using (public.luminova_is_admin()) with check (public.luminova_is_admin());
grant select, insert on public.reports to authenticated;
grant update (status, reviewed_by, reviewed_at, resolution_note) on public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- 2) LGPD: solicitações de titulares, exportação, exclusão
-- ---------------------------------------------------------------------------
create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  request_type text not null check (request_type in ('access','correction','export','deletion','portability','revoke_consent','information','other')),
  details text not null default '' check (char_length(details) <= 4000),
  status text not null default 'open' check (status in ('open','in_progress','done','rejected')),
  response text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.privacy_requests enable row level security;
drop policy if exists privacy_requests_self_read on public.privacy_requests;
create policy privacy_requests_self_read on public.privacy_requests for select to authenticated
using (user_id = (select auth.uid()) or public.luminova_is_admin());
drop policy if exists privacy_requests_self_insert on public.privacy_requests;
create policy privacy_requests_self_insert on public.privacy_requests for insert to authenticated
with check (user_id = (select auth.uid()) and status = 'open' and response = '');
drop policy if exists privacy_requests_admin_update on public.privacy_requests;
create policy privacy_requests_admin_update on public.privacy_requests for update to authenticated
using (public.luminova_is_admin()) with check (public.luminova_is_admin());
grant select, insert on public.privacy_requests to authenticated;
grant update (status, response, resolved_at) on public.privacy_requests to authenticated;

-- Registro mínimo de exclusões (sem dados pessoais) para prestação de contas.
create table if not exists public.account_deletions (
  id uuid primary key default gen_random_uuid(),
  deleted_at timestamptz not null default now(),
  reason text not null default '' check (char_length(reason) <= 500),
  communities_transferred integer not null default 0,
  communities_deleted integer not null default 0
);
alter table public.account_deletions enable row level security;
drop policy if exists account_deletions_admin on public.account_deletions;
create policy account_deletions_admin on public.account_deletions for select to authenticated using (public.luminova_is_admin());
grant select on public.account_deletions to authenticated;

-- Exportação: tudo o que a pessoa produziu ou que diz respeito a ela, num único JSON.
create or replace function public.luminova_export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Entre na sua conta.'; end if;
  return jsonb_build_object(
    'gerado_em', now(),
    'formato', 'luminova-export/1',
    'conta', (select jsonb_build_object('id', u.id, 'email', u.email, 'criada_em', u.created_at) from auth.users u where u.id = me),
    'perfil', (select to_jsonb(p) from public.profiles p where p.id = me),
    'preferencias', (select to_jsonb(x) from public.user_preferences x where x.user_id = me),
    'progresso', (select to_jsonb(x) from public.profile_progress x where x.user_id = me),
    'interesses', coalesce((select jsonb_agg(jsonb_build_object('interesse', i.name, 'nivel', pi.proficiency))
                    from public.profile_interests pi join public.interests i on i.id = pi.interest_id where pi.profile_id = me), '[]'),
    'publicacoes', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.posts p where p.author_id = me), '[]'),
    'comentarios', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.comments c where c.author_id = me), '[]'),
    'curtidas', coalesce((select jsonb_agg(to_jsonb(r)) from public.post_reactions r where r.user_id = me), '[]'),
    'seguindo', coalesce((select jsonb_agg(f.followed_id) from public.follows f where f.follower_id = me), '[]'),
    'seguidores', coalesce((select jsonb_agg(f.follower_id) from public.follows f where f.followed_id = me), '[]'),
    'bloqueios', coalesce((select jsonb_agg(to_jsonb(b)) from public.blocks b where b.blocker_id = me), '[]'),
    'comunidades', coalesce((select jsonb_agg(jsonb_build_object('comunidade', c.name, 'papel', m.role, 'status', m.status, 'desde', m.joined_at))
                    from public.community_members m join public.communities c on c.id = m.community_id where m.user_id = me), '[]'),
    'mensagens_enviadas', coalesce((select jsonb_agg(jsonb_build_object('conversa', m.conversation_id, 'texto', m.content, 'em', m.created_at, 'apagada_em', m.deleted_at) order by m.created_at)
                    from public.messages m where m.sender_id = me), '[]'),
    'mensagens_chat_comunidades', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.community_chat_messages m where m.user_id = me), '[]'),
    'notificacoes', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from public.notifications n where n.recipient_id = me), '[]'),
    'salvos', coalesce((select jsonb_agg(to_jsonb(s)) from public.saved_posts s where s.user_id = me), '[]'),
    'agradecimentos_dados', coalesce((select jsonb_agg(to_jsonb(g)) from public.gratitudes g where g.giver_id = me), '[]'),
    'agradecimentos_recebidos', coalesce((select jsonb_agg(to_jsonb(g)) from public.gratitudes g where g.recipient_id = me), '[]'),
    'denuncias_feitas', coalesce((select jsonb_agg(jsonb_build_object('tipo', r.target_type, 'motivo', r.reason, 'status', r.status, 'em', r.created_at)) from public.reports r where r.reporter_id = me), '[]'),
    'aceites_documentos', coalesce((select jsonb_agg(to_jsonb(c)) from public.user_consents c where c.user_id = me), '[]'),
    'solicitacoes_privacidade', coalesce((select jsonb_agg(to_jsonb(r)) from public.privacy_requests r where r.user_id = me), '[]'),
    'memorias_nova_brain', coalesce((select jsonb_agg(jsonb_build_object('agente', p.username, 'tipo', m.kind, 'conteudo', m.content, 'criada_em', m.created_at, 'expira_em', m.expires_at))
                    from public.ai_agent_memories m join public.profiles p on p.id = m.agent_id where m.user_id = me), '[]')
  );
end; $$;

-- Exclusão definitiva da conta: transfere ou remove comunidades, apaga auth.users (cascata no perfil
-- e em todo o conteúdo). Arquivos do Storage são removidos ANTES pelo app (API de Storage).
create or replace function public.luminova_delete_my_account(confirm_username text, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid(); mine text; c record; heir uuid; moved integer := 0; dropped integer := 0;
begin
  if me is null then raise exception 'Entre na sua conta.'; end if;
  select username into mine from public.profiles where id = me;
  if mine is null or lower(mine) <> public.luminova_normalize_username(confirm_username) then
    raise exception 'Confirme digitando exatamente o seu nome de usuário.';
  end if;
  if exists (select 1 from public.profiles where id = me and is_ai) then raise exception 'Perfis de IA são geridos pela administração.'; end if;
  perform set_config('luminova.system_op', 'on', true);
  for c in select id from public.communities where owner_id = me loop
    select m.user_id into heir from public.community_members m
     where m.community_id = c.id and m.user_id <> me and m.status = 'active'
     order by case m.role when 'admin' then 0 when 'moderator' then 1 else 2 end, m.joined_at
     limit 1;
    if heir is not null then
      update public.communities set owner_id = heir where id = c.id;
      perform set_config('luminova.role_rpc', 'on', true);
      update public.community_members set role = 'owner' where community_id = c.id and user_id = heir;
      perform set_config('luminova.role_rpc', 'off', true);
      perform public.luminova_notify(heir, null, 'system', 'community', c.id, 'Você agora é dono(a) de uma comunidade cuja pessoa criadora excluiu a conta.');
      moved := moved + 1;
    else
      delete from public.communities where id = c.id;
      dropped := dropped + 1;
    end if;
  end loop;
  update public.privacy_requests set user_id = null where user_id = me;
  insert into public.account_deletions (reason, communities_transferred, communities_deleted)
  values (left(coalesce(p_reason, ''), 500), moved, dropped);
  delete from auth.users where id = me;
  perform set_config('luminova.system_op', 'off', true);
  return jsonb_build_object('ok', true, 'communities_transferred', moved, 'communities_deleted', dropped);
end; $$;
grant execute on function public.luminova_delete_my_account(text, text) to authenticated;

-- O guarda de cargos (Migração 3) também precisa aceitar a operação interna do sistema.
create or replace function public.luminova_guard_community_roles()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    if coalesce(current_setting('luminova.role_rpc', true), '') <> 'on'
       and not public.luminova_is_admin() and not public.luminova_system_op() then
      raise exception 'Use a gestão de cargos da comunidade para alterar papéis.';
    end if;
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- 4) INTERESSES: o catálogo agora cobre hobbies, fandoms, entretenimento e criatividade
-- ---------------------------------------------------------------------------
alter table public.interests add column if not exists category text not null default 'geral';
alter table public.interests add column if not exists icon text not null default 'spark';
insert into public.interests (name, slug, description, category, icon) values
 ('Anime e Mangá','anime-manga','Animes, mangás, temporadas e recomendações','fandoms','tv'),
 ('Séries e Filmes','series-filmes','Maratonas, teorias, trilhas e bastidores','entretenimento','film'),
 ('K-pop e J-pop','kpop-jpop','Grupos, comebacks, coreografias e fandoms','fandoms','music'),
 ('Cosplay','cosplay','Costura, maquiagem, props e eventos','criatividade','mask'),
 ('Fanfics e Fanarts','fanfics-fanarts','Histórias e artes criadas por fãs','fandoms','pen'),
 ('Jogos de Tabuleiro e RPG','tabuleiro-rpg','Mesas, campanhas, mestres e dados','hobbies','dice'),
 ('Desenho e Ilustração','desenho-ilustracao','Sketchbook, digital, tradicional e estudos','criatividade','brush'),
 ('Artesanato e DIY','artesanato-diy','Crochê, bordado, customização e reaproveitamento','criatividade','scissors'),
 ('Culinária','culinaria','Receitas, confeitaria e comida afetiva','hobbies','cup'),
 ('Natureza e Plantas','natureza-plantas','Jardinagem, trilhas e vida ao ar livre','hobbies','leaf'),
 ('Astronomia','astronomia','Céu noturno, planetas e observação','ciencia','orbit'),
 ('Esportes','esportes','Times, treinos, campeonatos e e-sports','hobbies','ball'),
 ('Moda e Estilo','moda-estilo','Looks, brechó, tendências e criação','criatividade','shirt'),
 ('Dança','danca','Coreografias, estilos e aulas','criatividade','wave'),
 ('Pets e Animais','pets-animais','Bichos de estimação e vida animal','hobbies','paw'),
 ('Viagens','viagens','Roteiros, cidades e culturas','hobbies','globe'),
 ('Memes e Humor','memes-humor','Piadas, memes e cultura da internet','entretenimento','smile'),
 ('Bem-estar','bem-estar','Rotina, saúde mental e autocuidado','vida','heart'),
 ('Idiomas','idiomas','Aprender línguas e trocar com nativos','aprendizado','chat'),
 ('Retrô e Nostalgia','retro-nostalgia','Anos 2000, consoles antigos e mídia física','entretenimento','disc'),
 ('Podcasts','podcasts','Programas, áudios e produção','entretenimento','mic'),
 ('Produção Musical','producao-musical','Beats, DAWs, mixagem e composição','criatividade','sliders')
on conflict (slug) do nothing;
update public.interests set category = 'aprendizado', icon = 'code' where slug in ('programacao-tecnologia','desenvolvimento-web') and category = 'geral';
update public.interests set category = 'ciencia', icon = 'cpu' where slug = 'inteligencia-artificial' and category = 'geral';
update public.interests set category = 'entretenimento', icon = 'gamepad' where slug = 'games' and category = 'geral';
update public.interests set category = 'criatividade', icon = 'brush' where slug = 'artes-design' and category = 'geral';
update public.interests set category = 'aprendizado', icon = 'book' where slug = 'estudos' and category = 'geral';
update public.interests set category = 'criatividade', icon = 'music' where slug = 'musica' and category = 'geral';
update public.interests set category = 'criatividade', icon = 'pen' where slug = 'escrita-literatura' and category = 'geral';
update public.interests set category = 'criatividade', icon = 'camera' where slug = 'fotografia' and category = 'geral';
update public.interests set category = 'ciencia', icon = 'chart' where slug = 'ciencia-dados' and category = 'geral';

-- Escolher interesses: a própria pessoa grava (já havia insert/delete); permite atualizar o nível.
drop policy if exists profile_interests_update_self on public.profile_interests;
create policy profile_interests_update_self on public.profile_interests for update to authenticated
using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
grant select, insert, update, delete on public.profile_interests to authenticated;
grant select on public.profile_interests to anon;
drop policy if exists profile_interests_read on public.profile_interests;
create policy profile_interests_read on public.profile_interests for select to anon, authenticated using (true);

-- Comunidades podem ter várias etiquetas de interesse além da categoria principal.
create table if not exists public.community_interests (
  community_id uuid not null references public.communities(id) on delete cascade,
  interest_id uuid not null references public.interests(id) on delete cascade,
  primary key (community_id, interest_id)
);
alter table public.community_interests enable row level security;
drop policy if exists community_interests_read on public.community_interests;
create policy community_interests_read on public.community_interests for select to anon, authenticated using (true);
drop policy if exists community_interests_manage on public.community_interests;
create policy community_interests_manage on public.community_interests for all to authenticated
using (public.luminova_can_manage_community(community_id) or public.luminova_is_admin())
with check (public.luminova_can_manage_community(community_id) or public.luminova_is_admin());
grant select on public.community_interests to anon, authenticated;
grant insert, delete on public.community_interests to authenticated;

-- ---------------------------------------------------------------------------
-- 4b) RECOMENDAÇÕES (só interesses declarados + sinais sociais públicos; nada de mensagens privadas)
-- ---------------------------------------------------------------------------
create or replace function public.luminova_my_interest_ids()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select interest_id from public.profile_interests where profile_id = auth.uid();
$$;

create or replace function public.luminova_recommend_communities(result_limit integer default 6)
returns table (community_id uuid, name text, description text, avatar_url text, cover_url text,
               category_name text, members bigint, reason text, score numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (select public.luminova_my_interest_ids() as iid),
  names as (select lower(i.name) as n, lower(i.slug) as s from public.interests i where i.id in (select iid from mine)),
  cand as (
    select c.*, i.name as cat,
      (select count(*) from public.community_members m where m.community_id = c.id and m.status = 'active') as members,
      (case when c.category_id in (select iid from mine) then 3 else 0 end)
      + (select count(*) * 2 from public.community_interests ci where ci.community_id = c.id and ci.interest_id in (select iid from mine))
      + (select count(*) from names nm where lower(c.name || ' ' || c.description) like '%' || split_part(nm.n, ' ', 1) || '%') as match
    from public.communities c left join public.interests i on i.id = c.category_id
    where c.visibility = 'public'
      and not exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = auth.uid())
      and not public.luminova_is_blocked_pair(auth.uid(), c.owner_id)
  )
  select id, name, description, avatar_url, cover_url, cat, members,
    case when match > 0 then 'Combina com seus interesses' when members > 0 then 'Comunidade ativa' else 'Comunidade nova' end,
    (match * 10 + ln(1 + members))::numeric(10,3)
  from cand
  order by match desc, members desc, created_at desc
  limit greatest(1, least(coalesce(result_limit, 6), 30));
$$;
grant execute on function public.luminova_recommend_communities(integer) to authenticated;

create or replace function public.luminova_recommend_people(result_limit integer default 6, include_ai boolean default false)
returns table (user_id uuid, username text, display_name text, avatar_url text, bio text, is_ai boolean,
               shared_interests text[], mutuals bigint, score numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (select public.luminova_my_interest_ids() as iid),
  cand as (
    select p.id, p.username, p.display_name, p.avatar_url, p.bio, p.is_ai,
      array(select i.name from public.profile_interests pi join public.interests i on i.id = pi.interest_id
             where pi.profile_id = p.id and pi.interest_id in (select iid from mine) order by i.name limit 3) as shared,
      (select count(*) from public.follows a join public.follows b on b.follower_id = a.followed_id
        where a.follower_id = auth.uid() and b.followed_id = p.id) as mutuals
    from public.profiles p
    where p.id <> auth.uid() and p.account_visibility = 'public'
      and (include_ai or not p.is_ai)
      and public.luminova_pref(p.id, 'discoverable')::boolean
      and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followed_id = p.id)
      and not public.luminova_is_blocked_pair(auth.uid(), p.id)
  )
  select id, username, display_name, avatar_url, bio, is_ai, shared, mutuals,
         (coalesce(array_length(shared, 1), 0) * 3 + mutuals * 2)::numeric
  from cand
  where coalesce(array_length(shared, 1), 0) > 0 or mutuals > 0 or is_ai
  order by 9 desc, display_name
  limit greatest(1, least(coalesce(result_limit, 6), 30));
$$;
grant execute on function public.luminova_recommend_people(integer, boolean) to authenticated;

create or replace function public.luminova_recommend_posts(result_limit integer default 20, result_offset integer default 0)
returns setof public.v_feed_posts language sql stable security invoker set search_path = public as $$
  with mine as (select public.luminova_my_interest_ids() as iid)
  select v.* from public.v_feed_posts v
  where v.author_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  order by
    ((case when v.interest_id in (select iid from mine) then 3 else 0 end)
     + (case when exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followed_id = v.author_id) then 4 else 0 end)
     + (case when exists (select 1 from public.community_posts cp join public.community_members m on m.community_id = cp.community_id
                           where cp.post_id = v.post_id and m.user_id = auth.uid() and m.status = 'active') then 3 else 0 end)
     + least(v.reaction_count + v.comment_count, 20) * 0.15
     - extract(epoch from (now() - v.created_at)) / 86400.0) desc
  limit greatest(1, least(coalesce(result_limit, 20), 50))
  offset greatest(coalesce(result_offset, 0), 0);
$$;
grant execute on function public.luminova_recommend_posts(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) NOVA BRAIN: agentes com personalidade, memória com consentimento e relações
-- ---------------------------------------------------------------------------
alter table public.ai_agents
  add column if not exists personality jsonb not null default '{}'::jsonb,
  add column if not exists active_hours int[] not null default '{8,23}',
  add column if not exists max_messages_per_day integer not null default 30 check (max_messages_per_day between 0 and 200),
  add column if not exists max_agent_replies_per_day integer not null default 2 check (max_agent_replies_per_day between 0 and 10);

alter table public.ai_activity_log drop constraint if exists ai_activity_log_action_check;
alter table public.ai_activity_log add constraint ai_activity_log_action_check
  check (action in ('post','comment','skip','message','agent_reply','follow','join','memory','community_chat'));

drop policy if exists ai_agents_read on public.ai_agents;
create policy ai_agents_read on public.ai_agents for select to anon, authenticated using (true);
grant select on public.ai_agents to anon;
grant update (enabled, max_posts_per_day, max_comments_per_day, min_minutes_between_actions, persona, style, interests,
              personality, active_hours, max_messages_per_day, max_agent_replies_per_day) on public.ai_agents to authenticated;

-- Histórico público de atividade de cada agente (sem os "skip" e sem conteúdo de mensagens privadas).
create or replace view public.v_ai_public_activity with (security_invoker = false) as
  select l.agent_id, l.action, l.target_id, l.created_at,
         case when l.action in ('post','comment','agent_reply') then left(l.details, 280) else '' end as details
    from public.ai_activity_log l
   where l.action in ('post','comment','agent_reply','join','follow');
grant select on public.v_ai_public_activity to anon, authenticated;

create table if not exists public.ai_agent_memories (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.ai_agents(profile_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('name','likes','dislikes','location','fact','topic','summary')),
  content text not null check (char_length(content) between 1 and 300),
  embedding real[],
  salience real not null default 0.5,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null default now() + interval '180 days',
  unique (agent_id, user_id, kind, content)
);
create index if not exists ai_agent_memories_pair_idx on public.ai_agent_memories (agent_id, user_id, created_at desc);
alter table public.ai_agent_memories enable row level security;
-- A pessoa vê e apaga o que os agentes lembram sobre ela. Só o backend (service_role) grava.
drop policy if exists ai_memories_self_read on public.ai_agent_memories;
create policy ai_memories_self_read on public.ai_agent_memories for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists ai_memories_self_delete on public.ai_agent_memories;
create policy ai_memories_self_delete on public.ai_agent_memories for delete to authenticated using (user_id = (select auth.uid()));
grant select, delete on public.ai_agent_memories to authenticated;

-- Nada é lembrado sem consentimento: o banco recusa a gravação se a pessoa não ativou a memória.
create or replace function public.luminova_guard_ai_memory()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.luminova_pref(new.user_id, 'allow_ai_memory')::boolean then
    raise exception 'A pessoa não autorizou a memória dos agentes.';
  end if;
  return new;
end; $$;
drop trigger if exists ai_agent_memories_guard on public.ai_agent_memories;
create trigger ai_agent_memories_guard before insert on public.ai_agent_memories
for each row execute function public.luminova_guard_ai_memory();

-- Desligar a memória apaga o que já foi lembrado.
create or replace function public.luminova_forget_on_optout()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.allow_ai_memory and not new.allow_ai_memory then
    delete from public.ai_agent_memories where user_id = new.user_id;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists user_preferences_forget on public.user_preferences;
create trigger user_preferences_forget before update on public.user_preferences
for each row execute function public.luminova_forget_on_optout();

create table if not exists public.ai_agent_relations (
  agent_id uuid not null references public.ai_agents(profile_id) on delete cascade,
  other_agent_id uuid not null references public.ai_agents(profile_id) on delete cascade,
  affinity real not null default 0.5 check (affinity between 0 and 1),
  kind text not null default 'colega' check (kind in ('colega','amizade','parceria criativa','rivalidade amigável','mentoria')),
  note text not null default '',
  interactions integer not null default 0,
  last_interaction_at timestamptz,
  primary key (agent_id, other_agent_id),
  check (agent_id <> other_agent_id)
);
alter table public.ai_agent_relations enable row level security;
drop policy if exists ai_relations_read on public.ai_agent_relations;
create policy ai_relations_read on public.ai_agent_relations for select to anon, authenticated using (true);
grant select on public.ai_agent_relations to anon, authenticated;

-- Limites por tipo de ação + horário de atividade (fuso de Brasília).
create or replace function public.luminova_ai_can_act(p_agent uuid, p_action text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.ai_agents; v_today integer; v_hour integer; v_limit integer;
begin
  select * into a from public.ai_agents where profile_id = p_agent;
  if not found or not a.enabled then return false; end if;
  v_hour := extract(hour from (now() at time zone 'America/Sao_Paulo'))::int;
  if p_action <> 'message' and array_length(a.active_hours, 1) = 2
     and not (v_hour >= a.active_hours[1] and v_hour < a.active_hours[2]) then
    return false;
  end if;
  if p_action in ('post','comment','agent_reply','community_chat') and a.last_action_at is not null
     and a.last_action_at > now() - make_interval(mins => a.min_minutes_between_actions) then
    return false;
  end if;
  select count(*) into v_today from public.ai_activity_log
   where agent_id = p_agent and action = p_action and created_at >= date_trunc('day', now());
  v_limit := case p_action
    when 'post' then a.max_posts_per_day
    when 'comment' then a.max_comments_per_day
    when 'message' then a.max_messages_per_day
    when 'agent_reply' then a.max_agent_replies_per_day
    when 'community_chat' then a.max_comments_per_day
    when 'join' then 1
    else 0 end;
  return v_today < v_limit;
end; $$;
revoke execute on function public.luminova_ai_can_act(uuid, text) from anon, authenticated, public;
-- Só o backend dos agentes (service_role) consulta os limites.
grant execute on function public.luminova_ai_can_act(uuid, text) to service_role;

-- Perfil público de um agente (para a página da NOVA BRAIN e o perfil do agente).
create or replace function public.luminova_agent_directory()
returns table (profile_id uuid, username text, display_name text, avatar_url text, cover_url text, bio text,
               persona text, style text, interests text[], personality jsonb, enabled boolean,
               followers bigint, posts bigint, last_action_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.cover_url, p.bio,
         a.persona, a.style, a.interests, a.personality, a.enabled,
         (select count(*) from public.follows f where f.followed_id = p.id),
         (select count(*) from public.posts po where po.author_id = p.id and po.deleted_at is null),
         a.last_action_at
    from public.ai_agents a join public.profiles p on p.id = a.profile_id
   order by p.display_name;
$$;
grant execute on function public.luminova_agent_directory() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) SAÚDE DA PLATAFORMA (somente administração)
-- ---------------------------------------------------------------------------
create or replace function public.luminova_platform_health()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.luminova_is_admin() then raise exception 'Somente a administração.'; end if;
  return jsonb_build_object(
    'schema_version', (select max(version) from public.luminova_schema_versions),
    'pessoas', (select count(*) from public.profiles where not is_ai),
    'novas_contas_7d', (select count(*) from public.profiles where not is_ai and created_at > now() - interval '7 days'),
    'publicacoes_24h', (select count(*) from public.posts where created_at > now() - interval '1 day' and deleted_at is null),
    'comentarios_24h', (select count(*) from public.comments where created_at > now() - interval '1 day' and deleted_at is null),
    'mensagens_24h', (select count(*) from public.messages where created_at > now() - interval '1 day'),
    'comunidades', (select count(*) from public.communities),
    'denuncias_abertas', (select count(*) from public.reports where status in ('open','reviewing')),
    'solicitacoes_privacidade_abertas', (select count(*) from public.privacy_requests where status in ('open','in_progress')),
    'agentes_ligados', (select count(*) from public.ai_agents where enabled),
    'acoes_agentes_24h', (select count(*) from public.ai_activity_log where created_at > now() - interval '1 day' and action <> 'skip'),
    'pulos_agentes_24h', (select count(*) from public.ai_activity_log where created_at > now() - interval '1 day' and action = 'skip'),
    'exclusoes_30d', (select count(*) from public.account_deletions where deleted_at > now() - interval '30 days')
  );
end; $$;
grant execute on function public.luminova_platform_health() to authenticated;

-- ---------------------------------------------------------------------------
-- Índices de apoio
-- ---------------------------------------------------------------------------
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);
create index if not exists comments_author_idx on public.comments (author_id, created_at desc);
create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc);
create index if not exists post_reactions_user_idx on public.post_reactions (user_id);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);
create index if not exists privacy_requests_status_idx on public.privacy_requests (status, created_at);
create index if not exists profile_interests_interest_idx on public.profile_interests (interest_id);

commit;

-- Verificação (execute separadamente):
-- select * from public.luminova_schema_versions order by version;
-- select public.luminova_username_available('estrela'), array(select public.luminova_suggest_usernames('estrela'));
