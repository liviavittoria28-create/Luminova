-- Execute no SQL Editor do Supabase depois de confirmar que esta é sua conta.
-- Este arquivo exige exatamente um perfil com username livinha; não usa email nem nome de exibição.
begin;
do $$
declare n integer;
begin
  select count(*) into n from public.profiles where lower(username) = 'livinha';
  if n <> 1 then
    raise exception 'Esperava encontrar exatamente um perfil com username livinha; encontrados: %. Confira o username em public.profiles.', n;
  end if;
  update public.profiles set role = 'admin', updated_at = now() where lower(username) = 'livinha';
end $$;
commit;

-- Confira o resultado:
select id, username, display_name, role
from public.profiles
where lower(username) = 'livinha';
