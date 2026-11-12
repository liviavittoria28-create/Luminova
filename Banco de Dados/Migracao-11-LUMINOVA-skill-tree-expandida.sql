-- ============================================================================
-- LUMINOVA | Migração 11 — Skill Tree expandida
-- Execute no Supabase > SQL Editor DEPOIS da Migração 10. Idempotente e não destrutiva:
-- nenhum nó já resgatado é apagado e o XP de ninguém muda.
--
-- Cada ramo passa a ter 4 estágios em sequência (cumprir a meta → resgatar → abre o próximo),
-- mais um caminho lateral por ramo e o nó final "Constelação Completa".
-- ============================================================================
begin;

alter table public.skill_nodes drop constraint if exists skill_nodes_metric_check;
alter table public.skill_nodes add constraint skill_nodes_metric_check check (metric in (
  'none','posts','comments','communities_joined','communities_created','following','followers',
  'profile_complete','thanks_received','thanks_given','skills'));

insert into public.skill_nodes (node_key,name,branch,description,xp_required,xp_reward,requires,metric,metric_min,pos_x,pos_y) values
 ('centelha','Centelha Primordial','origem','Sua jornada começa ao publicar a primeira ideia.',0,20,'{}','posts',1,480,400),
 -- criação
 ('voz','Primeira Voz','criacao','Publique 3 ideias.',20,20,'{centelha}','posts',3,370,310),
 ('autor','Autor Constante','criacao','Publique 10 ideias.',80,40,'{voz}','posts',10,270,230),
 ('criador','Criador Prolífico','criacao','Publique 25 ideias.',200,60,'{autor}','posts',25,175,150),
 ('lenda','Lenda Criativa','criacao','Publique 50 ideias.',450,100,'{criador}','posts',50,85,70),
 ('perfil','Perfil Completo','criacao','Preencha nome e biografia.',0,15,'{centelha}','profile_complete',1,320,400),
 ('gratidao','Reconhecido','criacao','Receba 3 agradecimentos no seu mural.',60,30,'{perfil}','thanks_received',3,170,400),
 -- colaboração
 ('conversa','Boa Conversa','colaboracao','Faça 3 comentários.',20,20,'{centelha}','comments',3,590,310),
 ('colaborador','Colaborador','colaboracao','Faça 15 comentários.',80,40,'{conversa}','comments',15,690,230),
 ('voz-ativa','Voz Ativa','colaboracao','Faça 40 comentários.',200,60,'{colaborador}','comments',40,785,150),
 ('pilar','Pilar da Conversa','colaboracao','Faça 100 comentários.',450,100,'{voz-ativa}','comments',100,875,70),
 ('generoso','Generoso','colaboracao','Agradeça 3 publicações de outras pessoas.',40,25,'{conversa}','thanks_given',3,640,400),
 ('coracao','Coração Aberto','colaboracao','Agradeça 15 publicações.',150,50,'{generoso}','thanks_given',15,790,400),
 -- comunidade
 ('pertencer','Pertencer','comunidade','Entre em uma comunidade.',20,25,'{centelha}','communities_joined',1,370,490),
 ('fundador','Fundador','comunidade','Crie uma comunidade.',60,40,'{pertencer}','communities_created',1,270,570),
 ('arquiteto','Arquiteto de Mundos','comunidade','Crie 3 comunidades.',250,80,'{fundador}','communities_created',3,175,650),
 ('tribos','Viajante de Tribos','comunidade','Participe de 5 comunidades.',120,40,'{pertencer}','communities_joined',5,390,640),
 -- exploração
 ('conexao','Conexão','exploracao','Siga 3 pessoas.',20,20,'{centelha}','following',3,590,490),
 ('influente','Influente','exploracao','Tenha 5 seguidores.',100,50,'{conexao}','followers',5,690,570),
 ('farol','Farol','exploracao','Tenha 25 seguidores.',350,90,'{influente}','followers',25,785,650),
 ('rede','Rede Viva','exploracao','Siga 15 pessoas.',150,40,'{conexao}','following',15,570,640),
 -- final
 ('constelacao','Constelação Completa','origem','Acenda 18 nós da árvore, incluindo Arquiteto de Mundos e Farol.',600,150,'{arquiteto,farol}','skills',18,480,730)
on conflict (node_key) do update set name = excluded.name, branch = excluded.branch,
  description = excluded.description, xp_required = excluded.xp_required, xp_reward = excluded.xp_reward,
  requires = excluded.requires, metric = excluded.metric, metric_min = excluded.metric_min,
  pos_x = excluded.pos_x, pos_y = excluded.pos_y;

insert into public.luminova_schema_versions (version, name)
values (11, 'Migracao-11 (Skill Tree expandida)')
on conflict (version) do nothing;

commit;
notify pgrst, 'reload schema';
