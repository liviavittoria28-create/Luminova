-- ============================================================================
-- LUMINOVA 3.x | Migração 9 — remove os perfis de IA (NOVA BRAIN) e TUDO o que eles publicaram
-- Execute DEPOIS da Migracao-6. Pode rodar mesmo que as Migrações 7/8 e os seeds de IA nunca tenham sido executados.
-- Pode rodar mais de uma vez. Feita em um único bloco (sem tabela temporária) para funcionar no SQL Editor do Supabase.
--
-- ATENÇÃO: apaga de vez (não dá para desfazer) apenas o que pertence a perfis com is_ai = true:
--   as contas dos agentes e do elenco, publicações, comentários, curtidas, mensagens, seguidores,
--   participações em comunidades, notificações geradas por eles e conversas privadas com eles.
-- Nenhuma conta de pessoa é apagada. Publicações de pessoas continuam (só perdem os comentários/curtidas de IA).
-- Para conferir antes, rode só esta consulta:
--   select count(*) as perfis_ia, (select count(*) from public.posts po join public.profiles p on p.id = po.author_id where p.is_ai) as posts_ia
--   from public.profiles where is_ai;
-- ============================================================================

do $$
declare
  ia uuid[];
  n_posts bigint;
begin
  select coalesce(array_agg(id), '{}') into ia from public.profiles where is_ai;

  if exists (select 1 from public.profiles where id = any(ia) and role = 'admin') then
    raise exception 'Um perfil marcado como IA é administrador. Nada foi apagado; confira a tabela profiles.';
  end if;
  select count(*) into n_posts from public.posts where author_id = any(ia);
  raise notice 'Perfis de IA removidos: % · publicações de IA apagadas: %', cardinality(ia), n_posts;

  -- conversas privadas com IA (somem para as duas pontas)
  delete from public.conversations c
   where exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = any(ia));
  -- notificações geradas por IA (o vínculo é "set null", então ficariam órfãs)
  delete from public.notifications where actor_id = any(ia);
  -- comunidades criadas por IA (dono é "restrict")
  delete from public.communities where owner_id = any(ia);
  -- publicações e comentários (explícito, mesmo havendo cascade)
  delete from public.comments where author_id = any(ia);
  delete from public.posts where author_id = any(ia);
  -- contas: apagar o usuário apaga o perfil e, em cascata, curtidas, seguidores, membros, mensagens etc.
  delete from auth.users where id = any(ia);
  delete from public.profiles where id = any(ia);

  -- tabelas da NOVA BRAIN ficam vazias (estrutura mantida para não quebrar migrações antigas)
  if to_regclass('public.ai_agent_memories') is not null then execute 'delete from public.ai_agent_memories'; end if;
  if to_regclass('public.ai_agent_relations') is not null then execute 'delete from public.ai_agent_relations'; end if;
  if to_regclass('public.ai_activity_log') is not null then execute 'delete from public.ai_activity_log'; end if;
  if to_regclass('public.ai_agents') is not null then execute 'delete from public.ai_agents'; end if;
end $$;

-- nenhum executor antigo consegue agir de novo, mesmo com a chave secreta
create or replace function public.luminova_ai_can_act(p_agent uuid, p_action text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$ select false $$;
revoke execute on function public.luminova_ai_can_act(uuid, text) from anon, authenticated, public;

insert into public.luminova_schema_versions (version, name)
values (9, 'Migracao-9 (perfis de IA e o conteúdo deles removidos)')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
