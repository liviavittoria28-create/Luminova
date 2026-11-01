-- ============================================================================
-- LUMINOVA | Feed da subcomunidade e encaminhamentos (Migração 10) — SOMENTE BANCO LOCAL
-- ============================================================================
\set ON_ERROR_STOP 1
begin;
set local client_min_messages = warning;
create temp table _res (n serial, teste text, ok boolean, detalhe text);
grant all on _res to authenticated, anon;
grant usage, select on sequence _res_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-f100-00000000000a', 'dona.sub@teste.invalid', '{"name":"Dona Sub","username":"dona_sub_t"}'),
  ('00000000-0000-4000-f100-00000000000b', 'membro.sub@teste.invalid', '{"name":"Membro Sub","username":"membro_sub_t"}'),
  ('00000000-0000-4000-f100-00000000000c', 'fora.sub@teste.invalid', '{"name":"Fora Sub","username":"fora_sub_t"}');

-- a dona cria uma comunidade aberta (com 2 subs), uma fechada (com 1 sub) e uma outra (com 1 sub)
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-f100-00000000000a';
insert into public.communities (owner_id, name, slug) values (auth.uid(), 'Desenho Aberto', 'desenho-aberto-t') returning id as c1 \gset
insert into public.communities (owner_id, name, slug, visibility, join_policy) values (auth.uid(), 'Desenho Fechado', 'desenho-fechado-t', 'private', 'approval') returning id as c2 \gset
insert into public.communities (owner_id, name, slug) values (auth.uid(), 'Outra Turma', 'outra-turma-t') returning id as c3 \gset
insert into public.community_subcommunities (community_id, name, created_by) values (:'c1', 'Fanarts', auth.uid()) returning id as s_fan \gset
insert into public.community_subcommunities (community_id, name, created_by) values (:'c1', 'Teorias', auth.uid()) returning id as s_teo \gset
insert into public.community_subcommunities (community_id, name, created_by) values (:'c2', 'Segredos', auth.uid()) returning id as s_seg \gset
insert into public.community_subcommunities (community_id, name, created_by) values (:'c3', 'Alheia', auth.uid()) returning id as s_alheia \gset
select set_config('t.c1', :'c1', false) as _a, set_config('t.s_fan', :'s_fan', false) as _b, set_config('t.s_alheia', :'s_alheia', false) as _c \gset

-- posts: um no feed principal da c1, um na sub Fanarts, um na sub Segredos (comunidade fechada)
insert into public.posts (author_id, content) values (auth.uid(), 'post da comunidade principal') returning id as p_main \gset
insert into public.community_posts (community_id, post_id) values (:'c1', :'p_main');
insert into public.posts (author_id, content) values (auth.uid(), 'post só da sub Fanarts') returning id as p_fan \gset
insert into public.community_posts (community_id, post_id, subcommunity_id) values (:'c1', :'p_fan', :'s_fan');
insert into public.posts (author_id, content) values (auth.uid(), 'post secreto da sub Segredos') returning id as p_seg \gset
insert into public.community_posts (community_id, post_id, subcommunity_id) values (:'c2', :'p_seg', :'s_seg');
select set_config('t.p_main', :'p_main', false) as _d, set_config('t.p_fan', :'p_fan', false) as _e \gset
reset role;

-- o membro entra na comunidade aberta
insert into public.community_members (community_id, user_id, role, status) values (:'c1', '00000000-0000-4000-f100-00000000000b', 'member', 'active') on conflict do nothing;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-f100-00000000000b';
insert into _res (teste, ok, detalhe)
select 'S1 post da sub fica marcado na subcomunidade', count(*) = 1, '' from public.community_posts where post_id = :'p_fan' and subcommunity_id = :'s_fan';
insert into _res (teste, ok, detalhe)
select 'S2 feed da sub Fanarts traz só o post dela', count(*) = 1 and bool_and(post_id = :'p_fan'), count(*) || ' post(s)'
from public.community_posts where subcommunity_id = :'s_fan';
insert into _res (teste, ok, detalhe)
select 'S3 post da comunidade principal NÃO aparece na sub sozinho', count(*) = 0, ''
from public.community_posts where subcommunity_id = :'s_fan' and post_id = :'p_main';
insert into _res (teste, ok, detalhe)
select 'S4 feed da comunidade principal traz só os posts dela (sem os das subs)', count(*) = 1 and bool_and(post_id = :'p_main'), count(*) || ' post(s)'
from public.community_posts where community_id = :'c1' and subcommunity_id is null;

