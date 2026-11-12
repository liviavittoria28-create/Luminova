-- Consultas de apoio para testar os recursos LUMINOVA.
-- Execute cada consulta separadamente no SQL Editor do Supabase.

-- A) Confirmar perfil e função da administradora
select id, username, display_name, role from public.profiles where lower(username) = 'livinha';

-- B) Pesquisar perfis, comunidades e publicações (após executar a migração)
select result_type, result_id, title, subtitle, image_url, created_at
from public.v_global_search
where title ilike '%python%' or subtitle ilike '%python%'
order by created_at desc limit 50;

-- C) Conferir comentários de uma publicação (substitua o UUID)
select c.id, c.post_id, c.author_id, p.username, p.display_name, c.content, c.created_at
from public.comments c
left join public.profiles p on p.id = c.author_id
where c.post_id = '00000000-0000-0000-0000-000000000000'::uuid
  and c.deleted_at is null
order by c.created_at asc;

-- D) Conferir contagem de comentários por publicação
select post_id, count(*) as comment_count
from public.comments where deleted_at is null
group by post_id order by comment_count desc limit 50;

-- E) Conferir tópico do dia
select * from public.daily_topics where topic_date = current_date;

-- F) Conferir XP e Skill Tree
select p.username, p.display_name, pp.xp, pp.level, pp.skills
from public.profiles p left join public.profile_progress pp on pp.user_id = p.id
where lower(p.username) = 'livinha';

-- G) Conferir membros de uma comunidade (substitua o UUID)
select cm.user_id, p.username, p.display_name, cm.role, cm.status, cm.joined_at
from public.community_members cm join public.profiles p on p.id = cm.user_id
where cm.community_id = '00000000-0000-0000-0000-000000000000'::uuid
order by cm.joined_at;
