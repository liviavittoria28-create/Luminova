-- ============================================================================
-- LUMINOVA 3.x | Migração 6 — publicações de comunidade NUNCA aparecem no feed geral
-- Execute no Supabase > SQL Editor DEPOIS das Migrações 4 e 5. Idempotente e não destrutiva.
--
--  1. posts.community_id: cada publicação sabe se pertence a uma comunidade (preenchido por gatilho
--     a partir de community_posts; publicações antigas são preenchidas agora).
--  2. Leitura: publicação de comunidade só é visível para quem pode ver a comunidade
--     (antes, um post "público" de comunidade privada podia ser lido por qualquer pessoa).
--  3. v_feed_posts ganha a coluna community_id; o feed geral filtra community_id is null.
--  4. "Para você", hashtags e assuntos do momento do feed geral deixam de usar posts de comunidade.
-- ============================================================================
begin;

-- 1) coluna + gatilho -------------------------------------------------------------
alter table public.posts add column if not exists community_id uuid references public.communities(id) on delete cascade;
create index if not exists posts_community_idx on public.posts (community_id, created_at desc);
create index if not exists posts_general_feed_idx on public.posts (created_at desc) where community_id is null and deleted_at is null;

update public.posts p set community_id = cp.community_id
  from public.community_posts cp
 where cp.post_id = p.id and p.community_id is distinct from cp.community_id;

create or replace function public.luminova_sync_post_community()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    update public.posts set community_id = null where id = old.post_id and community_id = old.community_id;
    return old;
  end if;
  update public.posts set community_id = new.community_id where id = new.post_id;
  return new;
end; $$;
drop trigger if exists community_posts_sync on public.community_posts;
create trigger community_posts_sync after insert or update or delete on public.community_posts
for each row execute function public.luminova_sync_post_community();

-- ninguém muda community_id "na mão" (só o gatilho acima, que roda como dono da função)
create or replace function public.luminova_guard_post_community()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.community_id is distinct from old.community_id and auth.uid() is not null
     and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'A comunidade de uma publicação não pode ser alterada diretamente.';
  end if;
  return new;
end; $$;
drop trigger if exists posts_guard_community on public.posts;
create trigger posts_guard_community before update of community_id on public.posts
for each row execute function public.luminova_guard_post_community();

-- publicação nova não pode já nascer "dentro" de comunidade sem passar por community_posts
create or replace function public.luminova_guard_post_community_insert()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.community_id is not null and auth.uid() is not null and current_user = 'authenticated' then
    new.community_id := null;
  end if;
  return new;
end; $$;
drop trigger if exists posts_guard_community_insert on public.posts;
create trigger posts_guard_community_insert before insert on public.posts
for each row execute function public.luminova_guard_post_community_insert();

-- 2) leitura respeita a comunidade -----------------------------------------------
drop policy if exists posts_read_public on public.posts;
create policy posts_read_public on public.posts for select to anon, authenticated
using (
  deleted_at is null
  and public.luminova_can_see_author(author_id)
  and (community_id is null or public.luminova_can_view_community(community_id))
  and (
    visibility = 'public'
    or author_id = (select auth.uid())
    or exists (select 1 from public.follows f where f.follower_id = (select auth.uid()) and f.followed_id = author_id)
  )
);

-- 3) view do feed com community_id (coluna nova no FINAL, exigência do create or replace view) ----
create or replace view public.v_feed_posts with (security_invoker = true) as
select
  p.id as post_id, p.author_id, pr.username, pr.display_name, pr.avatar_url,
  p.interest_id, i.name as interest_name, p.content, p.post_type, p.link_url, p.media_urls,
  p.visibility, p.created_at, p.updated_at,
  coalesce(rx.reaction_count, 0) as reaction_count,
  coalesce(cm.comment_count, 0) as comment_count,
  coalesce(ut.useful_count, 0) as useful_count,
  pr.is_ai as is_ai,
  p.community_id as community_id
from public.posts p
join public.profiles pr on pr.id = p.author_id
left join public.interests i on i.id = p.interest_id
left join (select post_id, count(*)::bigint as reaction_count from public.post_reactions group by post_id) rx on rx.post_id = p.id
left join (select post_id, count(*)::bigint as comment_count from public.comments where deleted_at is null group by post_id) cm on cm.post_id = p.id
left join (select post_id, count(*)::bigint as useful_count from public.post_reactions where reaction = 'useful' group by post_id) ut on ut.post_id = p.id
where p.deleted_at is null;
grant select on public.v_feed_posts to anon, authenticated;

-- 4) funções do feed geral ignoram posts de comunidade -----------------------------
create or replace function public.luminova_recommend_posts(result_limit integer default 20, result_offset integer default 0)
returns setof public.v_feed_posts language sql stable security invoker set search_path = public as $$
  with mine as (select public.luminova_my_interest_ids() as iid)
  select v.* from public.v_feed_posts v
  where v.community_id is null
    and v.author_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  order by
    ((case when v.interest_id in (select iid from mine) then 3 else 0 end)
     + (case when exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followed_id = v.author_id) then 4 else 0 end)
     + least(v.reaction_count + v.comment_count, 20) * 0.15
     - extract(epoch from (now() - v.created_at)) / 86400.0) desc
  limit greatest(1, least(coalesce(result_limit, 20), 50))
  offset greatest(coalesce(result_offset, 0), 0);
$$;
grant execute on function public.luminova_recommend_posts(integer, integer) to authenticated;

create or replace function public.luminova_posts_by_tag(tag_text text, in_community uuid default null, result_limit integer default 30)
returns setof public.v_feed_posts language sql stable security invoker set search_path = public as $$
  select v.* from public.v_feed_posts v
   where v.content ~* ('(^|[^[:alnum:]_])#' || regexp_replace(lower(trim(both '#' from tag_text)), '[^[:alnum:]_]', '', 'g') || '([^[:alnum:]_]|$)')
     and ((in_community is null and v.community_id is null) or v.community_id = in_community)
   order by v.created_at desc
   limit greatest(1, least(coalesce(result_limit,30), 100));
$$;
grant execute on function public.luminova_posts_by_tag(text, uuid, integer) to anon, authenticated;

create or replace function public.luminova_trending(window_days integer default 7, result_limit integer default 8, in_community uuid default null)
returns table (tag text, post_count bigint, interaction_count bigint, score bigint)
language sql stable security invoker set search_path = public as $$
  with recent as (
    select p.id, p.content from public.posts p
      join public.profiles pr on pr.id = p.author_id
     where p.deleted_at is null and p.visibility = 'public' and not pr.is_ai
       and p.created_at >= now() - make_interval(days => greatest(1, least(coalesce(window_days,7), 90)))
       and ((in_community is null and p.community_id is null) or p.community_id = in_community)
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

insert into public.luminova_schema_versions (version, name)
values (6, 'Migracao-6 (publicações de comunidade fora do feed geral)')
on conflict (version) do nothing;

commit;
notify pgrst, 'reload schema';
