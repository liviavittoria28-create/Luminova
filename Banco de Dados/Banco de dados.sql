-- ============================================================================
-- LUMINOVA
-- ============================================================================


begin;

-- ============================================================================
-- 1. EXTENSÕES
-- ============================================================================
-- pgcrypto traz o gen_random_uuid() que a gente usa como chave primária.
create extension if not exists pgcrypto;

-- ============================================================================
-- 2. PERFIS
-- ============================================================================
-- O id é o mesmo UUID do usuário autenticado. Assim a gente faz JOIN direto com auth.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null default 'Novo usuário',
  bio text not null default '',
  avatar_url text,
  location text,
  website_url text,
  account_visibility text not null default 'public' check (account_visibility in ('public','private')),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username is null or username ~ '^[a-zA-Z0-9_.-]{3,30}$')
);

-- Campos de personalização (tema, layout, capa).
alter table public.profiles
  add column if not exists profile_settings jsonb not null default '{}'::jsonb,
  add column if not exists cover_url text,
  add column if not exists role text not null default 'learner';

-- ============================================================================
-- 3. INTERESSES
-- ============================================================================
-- Catálogo de assuntos/tags. Aparece em posts, comunidades e no perfil do usuário.
create table if not exists public.interests (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  created_at timestamptz not null default now()
);

-- Relação N:N entre perfis e interesses, com nível de proficiência.
create table if not exists public.profile_interests (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  interest_id uuid not null references public.interests(id) on delete cascade,
  proficiency text not null default 'curioso' check (proficiency in ('curioso','iniciante','intermediario','avancado','especialista')),
  created_at timestamptz not null default now(),
  primary key(profile_id, interest_id)
);

-- ============================================================================
-- 4. RELAÇÕES SOCIAIS
-- ============================================================================
-- Seguidores: quem segue quem. Chave composta evita duplicata.
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(follower_id, followed_id),
  check (follower_id <> followed_id)
);

-- Bloqueios: quem bloqueou quem. Não deixa a pessoa se bloquear sozinha.
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ============================================================================
-- 5. FEED GERAL
-- ============================================================================
-- Posts do feed. visibility diz se é público ou só pros seguidores.
-- deleted_at é o soft delete (guarda histórico, some do feed).
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  interest_id uuid references public.interests(id) on delete set null,
  content text not null,
  post_type text not null default 'text' check (post_type in ('text','question','discovery','link')),
  link_url text,
  media_urls text[] not null default '{}',
  visibility text not null default 'public' check (visibility in ('public','followers')),
  is_pinned boolean not null default false,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint post_content_length check (char_length(content) between 1 and 10000)
);

-- Índices do feed: ordenação por data, filtro por autor e por interesse.
create index if not exists posts_feed_idx on public.posts (created_at desc) where deleted_at is null;
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);
create index if not exists posts_interest_idx on public.posts (interest_id, created_at desc);

-- Comentários com respostas encadeadas (parent_comment_id).
-- is_best_answer marca a melhor resposta em post de dúvida.
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_comment_id uuid references public.comments(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 5000),
  is_best_answer boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists comments_post_idx on public.comments(post_id, created_at);

-- Reações a posts. Uma pessoa pode reagir com vários tipos diferentes.
create table if not exists public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like','useful','insightful','support')),
  created_at timestamptz not null default now(),
  primary key(post_id, user_id, reaction)
);

-- Reações a comentários. Tipos mais simples.
create table if not exists public.comment_reactions (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like','useful')),
  created_at timestamptz not null default now(),
  primary key(comment_id, user_id, reaction)
);

-- ============================================================================
-- 6. COMUNIDADES
-- ============================================================================
-- Comunidades têm dono, visibilidade (public/private/hidden) e política de entrada.
create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(name) between 3 and 80),
  slug text not null unique,
  description text not null default '',
  category_id uuid references public.interests(id) on delete set null,
  avatar_url text,
  cover_url text,
  visibility text not null default 'public' check (visibility in ('public','private','hidden')),
  join_policy text not null default 'open' check (join_policy in ('open','approval','invite')),
  rules text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Campos de personalização e texto de boas-vindas.
alter table public.communities
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists cover_url text,
  add column if not exists avatar_url text,
  add column if not exists welcome_text text not null default '',
  add column if not exists updated_at timestamptz not null default now();

create index if not exists communities_category_idx on public.communities(category_id);

-- Membros da comunidade com papel (owner/moderator/member) e status.
-- status 'pending' = esperando aprovação; 'active' = membro; 'banned' = banido.
create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','moderator','member')),
  status text not null default 'active' check (status in ('pending','active','banned')),
  joined_at timestamptz not null default now(),
  primary key(community_id, user_id)
);
create index if not exists community_members_user_idx on public.community_members(user_id, joined_at desc);

-- Relação N:N entre posts e comunidades. Um post pertence a no máximo uma comunidade.
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  post_id uuid not null unique references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 7. SUBCOMUNIDADES
-- ============================================================================
-- Subcomunidades são divisões dentro de uma comunidade (tipo "Dúvidas", "Projetos").
create table if not exists public.community_subcommunities (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 500),
  cover_url text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists community_subcommunities_parent_idx
  on public.community_subcommunities(community_id, created_at desc);

-- ============================================================================
-- 8. CHAT DA COMUNIDADE
-- ============================================================================
-- Mensagens do chat geral (subcommunity_id NULL) e dos chats de subcomunidades.
create table if not exists public.community_chat_messages (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  subcommunity_id uuid references public.community_subcommunities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '' check (char_length(content) <= 5000),
  media_url text,
  media_type text check (media_type is null or media_type in ('image','video')),
  created_at timestamptz not null default now(),
  constraint community_chat_message_has_content
    check (char_length(trim(content)) > 0 or media_url is not null)
);
create index if not exists community_chat_messages_room_idx
  on public.community_chat_messages(community_id, subcommunity_id, created_at desc);