-- encaminhar: membro manda o post principal para a sub Fanarts
insert into public.community_post_forwards (post_id, subcommunity_id, forwarded_by) values (:'p_main', :'s_fan', auth.uid());
insert into _res (teste, ok, detalhe)
select 'S5 membro encaminha post principal para a sub', count(*) = 1, '' from public.community_post_forwards where post_id = :'p_main' and subcommunity_id = :'s_fan';
do $$
declare ok boolean := false;
begin
  begin insert into public.community_post_forwards (post_id, subcommunity_id, forwarded_by)
        values (current_setting('t.p_main')::uuid, current_setting('t.s_fan')::uuid, auth.uid());
  exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('S6 não encaminha o mesmo post duas vezes para a mesma sub', ok, '');
  ok := false;
  begin insert into public.community_post_forwards (post_id, subcommunity_id, forwarded_by)
        values (current_setting('t.p_main')::uuid, current_setting('t.s_alheia')::uuid, auth.uid());
  exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('S7 não encaminha para sub de OUTRA comunidade', ok, '');
  ok := false;
  begin insert into public.community_post_forwards (post_id, subcommunity_id, forwarded_by)
        values (current_setting('t.p_fan')::uuid, current_setting('t.s_fan')::uuid, auth.uid());
  exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('S8 não encaminha post para a sub de onde ele já é', ok, '');
  ok := false;
  begin insert into public.community_posts (community_id, post_id, subcommunity_id)
        select current_setting('t.c1')::uuid, id, current_setting('t.s_alheia')::uuid from public.posts where false;
        -- inserir de verdade um post novo numa sub de outra comunidade
        insert into public.posts (id, author_id, content) values ('00000000-0000-4000-f100-0000000000f1', auth.uid(), 'tentativa');
        insert into public.community_posts (community_id, post_id, subcommunity_id)
        values (current_setting('t.c1')::uuid, '00000000-0000-4000-f100-0000000000f1', current_setting('t.s_alheia')::uuid);
  exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('S9 não posta "na comunidade A" usando sub da comunidade B', ok, '');
end $$;
reset role;

-- quem não é membro
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-f100-00000000000c';
do $$
declare ok boolean := false;
begin
  begin insert into public.community_post_forwards (post_id, subcommunity_id, forwarded_by)
        select current_setting('t.p_main')::uuid, s.id, auth.uid() from public.community_subcommunities s where s.name = 'Teorias';
        if not found then ok := true; end if;
  exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('S10 quem não é membro não encaminha', ok, '');
end $$;
insert into _res (teste, ok, detalhe)
select 'S11 não membro não lê post da sub de comunidade fechada', count(*) = 0, '' from public.posts where content = 'post secreto da sub Segredos';
insert into _res (teste, ok, detalhe)
select 'S12 post de sub nunca vai para o feed geral da LUMINOVA', count(*) = 0, ''
from public.v_feed_posts where community_id is null and content in ('post só da sub Fanarts', 'post da comunidade principal');
reset role;

-- apagar a sub: o post continua na comunidade principal
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-f100-00000000000a';
delete from public.community_subcommunities where id = :'s_fan';
reset role;
insert into _res (teste, ok, detalhe)
select 'S13 apagar a sub mantém o post na comunidade principal', count(*) = 1, ''
from public.community_posts where post_id = :'p_fan' and community_id = :'c1' and subcommunity_id is null;

select n, case when ok then 'PASSOU' else 'FALHOU' end as resultado, teste, detalhe from _res order by n;
select count(*) filter (where ok) || '/' || count(*) || ' testes de subcomunidades passaram' as resumo from _res;
rollback;
