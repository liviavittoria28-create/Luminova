-- ============================================================================
-- LUMINOVA 3.x | Migração 10 — feed próprio da subcomunidade + encaminhar posts
-- Execute no Supabase > SQL Editor DEPOIS da Migração 6 (e da 9, se usar). Idempotente e não destrutiva.
--
--  1. community_posts.subcommunity_id: o post feito dentro de uma subcomunidade fica marcado nela.
--     Ele continua sendo da comunidade principal (aparece lá com a etiqueta "em ◈ Nome").
--     Se a subcomunidade for apagada, o post volta a ser só da comunidade principal (nada é perdido).
--  2. community_post_forwards: o que é postado na comunidade principal NÃO aparece na subcomunidade,
--     a não ser que algum membro ENCAMINHE o post para ela.
--  3. Regras no banco: a subcomunidade precisa ser da mesma comunidade; só membros ativos postam/encaminham;
--     só quem pode ver a comunidade vê os encaminhamentos. Nada disso entra no feed geral da LUMINOVA.
-- ============================================================================
begin;

-- 1) post da subcomunidade ----------------------------------------------------------
alter table public.community_posts
  add column if not exists subcommunity_id uuid references public.community_subcommunities(id) on delete set null;
create index if not exists community_posts_sub_idx on public.community_posts (community_id, subcommunity_id, created_at desc);

create or replace function public.luminova_check_post_subcommunity()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.subcommunity_id is not null and not exists (
       select 1 from public.community_subcommunities s where s.id = new.subcommunity_id and s.community_id = new.community_id) then
    raise exception 'Essa subcomunidade não pertence a esta comunidade.';
  end if;
  return new;
end; $$;
drop trigger if exists community_posts_check_sub on public.community_posts;
create trigger community_posts_check_sub before insert or update of subcommunity_id, community_id on public.community_posts
for each row execute function public.luminova_check_post_subcommunity();

-- 2) encaminhamentos para subcomunidades ---------------------------------------------
create table if not exists public.community_post_forwards (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  subcommunity_id uuid not null references public.community_subcommunities(id) on delete cascade,
  forwarded_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, subcommunity_id)
);
create index if not exists community_post_forwards_sub_idx on public.community_post_forwards (subcommunity_id, created_at desc);

-- o encaminhamento só vale para post da MESMA comunidade e para subcomunidade dela; o post não pode já ser dessa sub
create or replace function public.luminova_check_forward()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_comm uuid; v_sub_comm uuid; v_sub_atual uuid;
begin
  select cp.community_id, cp.subcommunity_id into v_comm, v_sub_atual from public.community_posts cp where cp.post_id = new.post_id;
  select s.community_id into v_sub_comm from public.community_subcommunities s where s.id = new.subcommunity_id;
  if v_comm is null then raise exception 'Só dá para encaminhar posts de comunidade.'; end if;
  if v_sub_comm is distinct from v_comm then raise exception 'A subcomunidade precisa ser da mesma comunidade do post.'; end if;
  if v_sub_atual = new.subcommunity_id then raise exception 'Esse post já é desta subcomunidade.'; end if;
  new.community_id := v_comm;
  return new;
end; $$;
drop trigger if exists community_post_forwards_check on public.community_post_forwards;
create trigger community_post_forwards_check before insert on public.community_post_forwards
for each row execute function public.luminova_check_forward();

alter table public.community_post_forwards enable row level security;
drop policy if exists forwards_read on public.community_post_forwards;
create policy forwards_read on public.community_post_forwards for select to authenticated
using (public.luminova_can_view_community(community_id));
drop policy if exists forwards_insert_member on public.community_post_forwards;
create policy forwards_insert_member on public.community_post_forwards for insert to authenticated
with check (
  forwarded_by = (select auth.uid())
  and public.luminova_is_active_community_member(community_id)
  and exists (select 1 from public.posts p where p.id = post_id and p.deleted_at is null)
);
drop policy if exists forwards_delete on public.community_post_forwards;
create policy forwards_delete on public.community_post_forwards for delete to authenticated
using (forwarded_by = (select auth.uid()) or public.luminova_can_manage_community(community_id));
grant select, insert, delete on public.community_post_forwards to authenticated;

insert into public.luminova_schema_versions (version, name)
values (10, 'Migracao-10 (feed da subcomunidade e encaminhamentos)')
on conflict (version) do nothing;

commit;
notify pgrst, 'reload schema';