-- ============================================================================
-- 9. RECURSOS DA COMUNIDADE
-- ============================================================================
-- Materiais didáticos que mentores/moderadores postam (vídeos, PDFs, links).
create table if not exists public.community_resources (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  resource_type text not null check (resource_type in ('video','image','document','link','text')),
  file_url text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists community_resources_order_idx on public.community_resources(community_id, position, created_at desc);

-- ============================================================================
-- 10. MENTOR MATCHING
-- ============================================================================
-- Perfil de mentor/mentorado. is_mentor=true significa disponível pra mentorar.
create table if not exists public.mentor_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  headline text not null default '',
  mentoring_bio text not null default '',
  is_mentor boolean not null default false,
  is_seeking_mentor boolean not null default false,
  experience_level text not null default 'iniciante' check (experience_level in ('iniciante','intermediario','avancado','especialista')),
  mentoring_style text,
  availability text,
  languages text[] not null default '{pt-BR}',
  goals text[] not null default '{}',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Habilidades do mentor. Usado pra dar match com os interesses do mentorado.
create table if not exists public.mentor_skills (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.mentor_profiles(user_id) on delete cascade,
  skill_name text not null,
  skill_level text not null default 'intermediario' check (skill_level in ('iniciante','intermediario','avancado','especialista')),
  years_experience numeric(4,1) check (years_experience is null or years_experience >= 0),
  unique(mentor_id, skill_name)
);

-- Solicitações de mentoria. O status controla o fluxo.
create table if not exists public.mentor_requests (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.mentor_profiles(user_id) on delete cascade,
  mentee_id uuid not null references public.profiles(id) on delete cascade,
  goal text not null,
  message text not null default '',
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mentor_id <> mentee_id),
  unique(mentor_id, mentee_id, status)
);
create index if not exists mentor_requests_mentee_idx on public.mentor_requests(mentee_id, created_at desc);

-- Sessões de mentoria agendadas a partir de uma solicitação aceita.
create table if not exists public.mentor_sessions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.mentor_requests(id) on delete cascade,
  scheduled_at timestamptz,
  duration_minutes integer not null default 30 check (duration_minutes between 15 and 240),
  meeting_url text,
  notes text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),
  created_at timestamptz not null default now()
);

-- Avaliações de sessões concluídas. Uma review por sessão.
create table if not exists public.mentor_reviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.mentor_sessions(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewee_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now(),
  check (reviewer_id <> reviewee_id)
);

-- ============================================================================
-- 11. CONVERSAS / MENSAGENS PRIVADAS
-- ============================================================================
-- Conversas diretas ou de mentoria. context_type diferencia.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  context_type text not null default 'direct' check (context_type in ('direct','mentor')),
  created_at timestamptz not null default now()
);

-- Participantes da conversa. last_read_at controla o badge de não lidas.
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key(conversation_id, user_id)
);

-- Mensagens privadas. deleted_at é o soft delete.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 10000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  deleted_at timestamptz
);
create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);

-- ============================================================================
-- 12. NOTIFICAÇÕES, TENDÊNCIAS, DENÚNCIAS, RECONHECIMENTO
-- ============================================================================
-- Notificações pro usuário. actor_id é quem gerou o evento.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  notification_type text not null check (notification_type in ('follow','reaction','comment','reply','mentor_request','mentor_update','community_invite','system')),
  entity_type text,
  entity_id uuid,
  message text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id, created_at desc);

-- Tópicos em alta calculados por janela de tempo (cron/backend).
create table if not exists public.trending_topics (
  id uuid primary key default gen_random_uuid(),
  interest_id uuid references public.interests(id) on delete set null,
  label text not null,
  slug text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  post_count integer not null default 0 check (post_count >= 0),
  interaction_count integer not null default 0 check (interaction_count >= 0),
  score numeric(12,3) not null default 0,
  created_at timestamptz not null default now(),
  unique(slug, window_start),
  check (window_end > window_start)
);

-- Denúncias de conteúdo/usuários. O status controla a moderação.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('profile','post','comment','community','message')),
  target_id uuid not null,
  reason text not null check (reason in ('spam','harassment','hate','misinformation','inappropriate','impersonation','other')),
  details text not null default '',
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reports_status_idx on public.reports(status, created_at);

-- Reconhecimento de contribuições (badges informais).
create table if not exists public.contribution_recognition (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  giver_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  recognition_type text not null check (recognition_type in ('helpful','great_explanation','welcoming','mentor','creative')),
  note text not null default '',
  created_at timestamptz not null default now(),
  check (recipient_id <> giver_id),
  check ((post_id is not null)::int + (comment_id is not null)::int = 1)
);

-- ============================================================================
-- 13. TRIGGERS DE updated_at
-- ============================================================================
-- Função genérica que atualiza updated_at = now() em UPDATE.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- Aplica o trigger em todas as tabelas que têm updated_at.
do $$ declare t text; begin
  foreach t in array array['profiles','posts','comments','communities','mentor_profiles','mentor_requests'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ============================================================================
-- 14. TRIGGER: CRIAR PERFIL APÓS CADASTRO
-- ============================================================================
-- Quando alguém se cadastra no Supabase Auth, cria automaticamente
-- uma linha em profiles com o display_name vindo dos metadados.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, username)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name',''), nullif(new.raw_user_meta_data ->> 'name',''), 'Novo usuário'),
    nullif(new.raw_user_meta_data ->> 'username','')
  ) on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- ============================================================================
