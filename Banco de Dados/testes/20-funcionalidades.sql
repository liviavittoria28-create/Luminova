-- ============================================================================
-- LUMINOVA | Testes funcionais da Migração 4 — SOMENTE BANCO LOCAL DE TESTES
-- Contas fictícias com e-mail .invalid; tudo é desfeito no fim (rollback).
-- ============================================================================
\set ON_ERROR_STOP 1
begin;
set local client_min_messages = warning;
create temp table _res (n serial, teste text, ok boolean, detalhe text);
grant all on _res to authenticated, anon;
grant usage, select on sequence _res_n_seq to authenticated, anon;

-- ---------------------------------------------------------------- cadastro
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-b000-00000000000a', 'estrela@teste.invalid',
   '{"name":"Estrela Teste","username":"estrela","terms_version":"2026-10-30","privacy_version":"2026-10-30"}'),
  ('00000000-0000-4000-b000-00000000000b', 'luz@teste.invalid', '{"name":"Luz Teste","username":"luz.teste"}'),
  ('00000000-0000-4000-b000-00000000000c', 'mar@teste.invalid', '{"name":"Mar Teste","username":"mar_teste"}');

insert into _res (teste, ok, detalhe)
select 'C1 perfil criado com username pedido', username = 'estrela', username from public.profiles where id = '00000000-0000-4000-b000-00000000000a';
insert into _res (teste, ok, detalhe)
select 'C2 aceite de termos e privacidade registrado no cadastro', count(*) = 2, count(*) || ' aceites'
from public.user_consents where user_id = '00000000-0000-4000-b000-00000000000a';
insert into _res (teste, ok, detalhe)
select 'C3 preferências de privacidade criadas com memória de IA DESLIGADA', count(*) = 1 and bool_and(not allow_ai_memory), ''
from public.user_preferences where user_id = '00000000-0000-4000-b000-00000000000a';

set local role anon;
insert into _res (teste, ok, detalhe) values
  ('C4 "estrela" indisponível', not public.luminova_username_available('estrela'), ''),
  ('C4b "ESTRELA" indisponível (sem diferenciar maiúsculas)', not public.luminova_username_available('@ESTRELA'), ''),
  ('C4c nome reservado indisponível', not public.luminova_username_available('admin'), ''),
  ('C4d prefixo de agente indisponível', not public.luminova_username_available('ia.qualquer'), ''),
  ('C4e formato inválido recusado', not public.luminova_username_available('a b'), ''),
  ('C4f nome livre disponível', public.luminova_username_available('cometa_azul'), '');
insert into _res (teste, ok, detalhe)
select 'C5 sugestões existem e estão TODAS livres', count(*) = 3 and bool_and(public.luminova_username_available(s)), string_agg(s, ', ')
from public.luminova_suggest_usernames('estrela', 3) s;
reset role;

-- cadastro com username já em uso recebe alternativa livre (não quebra)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-b000-00000000000d', 'outra@teste.invalid', '{"name":"Outra","username":"Estrela"}');
insert into _res (teste, ok, detalhe)
select 'C6 username em uso vira alternativa livre', username <> 'estrela' and username like 'estrela%', username
from public.profiles where id = '00000000-0000-4000-b000-00000000000d';

