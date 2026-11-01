-- Dados FICTÍCIOS só para o banco LOCAL de testes (luminova_test): servem para conferir o visual
-- das páginas logadas (feed, comentários com respostas, comunidade, perfil). NUNCA rode no Supabase.
-- A conta "Pessoa Teste" é a que o proxy local devolve em /auth/v1/user.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-d000-000000000001', 'pessoa.visual@teste.invalid', '{"username":"pessoa_visual","display_name":"Pessoa Teste"}'),
  ('00000000-0000-4000-d000-000000000002', 'ana.visual@teste.invalid', '{"username":"ana_visual","display_name":"Ana (teste)"}')
on conflict (id) do nothing;

do $$
declare c uuid; p1 uuid; p2 uuid; p3 uuid; k1 uuid; k2 uuid;
begin
  if exists (select 1 from public.posts where content like 'Teste visual:%') then return; end if;
  insert into public.posts (author_id, content) values ('00000000-0000-4000-d000-000000000002', 'Teste visual: terminei minha primeira fanart do anime da temporada! O que acharam das cores? #desenho') returning id into p1;
  insert into public.posts (author_id, content) values ('00000000-0000-4000-d000-000000000001', 'Teste visual: alguém joga RPG de mesa aos sábados? Procurando grupo para começar. #rpg') returning id into p2;
  insert into public.comments (post_id, author_id, content) values (p1, '00000000-0000-4000-d000-000000000001', 'Ficou lindo! As cores do céu estão perfeitas.') returning id into k1;
  insert into public.comments (post_id, author_id, content, parent_comment_id) values (p1, '00000000-0000-4000-d000-000000000002', 'Obrigada!! Usei aquarela digital.', k1) returning id into k2;
  insert into public.comments (post_id, author_id, content, parent_comment_id) values (p1, '00000000-0000-4000-d000-000000000001', 'Passa o pincel depois?', k2);
  insert into public.post_reactions (post_id, user_id) values (p1, '00000000-0000-4000-d000-000000000001');
  insert into public.communities (owner_id, name, slug, description) values ('00000000-0000-4000-d000-000000000001', 'Rabiscos (teste)', 'rabiscos-teste', 'Comunidade de teste para desenho e fanart.') returning id into c;
  insert into public.community_members (community_id, user_id, role, status) values (c, '00000000-0000-4000-d000-000000000002', 'member', 'active') on conflict do nothing;
  insert into public.posts (author_id, content) values ('00000000-0000-4000-d000-000000000002', 'Teste visual: post dentro da comunidade. Desafio da semana: desenhar o céu ao entardecer!') returning id into p3;
  insert into public.community_posts (community_id, post_id) values (c, p3);
  insert into public.comments (post_id, author_id, content) values (p3, '00000000-0000-4000-d000-000000000001', 'Topo! Vou postar o meu amanhã.') returning id into k1;
  insert into public.comments (post_id, author_id, content, parent_comment_id) values (p3, '00000000-0000-4000-d000-000000000002', 'Resposta: manda ver, quero ver!', k1);
end $$;