-- 15. TRIGGER: DONO VIROU MEMBRO AUTOMÁTICO
-- ============================================================================
-- Ao criar uma comunidade, insere o dono em community_members com role='owner'.
create or replace function public.add_community_owner_as_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.community_members (community_id, user_id, role, status)
  values (new.id, new.owner_id, 'owner', 'active')
  on conflict (community_id, user_id) do update set role = 'owner', status = 'active';
  return new;
end; $$;

drop trigger if exists community_owner_membership on public.communities;
create trigger community_owner_membership
after insert on public.communities
for each row execute function public.add_community_owner_as_member();

-- ============================================================================
-- 16. TRIGGER: IMPEDIR ESCALADA DE PAPEL
-- ============================================================================
-- Ninguém pode mudar o próprio role pra algo além de 'learner'.
-- Só administrador (via service_role ou SQL direto) promove alguém.
create or replace function public.prevent_self_role_escalation()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' and new.role is distinct from 'learner' then
      raise exception 'O papel inicial deve ser learner; somente um administrador pode promover a conta.';
    elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'A alteração de papel deve ser feita por um administrador confiável.';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists profiles_prevent_role_escalation on public.profiles;
create trigger profiles_prevent_role_escalation before insert or update on public.profiles
for each row execute function public.prevent_self_role_escalation();

-- ============================================================================
-- 17. FUNÇÕES AUXILIARES DE AUTORIZAÇÃO (SECURITY DEFINER)
-- ============================================================================
-- SECURITY DEFINER faz a função rodar com privilégio do criador (postgres),
-- ignorando RLS das tabelas internas. Isso evita recursão infinita em política
-- que consultaria a própria tabela.

