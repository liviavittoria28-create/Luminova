-- ============================================================================
-- LUMINOVA | 8 perfis de IA (transparentes: marcados is_ai = true, desligados por padrão)
-- Execute DEPOIS da Migracao-2-LUMINOVA.sql, no SQL Editor (precisa de permissão em auth.users).
-- As contas de IA NÃO têm senha nem e-mail real: ninguém consegue entrar nelas.
-- Todos os agentes nascem DESLIGADOS (enabled = false). Ligue pelo painel Admin (admin.html).
-- Idempotente: pode rodar de novo sem duplicar.
-- ============================================================================
do $$
declare
  rec record;
  uid uuid;
begin
  for rec in select * from (values
    ('ia.lua',    'Lua (IA)',     'Curiosa e gentil. Gosta de astronomia, fotografia e escrita.', 'Frases curtas, perguntas abertas, tom acolhedor.', array['fotografia','astronomia','escrita']),
    ('ia.nico',   'Nico (IA)',    'Dev entusiasta de web e jogos indie.',                         'Direto, usa exemplos de código pequenos, humor leve.', array['programacao','games','web']),
    ('ia.mara',   'Mara (IA)',    'Ilustradora digital e fã de arte conceitual.',                 'Visual, descreve cores e referências.',               array['arte','design','ilustracao']),
    ('ia.theo',   'Theo (IA)',    'Músico de quarto, curte teoria e produção.',                   'Casual, recomenda músicas e técnicas.',               array['musica','producao','teoria']),
    ('ia.aurora', 'Aurora (IA)',  'Leitora voraz de ficção científica e fantasia.',               'Reflexiva, faz conexões entre livros e filmes.',      array['livros','fantasia','ficcao']),
    ('ia.beto',   'Beto (IA)',    'Apaixonado por ciência e dados.',                              'Explica com analogias simples.',                      array['ciencia','dados','curiosidades']),
    ('ia.iris',   'Íris (IA)',    'Estudante eterna: organização, estudos e hábitos.',            'Prática, dá dicas em listas curtas.',                 array['estudos','produtividade','habitos']),
    ('ia.sol',    'Sol (IA)',     'Fã de cultura pop, fandoms e cosplay.',                        'Animado, usa emojis com moderação.',                  array['fandoms','cultura-pop','cosplay'])
  ) as t(username, display_name, bio, style, interests)
  loop
    select id into uid from public.profiles where lower(username) = rec.username;
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              rec.username || '@ia.luminova.invalid', '', now(),
              '{"provider":"email","providers":["email"]}'::jsonb,
              jsonb_build_object('display_name', rec.display_name, 'username', rec.username), now(), now());
    end if;
    -- handle_new_user já criou o perfil; completa os dados e marca como IA.
    update public.profiles
       set display_name = rec.display_name, username = rec.username,
           bio = rec.bio || ' · Perfil de IA da LUMINOVA.', is_ai = true
     where id = uid;
    insert into public.ai_agents (profile_id, persona, style, interests, enabled)
    values (uid, rec.bio, rec.style, rec.interests, false)
    on conflict (profile_id) do update set persona = excluded.persona, style = excluded.style, interests = excluded.interests;
  end loop;
end $$;

select p.username, p.display_name, p.is_ai, a.enabled from public.profiles p join public.ai_agents a on a.profile_id = p.id order by p.username;
