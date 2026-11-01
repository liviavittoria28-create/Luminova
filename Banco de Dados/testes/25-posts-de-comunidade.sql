-- ============================================================================
-- LUMINOVA | Publicações de comunidade fora do feed geral (Migração 6) — SOMENTE BANCO LOCAL
-- ============================================================================
\set ON_ERROR_STOP 1
begin;
set local client_min_messages = warning;
create temp table _res (n serial, teste text, ok boolean, detalhe text);
grant all on _res to authenticated, anon;
grant usage, select on sequence _res_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-e000-00000000000a', 'dona@teste.invalid', '{"name":"Dona","username":"dona_t"}'),
  ('00000000-0000-4000-e000-00000000000b', 'fora@teste.invalid', '{"name":"Fora","username":"fora_t"}');

-- a dona cria uma comunidade pública e uma privada, e publica: um post no feed e um em cada comunidade
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-e000-00000000000a';
insert into public.communities (owner_id, name, slug) values (auth.uid(), 'Clube Aberto', 'clube-aberto-t') returning id as c_pub \gset
insert into public.communities (owner_id, name, slug, visibility, join_policy) values (auth.uid(), 'Clube Fechado', 'clube-fechado-t', 'private', 'approval') returning id as c_priv \gset
insert into public.posts (author_id, content) values (auth.uid(), 'post do feed geral #astro') returning id as p_feed \gset
insert into public.posts (author_id, content) values (auth.uid(), 'post da comunidade aberta #astro') returning id as p_pub \gset
select set_config('t.p_pub', :'p_pub', false) as _x \gset
insert into public.community_posts (community_id, post_id) values (:'c_pub', :'p_pub');
insert into public.posts (author_id, content) values (auth.uid(), 'post da comunidade fechada #astro') returning id as p_priv \gset
insert into public.community_posts (community_id, post_id) values (:'c_priv', :'p_priv');
reset role;

insert into _res (teste, ok, detalhe)
select 'G1 post vinculado à comunidade recebe community_id', count(*) = 2, count(*) || ' posts marcados' from public.posts where id in (:'p_pub', :'p_priv') and community_id is not null;

-- visão de quem NÃO é membro e de visitante
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-e000-00000000000b';
insert into _res (teste, ok, detalhe)
select 'G2 feed geral (community_id is null) só traz o post do feed', bool_and(post_id = :'p_feed'), string_agg(content, ' | ')
from public.v_feed_posts where author_id = '00000000-0000-4000-e000-00000000000a' and community_id is null;
insert into _res (teste, ok, detalhe)
select 'G3 "Para você" não traz post de comunidade', not bool_or(community_id is not null), count(*) || ' posts'
from public.luminova_recommend_posts(50, 0);
insert into _res (teste, ok, detalhe)
select 'G4 hashtag no feed geral não traz post de comunidade', count(*) = 1, string_agg(content, ' | ')
from public.luminova_posts_by_tag('astro', null, 50) where author_id = '00000000-0000-4000-e000-00000000000a';
insert into _res (teste, ok, detalhe)
select 'G5 hashtag DENTRO da comunidade aberta traz o post dela', count(*) = 1, string_agg(content, ' | ')
from public.luminova_posts_by_tag('astro', :'c_pub', 50);
insert into _res (teste, ok, detalhe)
select 'G6 não membro NÃO lê post de comunidade privada', count(*) = 0, count(*) || '' from public.posts where id = :'p_priv';
insert into _res (teste, ok, detalhe)
select 'G7 não membro lê post de comunidade pública (na página da comunidade)', count(*) = 1, '' from public.posts where id = :'p_pub';
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-e000-00000000000a';
do $$
declare ok boolean := false;
begin
  begin update public.posts set community_id = null where id = current_setting('t.p_pub', true)::uuid;
  exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('G9 autora não "tira" o post da comunidade mudando community_id direto', ok, '');
end $$;
reset role;

set local role anon;
set local request.jwt.claim.sub = '';
insert into _res (teste, ok, detalhe)
select 'G10 visitante: feed geral sem posts de comunidade', count(*) = 1, string_agg(content, ' | ')
from public.v_feed_posts where author_id = '00000000-0000-4000-e000-00000000000a' and community_id is null;
insert into _res (teste, ok, detalhe)
select 'G11 visitante não lê post de comunidade privada', count(*) = 0, '' from public.posts where content = 'post da comunidade fechada #astro';
reset role;

select n, case when ok then 'PASSOU' else 'FALHOU' end as resultado, teste, detalhe from _res order by n;
select count(*) filter (where ok) || '/' || count(*) || ' testes de posts de comunidade passaram' as resumo from _res;
rollback;