-- Verifica se o usuário atual é membro ATIVO da comunidade.
create or replace function public.luminova_is_active_community_member(target_community uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.community_members m
    where m.community_id = target_community
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

-- Verifica se o usuário atual pode VER a comunidade (pública, dono ou membro ativo).
create or replace function public.luminova_can_view_community(target_community uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.communities c
    where c.id = target_community
      and (c.visibility = 'public'
        or c.owner_id = auth.uid()
        or exists (
          select 1 from public.community_members m
          where m.community_id = c.id
            and m.user_id = auth.uid()
            and m.status = 'active'
        ))
  );
$$;

-- Verifica se o usuário atual pode GERENCIAR a comunidade (dono ou moderador ativo).
create or replace function public.luminova_can_manage_community(target_community uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.communities c
    where c.id = target_community and c.owner_id = auth.uid()
  ) or exists (
    select 1 from public.community_members m
    where m.community_id = target_community
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner','moderator')
  );
$$;

-- Verifica se a subcomunidade pertence à comunidade informada.
-- Evita alguém postar em subcomunidade de outra comunidade.
create or replace function public.luminova_subcommunity_matches(target_subcommunity uuid, target_community uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.community_subcommunities s
    where s.id = target_subcommunity and s.community_id = target_community
  );
$$;

-- Versão alternativa de gerenciamento que também considera admins globais.
create or replace function public.can_manage_community(target_community uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.communities c
    where c.id = target_community and c.owner_id = auth.uid()
  ) or exists (
    select 1 from public.community_members m
    where m.community_id = target_community and m.user_id = auth.uid()
      and m.status = 'active' and m.role in ('owner','moderator')
  ) or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Verifica se o usuário pode ENSINAR na comunidade (gerencia ou é mentor global).
create or replace function public.can_teach_in_community(target_community uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_community(target_community) or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'mentor'
  );
$$;

-- Permissões de execução das funções.
grant execute on function public.luminova_is_active_community_member(uuid) to authenticated;
grant execute on function public.luminova_can_view_community(uuid) to anon, authenticated;
grant execute on function public.luminova_can_manage_community(uuid) to authenticated;
grant execute on function public.luminova_subcommunity_matches(uuid, uuid) to authenticated;

-- ============================================================================
-- 18. ROW LEVEL SECURITY — HABILITAR EM TODAS AS TABELAS
-- ============================================================================
-- RLS bloqueia tudo por padrão. As políticas abaixo abrem o necessário.
alter table public.profiles enable row level security;
alter table public.interests enable row level security;
alter table public.profile_interests enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_reactions enable row level security;
alter table public.comment_reactions enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_subcommunities enable row level security;
alter table public.community_chat_messages enable row level security;
alter table public.community_resources enable row level security;
alter table public.mentor_profiles enable row level security;
alter table public.mentor_skills enable row level security;
alter table public.mentor_requests enable row level security;
alter table public.mentor_sessions enable row level security;
alter table public.mentor_reviews enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.trending_topics enable row level security;
alter table public.reports enable row level security;
alter table public.contribution_recognition enable row level security;

-- ============================================================================
-- 19. POLÍTICAS RLS — PERFIS
-- ============================================================================
-- Remove políticas antigas pra evitar OR indesejado.
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;

-- Leitura: perfil público OU o próprio perfil.
create policy profiles_select on public.profiles for select to authenticated
using (account_visibility = 'public' or id = auth.uid());

-- Inserção: só o próprio id.
create policy profiles_insert_self on public.profiles for insert to authenticated
with check (id = auth.uid());

-- Atualização: só o próprio perfil.
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

-- ============================================================================
-- 20. POLÍTICAS RLS — INTERESSES E PERFIL_INTERESSES
-- ============================================================================
drop policy if exists interests_read on public.interests;
create policy interests_read on public.interests for select to anon, authenticated using (true);

drop policy if exists profile_interests_read on public.profile_interests;
create policy profile_interests_read on public.profile_interests for select to authenticated using (true);

drop policy if exists profile_interests_insert_self on public.profile_interests;
create policy profile_interests_insert_self on public.profile_interests for insert to authenticated
with check (profile_id = auth.uid());

drop policy if exists profile_interests_delete_self on public.profile_interests;
create policy profile_interests_delete_self on public.profile_interests for delete to authenticated
using (profile_id = auth.uid());

-- ============================================================================
-- 21. POLÍTICAS RLS — FOLLOWS E BLOCKS
-- ============================================================================
drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select to authenticated using (true);

drop policy if exists follows_insert_self on public.follows;
create policy follows_insert_self on public.follows for insert to authenticated
with check (follower_id = auth.uid());

drop policy if exists follows_delete_self on public.follows;
create policy follows_delete_self on public.follows for delete to authenticated
using (follower_id = auth.uid());

drop policy if exists blocks_read_self on public.blocks;
create policy blocks_read_self on public.blocks for select to authenticated using (blocker_id = auth.uid());

drop policy if exists blocks_insert_self on public.blocks;
create policy blocks_insert_self on public.blocks for insert to authenticated
with check (blocker_id = auth.uid());

drop policy if exists blocks_delete_self on public.blocks;
create policy blocks_delete_self on public.blocks for delete to authenticated
using (blocker_id = auth.uid());

-- ============================================================================
-- 22. POLÍTICAS RLS — FEED E COMENTÁRIOS
-- ============================================================================
drop policy if exists posts_read_public on public.posts;
create policy posts_read_public on public.posts for select to anon, authenticated
using (deleted_at is null and (
  visibility = 'public'
  or author_id = auth.uid()
  or exists(select 1 from public.follows f where f.follower_id = auth.uid() and f.followed_id = author_id)
));

drop policy if exists posts_insert_self on public.posts;
create policy posts_insert_self on public.posts for insert to authenticated
with check (author_id = auth.uid());

drop policy if exists posts_update_self on public.posts;
create policy posts_update_self on public.posts for update to authenticated
using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists posts_delete_self on public.posts;
create policy posts_delete_self on public.posts for delete to authenticated
using (author_id = auth.uid());

drop policy if exists comments_read on public.comments;
drop policy if exists comments_read_visible_post on public.comments;
create policy comments_read_visible_post on public.comments for select to anon, authenticated
using (
  deleted_at is null and exists (
    select 1 from public.posts p where p.id = comments.post_id and p.deleted_at is null
    and (p.visibility = 'public' or p.author_id = (select auth.uid())
      or exists (select 1 from public.follows f where f.follower_id = (select auth.uid()) and f.followed_id = p.author_id))
  )
);

drop policy if exists comments_insert_self on public.comments;
create policy comments_insert_self on public.comments for insert to authenticated
with check (
  author_id = (select auth.uid()) and exists (
    select 1 from public.posts p where p.id = comments.post_id and p.deleted_at is null
    and (p.visibility = 'public' or p.author_id = (select auth.uid())
      or exists (select 1 from public.follows f where f.follower_id = (select auth.uid()) and f.followed_id = p.author_id))
  )
);

drop policy if exists comments_update_self on public.comments;
create policy comments_update_self on public.comments for update to authenticated
using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists comments_delete_self on public.comments;
create policy comments_delete_self on public.comments for delete to authenticated
using (author_id = auth.uid());

drop policy if exists post_reactions_read on public.post_reactions;
create policy post_reactions_read on public.post_reactions for select to authenticated using (true);

drop policy if exists post_reactions_insert_self on public.post_reactions;
create policy post_reactions_insert_self on public.post_reactions for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists post_reactions_delete_self on public.post_reactions;
create policy post_reactions_delete_self on public.post_reactions for delete to authenticated
using (user_id = auth.uid());

drop policy if exists comment_reactions_read on public.comment_reactions;
create policy comment_reactions_read on public.comment_reactions for select to authenticated using (true);

drop policy if exists comment_reactions_insert_self on public.comment_reactions;
create policy comment_reactions_insert_self on public.comment_reactions for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists comment_reactions_delete_self on public.comment_reactions;
create policy comment_reactions_delete_self on public.comment_reactions for delete to authenticated
using (user_id = auth.uid());

-- ============================================================================
-- 23. POLÍTICAS RLS — COMUNIDADES
-- ============================================================================
-- Remove TODAS as políticas antigas de communities e community_members
-- pra evitar recursão infinita causada por OR entre políticas permissivas.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('communities', 'community_members')
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- Leitura de comunidades: pública OU dono. NÃO consulta community_members
-- (evita recursão). Membros de comunidades privadas veem via outras queries.
create policy communities_read_public_or_owner
on public.communities for select to anon, authenticated
using (visibility = 'public' or owner_id = (select auth.uid()));

-- Inserção: só o dono.
create policy communities_insert_owner
on public.communities for insert to authenticated
with check (owner_id = (select auth.uid()));

-- Atualização: só o dono.
create policy communities_update_owner
on public.communities for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

-- Exclusão: só o dono.
create policy communities_delete_owner
on public.communities for delete to authenticated
using (owner_id = (select auth.uid()));

-- Leitura de membros: o próprio usuário OU membros de comunidade visível.
-- A subquery em communities é segura porque a política de communities
-- não consulta community_members.
create policy community_members_read_self_or_visible_community
on public.community_members for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.communities c
    where c.id = community_members.community_id
      and (c.visibility = 'public' or c.owner_id = (select auth.uid()))
  )
);

-- Entrar em comunidade: só a si mesmo, como member, status active/pending.
create policy community_members_join_self
on public.community_members for insert to authenticated
with check (
  user_id = (select auth.uid())
  and role = 'member'
  and status in ('active', 'pending')
);

-- Sair da comunidade: só a si mesmo.
create policy community_members_leave_self
on public.community_members for delete to authenticated
using (user_id = (select auth.uid()));