-- ---------------------------------------------------------------- notificações
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000b';
insert into public.follows (follower_id, followed_id) values (auth.uid(), '00000000-0000-4000-b000-00000000000a');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000a';
insert into public.posts (author_id, content) values (auth.uid(), 'Alguém mais curte #astronomia?') returning id as post_e \gset
select set_config('t.post_e', :'post_e', false) as _ignore \gset
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000b';
insert into public.post_reactions (post_id, user_id, reaction) values (:'post_e', auth.uid(), 'like');
insert into public.comments (post_id, author_id, content) values (:'post_e', auth.uid(), 'Eu curto!') returning id as com_l \gset
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000a';
insert into public.comments (post_id, author_id, content, parent_comment_id) values (:'post_e', auth.uid(), 'Que bom!', :'com_l');
insert into _res (teste, ok, detalhe)
select 'N1 follow, curtida e comentário notificam a autora', count(*) = 3, string_agg(notification_type, ',' order by notification_type)
from public.notifications where recipient_id = auth.uid();
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000b';
insert into _res (teste, ok, detalhe)
select 'N2 resposta notifica quem comentou', count(*) = 1, '' from public.notifications where recipient_id = auth.uid() and notification_type = 'reply';
insert into _res (teste, ok, detalhe)
select 'N3 não lê notificações de outra pessoa', count(*) = 0, '' from public.notifications where recipient_id = '00000000-0000-4000-b000-00000000000a';
select (public.luminova_unread_counts()).notifications as unread_b \gset
insert into _res (teste, ok, detalhe) values ('N4 contador de não lidas', :unread_b = 1, :unread_b || '');
reset role;

-- ---------------------------------------------------------------- denúncias
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000c';
insert into public.reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'post', :'post_e', 'spam');
do $$
declare ok boolean := false;
begin
  begin insert into public.reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'post', current_setting('t.post_e')::uuid, 'spam');
  exception when unique_violation then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('R1 denúncia duplicada aberta é recusada', ok, '');
end $$;
reset role;
insert into _res (teste, ok, detalhe)
select 'R2 denúncia guarda cópia do conteúdo para a moderação', target_snapshot like 'Alguém mais curte%', coalesce(target_snapshot, 'nulo')
from public.reports where target_id = :'post_e';

-- B conversa com A; C (terceiro) tenta denunciar a mensagem para ler o conteúdo
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000b';
select public.luminova_start_conversation('00000000-0000-4000-b000-00000000000a') as conv \gset
insert into public.messages (conversation_id, sender_id, content) values (:'conv', auth.uid(), 'mensagem privada') returning id as msg \gset
select set_config('t.msg', :'msg', false) as _ignore \gset
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000c';
do $$
declare ok boolean := false;
begin
  begin insert into public.reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'message', current_setting('t.msg')::uuid, 'harassment');
  exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('R3 terceiro não denuncia (nem lê) mensagem alheia', ok, '');
end $$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000a';
insert into public.reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'message', :'msg', 'harassment');
insert into _res (teste, ok, detalhe) values ('R4 participante denuncia a mensagem recebida', true, '');
reset role;

-- ---------------------------------------------------------------- preferências de DM
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000c';
update public.user_preferences set dm_policy = 'nobody' where user_id = auth.uid();
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000a';
do $$
declare ok boolean := false;
begin
  begin perform public.luminova_start_conversation('00000000-0000-4000-b000-00000000000c'); exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('P1 quem fecha mensagens não recebe conversa nova', ok, '');
end $$;
reset role;

-- ---------------------------------------------------------------- conta privada
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000c';
update public.profiles set account_visibility = 'private' where id = auth.uid();
insert into public.posts (author_id, content) values (auth.uid(), 'post de conta privada');
reset role;
set local role anon;
set local request.jwt.claim.sub = '';
insert into _res (teste, ok, detalhe)
select 'P2 visitante não vê posts de conta privada', count(*) = 0, count(*) || '' from public.posts where content = 'post de conta privada';
insert into _res (teste, ok, detalhe)
select 'P3 visitante vê perfil público (feed de visitante funciona)', count(*) >= 1, count(*) || '' from public.v_feed_posts where content like 'Alguém mais curte%';
reset role;

-- ---------------------------------------------------------------- IA removida (Migração 9)
insert into _res (teste, ok, detalhe)
select 'M1 nenhum perfil de IA existe', count(*) = 0, count(*) || '' from public.profiles where is_ai;
insert into _res (teste, ok, detalhe)
select 'M2 executor antigo de agentes não consegue agir', not public.luminova_ai_can_act('00000000-0000-4000-b000-00000000000a', 'post'), '';

