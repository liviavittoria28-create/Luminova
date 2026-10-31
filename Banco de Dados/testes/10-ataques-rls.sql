-- ============================================================================
-- LUMINOVA | Testes de isolamento entre contas (RLS) — SOMENTE BANCO LOCAL DE TESTES
-- Cada teste tenta um ataque real como usuário autenticado e verifica se o banco BLOQUEIA.
-- Resultado: uma linha por teste (PASSOU / FALHOU). Tudo roda dentro de uma transação desfeita no fim.
-- ============================================================================
\set ON_ERROR_STOP 1
begin;
set local client_min_messages = warning;

create temp table _res (n serial, teste text, ok boolean, detalhe text);
grant all on _res to authenticated, anon;
grant usage, select on sequence _res_n_seq to authenticated, anon;

-- Contas de teste (ids fixos, e-mails .invalid). Nunca toca contas reais.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-a000-00000000000a', 'ana@teste.invalid',  '{"name":"Ana Teste","username":"ana_teste"}'),
  ('00000000-0000-4000-a000-00000000000b', 'bia@teste.invalid',  '{"name":"Bia Teste","username":"bia_teste"}'),
  ('00000000-0000-4000-a000-00000000000c', 'caio@teste.invalid', '{"name":"Caio Teste","username":"caio_teste"}');

-- Ana e Bia têm uma conversa privada (criada pela RPC, como no app).
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000a';
select public.luminova_start_conversation('00000000-0000-4000-a000-00000000000b') as conv_ab \gset
select set_config('t.conv_ab', :'conv_ab', false) as _ignore \gset
insert into public.messages (conversation_id, sender_id, content) values (:'conv_ab', auth.uid(), 'segredo da Ana para a Bia');
reset role;

-- Caio tem a própria conversa com Ana (para ter uma linha em conversation_members).
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000c';
select public.luminova_start_conversation('00000000-0000-4000-a000-00000000000a') as conv_ca \gset
select set_config('t.conv_ca', :'conv_ca', false) as _ignore \gset
reset role;

-- ---------------------------------------------------------------------------
-- T1: Caio NÃO pode ler mensagens da conversa Ana↔Bia
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000c';
insert into _res (teste, ok, detalhe)
select 'T1 terceiro não lê mensagens privadas', count(*) = 0, count(*) || ' mensagens visíveis'
from public.messages where conversation_id = :'conv_ab';

-- T2: Caio NÃO pode se infiltrar trocando o conversation_id da própria participação
do $$
declare n int;
begin
  begin
    update public.conversation_members set conversation_id = current_setting('t.conv_ab')::uuid
     where user_id = auth.uid() and conversation_id = current_setting('t.conv_ca')::uuid;
    get diagnostics n = row_count;
  exception when others then n := 0; end;
  insert into _res (teste, ok, detalhe) values ('T2 não sequestra conversa alterando conversation_members', n = 0, n || ' linhas alteradas');
end $$;
insert into _res (teste, ok, detalhe)
select 'T2b após tentativa, continua sem ler a conversa', count(*) = 0, count(*) || ' mensagens visíveis'
from public.messages where conversation_id = :'conv_ab';
reset role;

-- T3: Caio NÃO pode mover a própria mensagem para dentro da conversa de outras pessoas
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000c';
do $$ begin insert into public.messages (conversation_id, sender_id, content) values (current_setting('t.conv_ca')::uuid, auth.uid(), 'msg do caio'); exception when others then null; end $$;
do $$
declare n int;
begin
  begin
    update public.messages set conversation_id = current_setting('t.conv_ab')::uuid where sender_id = auth.uid();
    get diagnostics n = row_count;
  exception when others then n := 0; end;
  insert into _res (teste, ok, detalhe) values ('T3 não injeta mensagem em conversa alheia via UPDATE', n = 0, n || ' linhas movidas');
end $$;
reset role;

-- T4: Ninguém se promove a admin nem se marca como IA
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000c';
do $$
declare ok boolean := false;
begin
  begin update public.profiles set role = 'admin' where id = auth.uid(); exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('T4 não se promove a admin', ok, '');
  ok := false;
  begin update public.profiles set is_ai = true where id = auth.uid(); exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('T4b não se marca como IA', ok, '');
end $$;
reset role;

-- T5: Ninguém edita o perfil de outra pessoa
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000c';
do $$
declare n int;
begin
  update public.profiles set bio = 'hackeado' where id = '00000000-0000-4000-a000-00000000000a';
  get diagnostics n = row_count;
  insert into _res (teste, ok, detalhe) values ('T5 não edita perfil alheio', n = 0, n || ' linhas');
end $$;
reset role;