-- Gerenciar membros: só o dono da comunidade.
create policy community_members_update_owner
on public.community_members for update to authenticated
using (
  exists (select 1 from public.communities c
          where c.id = community_members.community_id
            and c.owner_id = (select auth.uid()))
)
with check (
  exists (select 1 from public.communities c
          where c.id = community_members.community_id
            and c.owner_id = (select auth.uid()))
);

-- ============================================================================
-- 24. POLÍTICAS RLS — COMMUNITY_POSTS
-- ============================================================================
drop policy if exists community_posts_read on public.community_posts;
create policy community_posts_read on public.community_posts for select to authenticated
using (public.luminova_can_view_community(community_id));

drop policy if exists community_posts_insert_member on public.community_posts;
create policy community_posts_insert_member on public.community_posts for insert to authenticated
with check (
  public.luminova_is_active_community_member(community_id)
  and exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
);

drop policy if exists community_posts_delete_owner_or_author on public.community_posts;
create policy community_posts_delete_owner_or_author on public.community_posts for delete to authenticated
using (
  public.luminova_can_manage_community(community_id)
  or exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
);

-- ============================================================================
-- 25. POLÍTICAS RLS — SUBCOMUNIDADES
-- ============================================================================
drop policy if exists luminova_subcommunities_read on public.community_subcommunities;
create policy luminova_subcommunities_read
on public.community_subcommunities for select to anon, authenticated
using (public.luminova_can_view_community(community_id));

drop policy if exists luminova_subcommunities_create on public.community_subcommunities;
create policy luminova_subcommunities_create
on public.community_subcommunities for insert to authenticated
with check (created_by = auth.uid() and public.luminova_can_manage_community(community_id));

drop policy if exists luminova_subcommunities_update on public.community_subcommunities;
create policy luminova_subcommunities_update
on public.community_subcommunities for update to authenticated
using (public.luminova_can_manage_community(community_id))
with check (public.luminova_can_manage_community(community_id));

drop policy if exists luminova_subcommunities_delete on public.community_subcommunities;
create policy luminova_subcommunities_delete
on public.community_subcommunities for delete to authenticated
using (public.luminova_can_manage_community(community_id));

-- ============================================================================
-- 26. POLÍTICAS RLS — CHAT DA COMUNIDADE
-- ============================================================================
-- Só membro ATIVO pode ler e enviar mensagem.
drop policy if exists luminova_chat_read on public.community_chat_messages;
create policy luminova_chat_read
on public.community_chat_messages for select to authenticated
using (public.luminova_is_active_community_member(community_id)
  and (subcommunity_id is null or public.luminova_subcommunity_matches(subcommunity_id, community_id)));

drop policy if exists luminova_chat_send on public.community_chat_messages;
create policy luminova_chat_send
on public.community_chat_messages for insert to authenticated
with check (user_id = auth.uid()
  and public.luminova_is_active_community_member(community_id)
  and (subcommunity_id is null or public.luminova_subcommunity_matches(subcommunity_id, community_id)));

-- ============================================================================
-- 27. POLÍTICAS RLS — RECURSOS DA COMUNIDADE
-- ============================================================================
drop policy if exists community_resources_read on public.community_resources;
create policy community_resources_read on public.community_resources for select to anon, authenticated
using (public.luminova_can_view_community(community_id));

drop policy if exists community_resources_insert_teacher on public.community_resources;
create policy community_resources_insert_teacher on public.community_resources for insert to authenticated
with check (author_id = auth.uid() and public.can_teach_in_community(community_id));

drop policy if exists community_resources_update_teacher on public.community_resources;
create policy community_resources_update_teacher on public.community_resources for update to authenticated
using (public.can_teach_in_community(community_id))
with check (public.can_teach_in_community(community_id));

drop policy if exists community_resources_delete_teacher on public.community_resources;
create policy community_resources_delete_teacher on public.community_resources for delete to authenticated
using (public.can_teach_in_community(community_id));

-- ============================================================================
-- 28. POLÍTICAS RLS — MENTOR MATCHING
-- ============================================================================
drop policy if exists mentor_profiles_read on public.mentor_profiles;
create policy mentor_profiles_read on public.mentor_profiles for select to authenticated
using (is_mentor = true or is_seeking_mentor = true or user_id = auth.uid());

drop policy if exists mentor_profiles_insert_self on public.mentor_profiles;
create policy mentor_profiles_insert_self on public.mentor_profiles for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists mentor_profiles_update_self on public.mentor_profiles;
create policy mentor_profiles_update_self on public.mentor_profiles for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists mentor_profiles_delete_self on public.mentor_profiles;
create policy mentor_profiles_delete_self on public.mentor_profiles for delete to authenticated
using (user_id = auth.uid());

drop policy if exists mentor_skills_read on public.mentor_skills;
create policy mentor_skills_read on public.mentor_skills for select to authenticated
using (exists(select 1 from public.mentor_profiles mp where mp.user_id = mentor_id and (mp.is_mentor or mp.user_id = auth.uid())));

drop policy if exists mentor_skills_insert_self on public.mentor_skills;
create policy mentor_skills_insert_self on public.mentor_skills for insert to authenticated
with check (mentor_id = auth.uid());

drop policy if exists mentor_skills_update_self on public.mentor_skills;
create policy mentor_skills_update_self on public.mentor_skills for update to authenticated
using (mentor_id = auth.uid()) with check (mentor_id = auth.uid());

drop policy if exists mentor_skills_delete_self on public.mentor_skills;
create policy mentor_skills_delete_self on public.mentor_skills for delete to authenticated
using (mentor_id = auth.uid());

drop policy if exists mentor_requests_read_participants on public.mentor_requests;
create policy mentor_requests_read_participants on public.mentor_requests for select to authenticated
using (mentor_id = auth.uid() or mentee_id = auth.uid());

