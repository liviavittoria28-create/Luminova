-- LUMINOVA | Migração complementar segura e idempotente
-- A promoção da conta administradora está em Promover-admin-livinha.sql e é separada.
-- Execute no Supabase > SQL Editor, após conferir o esquema atual.
-- Não apaga publicações, comentários, perfis ou comunidades existentes.
begin;

-- 1) Personalização, XP e Skill Tree
alter table public.profiles
  add column if not exists profile_settings jsonb not null default '{}'::jsonb,
  add column if not exists cover_url text,
  add column if not exists role text not null default 'learner';

create table if not exists public.profile_progress (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  xp integer not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  skills jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) Tópico do dia administrável
create table if not exists public.daily_topics (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  topic_date date not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) Índices para pesquisa global e comentários
create index if not exists profiles_username_search_idx on public.profiles (lower(username));
create index if not exists profiles_display_name_search_idx on public.profiles (lower(display_name));
create index if not exists communities_name_search_idx on public.communities (lower(name));
create index if not exists comments_post_created_idx on public.comments (post_id, created_at) where deleted_at is null;
create index if not exists posts_content_search_idx on public.posts using gin (to_tsvector('portuguese', coalesce(content,'')));

-- 4) Corrige leitura de comentários: quem consegue ver a publicação pode ler comentários.
-- Comentários de posts privados/para seguidores continuam protegidos pelas condições abaixo.
drop policy if exists comments_read on public.comments;
drop policy if exists comments_read_visible_post on public.comments;
create policy comments_read_visible_post on public.comments
for select to anon, authenticated
using (
  deleted_at is null
  and exists (
    select 1 from public.posts p
    where p.id = comments.post_id
      and p.deleted_at is null
      and (
        p.visibility = 'public'
        or p.author_id = (select auth.uid())
        or exists (
          select 1 from public.follows f
          where f.follower_id = (select auth.uid())
            and f.followed_id = p.author_id
        )
      )
  )
);

drop policy if exists comments_insert_self on public.comments;
create policy comments_insert_self on public.comments
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.posts p
    where p.id = comments.post_id and p.deleted_at is null
      and (p.visibility = 'public' or p.author_id = (select auth.uid())
        or exists (select 1 from public.follows f where f.follower_id = (select auth.uid()) and f.followed_id = p.author_id))
  )
);

grant select on public.comments to anon, authenticated;
grant insert, update, delete on public.comments to authenticated;
grant select on public.profiles to anon, authenticated;
grant select on public.posts to anon, authenticated;

-- 5) RLS para as tabelas novas
alter table public.profile_progress enable row level security;
alter table public.daily_topics enable row level security;

drop policy if exists profile_progress_read on public.profile_progress;
create policy profile_progress_read on public.profile_progress
for select to anon, authenticated using (true);
-- XP é somente leitura para usuários: a concessão deve ocorrer por backend/RPC confiável.
-- Não criamos políticas de INSERT/UPDATE para membros comuns, evitando autoatribuição de XP.
drop policy if exists daily_topics_read on public.daily_topics;
create policy daily_topics_read on public.daily_topics
for select to anon, authenticated using (true);
drop policy if exists daily_topics_admin_insert on public.daily_topics;
create policy daily_topics_admin_insert on public.daily_topics
for insert to authenticated with check (exists (
  select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
));
drop policy if exists daily_topics_admin_update on public.daily_topics;
create policy daily_topics_admin_update on public.daily_topics
for update to authenticated using (exists (
  select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
)) with check (exists (
  select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
));
grant select on public.daily_topics to anon, authenticated;
grant insert, update on public.daily_topics to authenticated;
grant select on public.profile_progress to authenticated, anon;

-- 6) Diretório de pesquisa global. RLS das tabelas base continua valendo.
create or replace view public.v_global_search
with (security_invoker = true) as
  select 'profile'::text as result_type, p.id as result_id,
         coalesce(nullif(p.display_name,''), p.username, 'Perfil')::text as title,
         coalesce('@' || p.username, p.bio, '')::text as subtitle,
         p.avatar_url as image_url, p.created_at
  from public.profiles p
  union all
  select 'community'::text, c.id,
         c.name::text, c.description::text, c.avatar_url, c.created_at
  from public.communities c
  where c.visibility = 'public'
  union all
  select 'post'::text, p.id,
         left(p.content, 160)::text,
         coalesce(pr.display_name, pr.username, 'Membro')::text,
         pr.avatar_url, p.created_at
  from public.posts p join public.profiles pr on pr.id = p.author_id
  where p.deleted_at is null and p.visibility = 'public';
