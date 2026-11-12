-- ============================================================================
-- LUMINOVA | Skill Tree expandida (Migração 11) — SOMENTE BANCO LOCAL
-- ============================================================================
\set ON_ERROR_STOP 1
begin;
set local client_min_messages = warning;
create temp table _res (n serial, teste text, ok boolean, detalhe text);
grant all on _res to authenticated, anon;
grant usage, select on sequence _res_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-f200-00000000000a', 'arvore@teste.invalid', '{"name":"Arvore Teste","username":"arvore_t"}');

insert into _res (teste, ok, detalhe)
select 'K1 árvore tem 22 nós, 4 estágios por ramo e nó final', count(*) = 22 and bool_or(node_key = 'constelacao'), count(*) || ' nós'
from public.skill_nodes;
insert into _res (teste, ok, detalhe)
select 'K2 todo requisito aponta para um nó existente', count(*) = 0, coalesce(string_agg(r, ', '), '')
from public.skill_nodes n, unnest(n.requires) r where not exists (select 1 from public.skill_nodes x where x.node_key = r);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-f200-00000000000a';

do $$ begin
  perform public.luminova_unlock_skill('centelha');
  insert into _res (teste, ok) values ('K3 sem publicar, não resgata a Centelha', false);
exception when others then
  insert into _res (teste, ok, detalhe) values ('K3 sem publicar, não resgata a Centelha', true, sqlerrm);
end $$;

insert into public.posts (author_id, content) values (auth.uid(), 'primeira ideia');
insert into _res (teste, ok, detalhe)
select 'K4 depois de publicar, resgata a Centelha', (public.luminova_unlock_skill('centelha') ->> 'ok')::boolean, '';

do $$ begin
  perform public.luminova_unlock_skill('autor');
  insert into _res (teste, ok) values ('K5 não pula estágio (Autor antes de Primeira Voz)', false);
exception when others then
  insert into _res (teste, ok, detalhe) values ('K5 não pula estágio (Autor antes de Primeira Voz)', true, sqlerrm);
end $$;

insert into public.posts (author_id, content) values (auth.uid(), 'segunda'), (auth.uid(), 'terceira');
insert into _res (teste, ok, detalhe)
select 'K6 cumpriu a meta: resgata Primeira Voz e o próximo estágio abre', (public.luminova_unlock_skill('voz') ->> 'ok')::boolean,
       (select xp from public.profile_progress where user_id = auth.uid()) || ' XP';

do $$ begin
  perform public.luminova_unlock_skill('constelacao');
  insert into _res (teste, ok) values ('K7 nó final continua bloqueado', false);
exception when others then
  insert into _res (teste, ok, detalhe) values ('K7 nó final continua bloqueado', true, sqlerrm);
end $$;

do $$ begin
  insert into public.profile_skills (user_id, node_key) values (auth.uid(), 'lenda');
  insert into _res (teste, ok) values ('K8 ninguém grava nó direto na tabela', false);
exception when others then
  insert into _res (teste, ok, detalhe) values ('K8 ninguém grava nó direto na tabela', true, sqlerrm);
end $$;
reset role;

select n, case when ok then 'PASSOU' else 'FALHOU' end as resultado, teste, detalhe from _res order by n;
select count(*) filter (where ok) || '/' || count(*) || ' testes da skill tree passaram' as resumo from _res;
rollback;