drop policy if exists mentor_requests_insert_mentee on public.mentor_requests;
create policy mentor_requests_insert_mentee on public.mentor_requests for insert to authenticated
with check (mentee_id = auth.uid() and exists(select 1 from public.mentor_profiles mp where mp.user_id = mentor_id and mp.is_mentor = true));

drop policy if exists mentor_requests_update_participants on public.mentor_requests;
create policy mentor_requests_update_participants on public.mentor_requests for update to authenticated
using (mentor_id = auth.uid() or mentee_id = auth.uid())
with check (mentor_id = auth.uid() or mentee_id = auth.uid());

drop policy if exists mentor_sessions_read_participants on public.mentor_sessions;
create policy mentor_sessions_read_participants on public.mentor_sessions for select to authenticated
using (exists(select 1 from public.mentor_requests r where r.id = request_id and (r.mentor_id = auth.uid() or r.mentee_id = auth.uid())));

drop policy if exists mentor_reviews_read on public.mentor_reviews;
create policy mentor_reviews_read on public.mentor_reviews for select to authenticated using (true);

drop policy if exists mentor_reviews_insert_reviewer on public.mentor_reviews;
create policy mentor_reviews_insert_reviewer on public.mentor_reviews for insert to authenticated
with check (reviewer_id = auth.uid() and exists(
  select 1 from public.mentor_sessions s
  join public.mentor_requests r on r.id = s.request_id
  where s.id = session_id and s.status = 'completed'
    and (r.mentor_id = auth.uid() or r.mentee_id = auth.uid())
    and (r.mentor_id = reviewee_id or r.mentee_id = reviewee_id)
));

-- ============================================================================
-- 29. POLÍTICAS RLS — CONVERSAS E MENSAGENS
-- ============================================================================
drop policy if exists conversations_read_member on public.conversations;
create policy conversations_read_member on public.conversations for select to authenticated
using (exists(select 1 from public.conversation_members cm where cm.conversation_id = id and cm.user_id = auth.uid()));

drop policy if exists conversations_insert_creator on public.conversations;
create policy conversations_insert_creator on public.conversations for insert to authenticated
with check (created_by = auth.uid());

drop policy if exists conversation_members_read_member on public.conversation_members;
create policy conversation_members_read_member on public.conversation_members for select to authenticated
using (exists(select 1 from public.conversation_members cm where cm.conversation_id = conversation_id and cm.user_id = auth.uid()));

drop policy if exists conversation_members_insert_self_or_creator on public.conversation_members;
create policy conversation_members_insert_self_or_creator on public.conversation_members for insert to authenticated
with check (user_id = auth.uid() or exists(select 1 from public.conversations c where c.id = conversation_id and c.created_by = auth.uid()));

drop policy if exists conversation_members_update_self on public.conversation_members;
create policy conversation_members_update_self on public.conversation_members for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists messages_read_member on public.messages;
create policy messages_read_member on public.messages for select to authenticated
using (deleted_at is null and exists(select 1 from public.conversation_members cm where cm.conversation_id = conversation_id and cm.user_id = auth.uid()));

drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages for insert to authenticated
with check (sender_id = auth.uid() and exists(select 1 from public.conversation_members cm where cm.conversation_id = conversation_id and cm.user_id = auth.uid()));

drop policy if exists messages_update_sender on public.messages;
create policy messages_update_sender on public.messages for update to authenticated
using (sender_id = auth.uid()) with check (sender_id = auth.uid());

drop policy if exists messages_delete_sender on public.messages;
create policy messages_delete_sender on public.messages for delete to authenticated
using (sender_id = auth.uid());

-- ============================================================================
-- 30. POLÍTICAS RLS — NOTIFICAÇÕES, TENDÊNCIAS, DENÚNCIAS, RECONHECIMENTO
-- ============================================================================
drop policy if exists notifications_read_self on public.notifications;
create policy notifications_read_self on public.notifications for select to authenticated
using (recipient_id = auth.uid());

drop policy if exists notifications_update_self on public.notifications;
create policy notifications_update_self on public.notifications for update to authenticated
using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

drop policy if exists trending_read on public.trending_topics;
create policy trending_read on public.trending_topics for select to anon, authenticated using (true);

drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self on public.reports for insert to authenticated
with check (reporter_id = auth.uid());

drop policy if exists reports_read_self on public.reports;
create policy reports_read_self on public.reports for select to authenticated
using (reporter_id = auth.uid());

drop policy if exists recognition_read on public.contribution_recognition;
create policy recognition_read on public.contribution_recognition for select to authenticated using (true);

drop policy if exists recognition_insert_giver on public.contribution_recognition;
create policy recognition_insert_giver on public.contribution_recognition for insert to authenticated
with check (
  giver_id = auth.uid()
  and (
    (post_id is not null and exists(select 1 from public.posts p where p.id = post_id and p.author_id = recipient_id))
    or (comment_id is not null and exists(select 1 from public.comments c where c.id = comment_id and c.author_id = recipient_id))
  )
);

-- ============================================================================
-- 31. GRANTS DE PERMISSÕES
-- ============================================================================
grant select on public.communities to anon, authenticated;
grant select on public.comments to anon, authenticated;
grant insert, update, delete on public.comments to authenticated;
grant insert, update, delete on public.communities to authenticated;
grant select, insert, update, delete on public.community_members to authenticated;
grant select on public.community_subcommunities to anon, authenticated;
grant insert, update, delete on public.community_subcommunities to authenticated;
grant select, insert on public.community_chat_messages to authenticated;
grant select on public.community_resources to anon, authenticated;
grant insert, update, delete on public.community_resources to authenticated;