grant select on public.v_global_search to anon, authenticated;

-- 7) Criar registros de progressão para perfis atuais e novos.
insert into public.profile_progress (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

create or replace function public.luminova_create_profile_progress()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profile_progress (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end; $$;
drop trigger if exists profiles_create_progress on public.profiles;
create trigger profiles_create_progress after insert on public.profiles
for each row execute function public.luminova_create_profile_progress();

-- Concede XP automaticamente por atividade persistida; o cliente não pode editar o saldo.
create or replace function public.luminova_award_activity_xp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_award integer;
begin
  if tg_table_name = 'posts' then
    v_user := new.author_id;
    v_award := 10;
  else
    v_user := new.author_id;
    v_award := 3;
  end if;
  insert into public.profile_progress (user_id, xp, level)
  values (v_user, v_award, 1 + floor(v_award / 100.0)::integer)
  on conflict (user_id) do update
    set xp = public.profile_progress.xp + v_award,
        level = 1 + floor((public.profile_progress.xp + v_award) / 100.0)::integer,
        updated_at = now();
  return new;
end; $$;
drop trigger if exists posts_award_activity_xp on public.posts;
create trigger posts_award_activity_xp after insert on public.posts
for each row execute function public.luminova_award_activity_xp();
drop trigger if exists comments_award_activity_xp on public.comments;
create trigger comments_award_activity_xp after insert on public.comments
for each row execute function public.luminova_award_activity_xp();

-- 8) Regra de limite de comunidades por XP. Admins não têm limite.
create or replace function public.luminova_community_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_xp integer := 0;
  v_active_count integer := 0;
  v_limit integer := 3;
begin
  select role into v_role from public.profiles where id = new.owner_id;
  if v_role = 'admin' then return new; end if;
  select coalesce(xp, 0) into v_xp from public.profile_progress where user_id = new.owner_id;
  if coalesce(v_xp, 0) >= 500 then v_limit := 5; end if;
  select count(*) into v_active_count from public.community_members
    where user_id = new.owner_id and status = 'active';
  if v_active_count >= v_limit then
    raise exception 'Limite de comunidades atingido (%). Ganhe XP para desbloquear até 5 comunidades.', v_limit;
  end if;
  return new;
end; $$;
drop trigger if exists communities_limit_before_insert on public.communities;
create trigger communities_limit_before_insert before insert on public.communities
for each row execute function public.luminova_community_limit();

create or replace function public.luminova_member_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_xp integer := 0;
  v_count integer := 0;
  v_limit integer := 3;
begin
  if new.status <> 'active' then return new; end if;
  select role into v_role from public.profiles where id = new.user_id;
  if v_role = 'admin' then return new; end if;
  select coalesce(xp, 0) into v_xp from public.profile_progress where user_id = new.user_id;
  if coalesce(v_xp, 0) >= 500 then v_limit := 5; end if;
  select count(*) into v_count from public.community_members
    where user_id = new.user_id and status = 'active' and community_id <> new.community_id;
  if v_count >= v_limit then
    raise exception 'Limite de comunidades atingido (%). Ganhe XP para desbloquear até 5 comunidades.', v_limit;
  end if;
  return new;
end; $$;
drop trigger if exists community_members_limit_before_write on public.community_members;
create trigger community_members_limit_before_write before insert or update on public.community_members
for each row execute function public.luminova_member_limit();


commit;

-- Consulta de verificação (execute separadamente após a migração):
-- select id, username, display_name, role from public.profiles where lower(username) = 'livinha';
-- select * from public.v_global_search where title ilike '%python%' limit 20;
-- select id, post_id, author_id, content, created_at from public.comments where deleted_at is null order by created_at desc limit 30;