-- T6: Caio não apaga publicação da Ana
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000a';
insert into public.posts (author_id, content) values (auth.uid(), 'post público da Ana') returning id as post_a \gset
select set_config('t.post_a', :'post_a', false) as _ignore \gset
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000c';
do $$
declare n int;
begin
  delete from public.posts where id = current_setting('t.post_a')::uuid; get diagnostics n = row_count;
  insert into _res (teste, ok, detalhe) values ('T6 não apaga post alheio', n = 0, n || ' linhas');
  update public.posts set content = 'editado' where id = current_setting('t.post_a')::uuid; get diagnostics n = row_count;
  insert into _res (teste, ok, detalhe) values ('T6b não edita post alheio', n = 0, n || ' linhas');
end $$;
reset role;

-- T7: Caio não lê os bloqueios nem as notificações de outra pessoa
insert into public.follows (follower_id, followed_id) values ('00000000-0000-4000-a000-00000000000a','00000000-0000-4000-a000-00000000000b'), ('00000000-0000-4000-a000-00000000000b','00000000-0000-4000-a000-00000000000a');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000a';
insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), '00000000-0000-4000-a000-00000000000b');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000c';
insert into _res (teste, ok, detalhe)
select 'T7 não vê bloqueios alheios', count(*) = 0, count(*) || ' linhas' from public.blocks;
reset role;

insert into _res (teste, ok, detalhe)
select 'T7b bloqueio desfaz o seguir nos dois sentidos', count(*) = 0, count(*) || ' follows restantes'
from public.follows where (follower_id, followed_id) in (('00000000-0000-4000-a000-00000000000a'::uuid, '00000000-0000-4000-a000-00000000000b'::uuid), ('00000000-0000-4000-a000-00000000000b'::uuid, '00000000-0000-4000-a000-00000000000a'::uuid));

-- T8: Depois do bloqueio, Bia não envia mensagem à Ana
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000b';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.messages (conversation_id, sender_id, content) values (current_setting('t.conv_ab')::uuid, auth.uid(), 'oi?');
  exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('T8 pessoa bloqueada não envia mensagem', ok, '');
end $$;
reset role;

-- T9: Visitante (anon) não lê mensagens, conversas, bloqueios nem denúncias
set local role anon;
set local request.jwt.claim.sub = '';
do $$
declare n int := 0; m int;
begin
  begin select count(*) into m from public.messages; n := n + m; exception when others then null; end;
  begin select count(*) into m from public.conversations; n := n + m; exception when others then null; end;
  begin select count(*) into m from public.blocks; n := n + m; exception when others then null; end;
  begin select count(*) into m from public.reports; n := n + m; exception when others then null; end;
  insert into _res (teste, ok, detalhe) values ('T9 visitante não lê dados privados', n = 0, n || ' linhas');
end $$;
reset role;

-- T10: username com maiúsculas não duplica um existente (ana_teste x ANA_TESTE)
do $$
declare ok boolean := false;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values ('00000000-0000-4000-a000-0000000000dd', 'dup@teste.invalid', '{"name":"Dup","username":"ANA_TESTE"}');
    ok := (select count(*) from public.profiles where lower(username) = 'ana_teste') = 1;
  exception when others then ok := false; end;
  insert into _res (teste, ok, detalhe) values ('T10 cadastro com username em uso não quebra nem duplica', ok, '');
end $$;

-- T11: Membro ativo de comunidade privada consegue ler a comunidade
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000a';
insert into public.communities (owner_id, name, slug, visibility, join_policy)
values (auth.uid(), 'Clube Privado', 'clube-privado-teste', 'private', 'approval') returning id as com_p \gset
select set_config('t.com_p', :'com_p', false) as _ignore \gset
reset role;
insert into public.community_members (community_id, user_id, role, status) values (:'com_p', '00000000-0000-4000-a000-00000000000b', 'member', 'active');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000b';
insert into _res (teste, ok, detalhe)
select 'T11 membro ativo enxerga comunidade privada', count(*) = 1, count(*) || ' linhas' from public.communities where id = :'com_p';
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000c';
insert into _res (teste, ok, detalhe)
select 'T11b não membro NÃO enxerga comunidade privada', count(*) = 0, count(*) || ' linhas' from public.communities where id = :'com_p';
reset role;

-- T12: Denúncia de mensagem privada por terceiro não vaza conteúdo
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-00000000000c';
do $$
declare ok boolean := true; mid uuid;
begin
  select id into mid from public.messages where conversation_id = current_setting('t.conv_ab')::uuid limit 1;
  ok := mid is null;
  insert into _res (teste, ok, detalhe) values ('T12 terceiro não descobre id de mensagem alheia', ok, '');
end $$;
reset role;

select n, case when ok then 'PASSOU' else 'FALHOU' end as resultado, teste, detalhe from _res order by n;
select count(*) filter (where ok) || '/' || count(*) || ' testes de isolamento passaram' as resumo from _res;
rollback;