-- ============================================================================
-- 32. ÍNDICES ADICIONAIS DE PERFORMANCE
-- ============================================================================
create index if not exists profiles_username_search_idx on public.profiles (lower(username));
create index if not exists profiles_display_name_search_idx on public.profiles (lower(display_name));
create index if not exists posts_content_search_idx on public.posts using gin (to_tsvector('portuguese', coalesce(content,'')));
create index if not exists comments_content_search_idx on public.comments using gin (to_tsvector('portuguese', coalesce(content,'')));
create index if not exists mentor_skills_name_idx on public.mentor_skills (lower(skill_name));
create index if not exists communities_name_idx on public.communities (lower(name));
create index if not exists notifications_unread_idx on public.notifications (recipient_id, created_at desc) where read_at is null;
create index if not exists reports_open_idx on public.reports (created_at desc) where status in ('open','reviewing');

-- ============================================================================
-- 33. VIEWS DE CONSULTA
-- ============================================================================
-- security_invoker=true faz a view respeitar o RLS das tabelas base.
-- Sem isso, a view rodaria com privilégio do criador e vazaria dados.

-- View: feed de posts com autor, interesse e contagens de reações/comentários.
create or replace view public.v_feed_posts
with (security_invoker = true) as
select
  p.id as post_id,
  p.author_id,
  pr.username,
  pr.display_name,
  pr.avatar_url,
  p.interest_id,
  i.name as interest_name,
  p.content,
  p.post_type,
  p.link_url,
  p.media_urls,
  p.visibility,
  p.created_at,
  p.updated_at,
  coalesce(rx.reaction_count, 0) as reaction_count,
  coalesce(cm.comment_count, 0) as comment_count,
  coalesce(ut.useful_count, 0) as useful_count
from public.posts p
join public.profiles pr on pr.id = p.author_id
left join public.interests i on i.id = p.interest_id
left join (
  select post_id, count(*)::bigint as reaction_count
  from public.post_reactions group by post_id
) rx on rx.post_id = p.id
left join (
  select post_id, count(*)::bigint as comment_count
  from public.comments where deleted_at is null group by post_id
) cm on cm.post_id = p.id
left join (
  select post_id, count(*)::bigint as useful_count
  from public.post_reactions where reaction = 'useful' group by post_id
) ut on ut.post_id = p.id
where p.deleted_at is null;

-- View: diretório de comunidades com nome do dono, categoria e total de membros ativos.
create or replace view public.v_community_directory
with (security_invoker = true) as
select
  c.id as community_id,
  c.name,
  c.slug,
  c.description,
  c.visibility,
  c.join_policy,
  c.avatar_url,
  c.cover_url,
  c.created_at,
  c.owner_id,
  owner.username as owner_username,
  owner.display_name as owner_display_name,
  i.name as category_name,
  count(m.user_id) filter (where m.status = 'active')::bigint as active_member_count
from public.communities c
join public.profiles owner on owner.id = c.owner_id
left join public.interests i on i.id = c.category_id
left join public.community_members m on m.community_id = c.id
group by c.id, owner.username, owner.display_name, i.name;

-- View: diretório de mentores com dados públicos e avaliação média.
create or replace view public.v_mentor_directory
with (security_invoker = true) as
select
  mp.user_id as mentor_id,
  pr.username,
  pr.display_name,
  pr.avatar_url,
  mp.headline,
  mp.mentoring_bio,
  mp.experience_level,
  mp.mentoring_style,
  mp.availability,
  mp.languages,
  mp.goals,
  coalesce(rv.review_count, 0) as review_count,
  rv.average_rating
from public.mentor_profiles mp
join public.profiles pr on pr.id = mp.user_id
left join (
  select reviewee_id, count(*)::bigint as review_count, round(avg(rating)::numeric, 2) as average_rating
  from public.mentor_reviews group by reviewee_id
) rv on rv.reviewee_id = mp.user_id
where mp.is_mentor = true;

-- View: resumo do próprio perfil com contagens de seguidores, seguindo e posts.
create or replace view public.v_profile_summary
with (security_invoker = true) as
select
  p.id as user_id,
  p.username,
  p.display_name,
  p.bio,
  p.avatar_url,
  p.created_at,
  (select count(*) from public.follows f where f.followed_id = p.id)::bigint as followers_count,
  (select count(*) from public.follows f where f.follower_id = p.id)::bigint as following_count,
  (select count(*) from public.posts po where po.author_id = p.id and po.deleted_at is null)::bigint as posts_count
from public.profiles p;

-- ============================================================================
-- 34. FUNÇÕES DE CONSULTA (LOOKUP)
-- ============================================================================

-- Busca posts por texto, assunto ou autor. Respeita o RLS.
create or replace function public.lookup_posts(
  search_text text default null,
  interest_slug text default null,
  author_username text default null,
  result_limit integer default 30,
  result_offset integer default 0
)
returns setof public.v_feed_posts
language sql stable security invoker set search_path = public
as $$
  select v.*
  from public.v_feed_posts v
  left join public.interests i on i.id = v.interest_id
  where (nullif(trim(search_text), '') is null
         or to_tsvector('portuguese', coalesce(v.content,'')) @@ plainto_tsquery('portuguese', search_text)
         or v.content ilike '%' || search_text || '%')
    and (nullif(trim(interest_slug), '') is null or i.slug = interest_slug)
    and (nullif(trim(author_username), '') is null or lower(v.username) = lower(author_username))
  order by v.created_at desc
  limit greatest(1, least(coalesce(result_limit, 30), 100))
  offset greatest(coalesce(result_offset, 0), 0);
$$;