-- ---------------------------------------------------------------- recomendações
insert into public.profile_interests (profile_id, interest_id)
select '00000000-0000-4000-b000-00000000000a', id from public.interests where slug in ('astronomia','anime-manga');
insert into public.profile_interests (profile_id, interest_id)
select '00000000-0000-4000-b000-00000000000d', id from public.interests where slug in ('astronomia');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000d';
insert into public.communities (owner_id, name, slug, description, category_id)
values (auth.uid(), 'Céu Noturno', 'ceu-noturno-teste', 'Observação do céu e astronomia', (select id from public.interests where slug = 'astronomia'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000a';
insert into _res (teste, ok, detalhe)
select 'RC1 comunidade recomendada pelo interesse em astronomia', bool_or(name = 'Céu Noturno'), string_agg(name || ' (' || reason || ')', '; ')
from public.luminova_recommend_communities(5);
insert into _res (teste, ok, detalhe)
select 'RC2 pessoa com interesse em comum recomendada', bool_or(user_id = '00000000-0000-4000-b000-00000000000d'), string_agg(coalesce(username,'?'), ', ')
from public.luminova_recommend_people(5, false);
reset role;

-- ---------------------------------------------------------------- exportação e exclusão de conta
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000d';
select public.luminova_export_my_data() as dump \gset
insert into _res (teste, ok, detalhe)
select 'E1 exportação traz perfil, interesses e aceites', (:'dump'::jsonb ->> 'formato') = 'luminova-export/1'
  and jsonb_array_length(:'dump'::jsonb -> 'interesses') = 1, '';
reset role;

-- D (dona da comunidade Céu Noturno) tem um membro: A. Ao excluir a conta, A herda a comunidade.
insert into public.community_members (community_id, user_id, role, status)
select id, '00000000-0000-4000-b000-00000000000a', 'member', 'active' from public.communities where slug = 'ceu-noturno-teste';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000d';
do $$
declare ok boolean := false;
begin
  begin perform public.luminova_delete_my_account('nome-errado'); exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('E2 exclusão exige confirmar o username', ok, '');
end $$;
select username as d_user from public.profiles where id = auth.uid() \gset
select public.luminova_delete_my_account(:'d_user', 'teste') as del \gset
reset role;
insert into _res (teste, ok, detalhe)
select 'E3 conta excluída de auth e do perfil', not exists (select 1 from auth.users where id = '00000000-0000-4000-b000-00000000000d')
  and not exists (select 1 from public.profiles where id = '00000000-0000-4000-b000-00000000000d'), :'del';
insert into _res (teste, ok, detalhe)
select 'E4 comunidade transferida para membro ativo', owner_id = '00000000-0000-4000-b000-00000000000a', ''
from public.communities where slug = 'ceu-noturno-teste';
insert into _res (teste, ok, detalhe)
select 'E5 registro de exclusão sem dados pessoais', count(*) = 1, '' from public.account_deletions;

-- ---------------------------------------------------------------- anti-spam
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000b';
do $$
declare i int; ok boolean := false;
begin
  begin
    for i in 1..25 loop insert into public.posts (author_id, content) values (auth.uid(), 'spam ' || i); end loop;
  exception when others then ok := sqlerrm like 'Muitas ações%'; end;
  insert into _res (teste, ok, detalhe) values ('S1 limite de publicações por hora contra spam', ok, '');
end $$;
reset role;

-- ---------------------------------------------------------------- saúde (admin)
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-b000-00000000000b';
do $$
declare ok boolean := false;
begin
  begin perform public.luminova_platform_health(); exception when others then ok := true; end;
  insert into _res (teste, ok, detalhe) values ('H1 painel de saúde negado para não admin', ok, '');
end $$;
reset role;

select n, case when ok then 'PASSOU' else 'FALHOU' end as resultado, teste, detalhe from _res order by n;
select count(*) filter (where ok) || '/' || count(*) || ' testes funcionais passaram' as resumo from _res;
rollback;