-- Mentor Matching: pontua mentores pelas habilidades que batem com
-- os interesses que a pessoa escolheu. Ranking transparente.
create or replace function public.find_mentor_matches(
  learner_id uuid default auth.uid(),
  result_limit integer default 20
)
returns table (
  mentor_id uuid,
  username text,
  display_name text,
  headline text,
  mentoring_bio text,
  experience_level text,
  matching_skills text[],
  match_score integer,
  average_rating numeric,
  review_count bigint
)
language sql stable security invoker set search_path = public
as $$
  with learner_interests as (
    select lower(i.name) as skill
    from public.profile_interests pi
    join public.interests i on i.id = pi.interest_id
    where pi.profile_id = learner_id
  ), exact_matches as (
    select mp.user_id,
      array_agg(distinct ms.skill_name) filter (where li.skill is not null) as matching_skills,
      (count(distinct lower(ms.skill_name)) filter (where li.skill is not null))::integer as score
    from public.mentor_profiles mp
    left join public.mentor_skills ms on ms.mentor_id = mp.user_id
    left join learner_interests li on li.skill = lower(ms.skill_name)
    where mp.is_mentor = true and mp.user_id <> learner_id
    group by mp.user_id
  )
  select mp.user_id, pr.username, pr.display_name, mp.headline, mp.mentoring_bio,
         mp.experience_level, coalesce(em.matching_skills, array[]::text[]),
         coalesce(em.score, 0), rv.average_rating, coalesce(rv.review_count, 0)
  from public.mentor_profiles mp
  join public.profiles pr on pr.id = mp.user_id
  left join exact_matches em on em.user_id = mp.user_id
  left join (
    select reviewee_id, round(avg(rating)::numeric, 2) as average_rating,
           count(*)::bigint as review_count
    from public.mentor_reviews group by reviewee_id
  ) rv on rv.reviewee_id = mp.user_id
  where mp.is_mentor = true and mp.user_id <> learner_id
  order by coalesce(em.score, 0) desc, rv.average_rating desc nulls last, pr.display_name
  limit greatest(1, least(coalesce(result_limit, 20), 100));
$$;

-- Marca uma notificação como lida. Só o destinatário pode alterar.
create or replace function public.mark_notification_read(notification_id uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
declare affected integer;
begin
  update public.notifications
  set read_at = now()
  where id = notification_id and recipient_id = auth.uid() and read_at is null;
  get diagnostics affected = row_count;
  return affected > 0;
end; $$;

grant execute on function public.lookup_posts(text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.find_mentor_matches(uuid, integer) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- ============================================================================
-- 35. DADOS INICIAIS — INTERESSES
-- ============================================================================
insert into public.interests(name, slug, description) values
 ('Programação e Tecnologia','programacao-tecnologia','Código, desenvolvimento e tecnologia'),
 ('Desenvolvimento Web','desenvolvimento-web','HTML, CSS, JavaScript e aplicações web'),
 ('Inteligência Artificial','inteligencia-artificial','IA, modelos e automação'),
 ('Games','games','Jogos, game design e desenvolvimento'),
 ('Artes e Design','artes-design','Design visual, ilustração e criatividade'),
 ('Estudos','estudos','Aprendizagem, organização e vida acadêmica'),
 ('Música','musica','Instrumentos, produção e teoria musical'),
 ('Escrita e Literatura','escrita-literatura','Escrita criativa e leitura'),
 ('Fotografia','fotografia','Fotografia e edição'),
 ('Ciência e Dados','ciencia-dados','Ciência, análise e visualização de dados')
on conflict (slug) do nothing;

-- ============================================================================
-- 36. STORAGE — BUCKETS E POLÍTICAS
-- ============================================================================
-- Bucket community-media: arquivos de comunidades (imagens, vídeos, PDFs).
-- Bucket profile-media: avatars e capas de perfil.
-- Leitura pública; upload/update/delete só na pasta do próprio usuário.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-media','community-media',true,104857600,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain'])
on conflict (id) do update set public = true, file_size_limit = 104857600;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media','profile-media',true,5242880,
  array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 5242880;

drop policy if exists luminova_community_media_public_read on storage.objects;
create policy luminova_community_media_public_read on storage.objects for select to anon, authenticated
using (bucket_id in ('community-media','profile-media'));

drop policy if exists luminova_community_media_upload_own_folder on storage.objects;
create policy luminova_community_media_upload_own_folder on storage.objects for insert to authenticated
with check (bucket_id in ('community-media','profile-media') and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists luminova_community_media_update_own_folder on storage.objects;
create policy luminova_community_media_update_own_folder on storage.objects for update to authenticated
using (bucket_id in ('community-media','profile-media') and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id in ('community-media','profile-media') and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists luminova_community_media_delete_own_folder on storage.objects;
create policy luminova_community_media_delete_own_folder on storage.objects for delete to authenticated
using (bucket_id in ('community-media','profile-media') and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================================
-- 37. REALTIME
-- ============================================================================
-- Adiciona a tabela de mensagens de chat na publicação supabase_realtime
-- pra permitir subscription em tempo real no frontend.
do $$
begin
  alter publication supabase_realtime add table public.community_chat_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ============================================================================
-- 38. COMENTÁRIOS NAS COLUNAS
-- ============================================================================
comment on table public.community_subcommunities is 'Subcomunidades dentro de uma comunidade LUMINOVA.';
comment on table public.community_chat_messages is 'Mensagens do chat geral (subcommunity_id NULL) e de subcomunidades.';
comment on column public.profiles.profile_settings is 'Preferências visuais do perfil em JSON.';
comment on column public.communities.settings is 'Preferências visuais da comunidade em JSON.';
comment on column public.communities.welcome_text is 'Texto de boas-vindas exibido na página da comunidade.';
comment on column public.profiles.role is 'Papel global: learner, mentor, admin. Alterável apenas por admin.';

-- ============================================================================
-- FIM
-- ============================================================================
commit;
