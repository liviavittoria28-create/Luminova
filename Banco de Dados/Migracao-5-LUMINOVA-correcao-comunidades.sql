-- ============================================================================
-- LUMINOVA 3.x | Migração 5 — correção "Comunidade não encontrada ou sem permissão"
-- Execute no Supabase > SQL Editor DEPOIS da Migracao-4-LUMINOVA-3x.sql. Idempotente e não destrutiva.
--
-- Causa: a Migração 4 criou community_interests com chave primária (community_id, interest_id).
-- A API do Supabase (PostgREST) passou a ver DOIS caminhos entre communities e interests
-- (a coluna category_id e a tabela de ligação) e recusava a consulta da página da comunidade
-- com o erro PGRST201. A página mostrava isso como "Comunidade não encontrada ou sem permissão".
--
-- Correção: a tabela de ligação ganha uma chave própria (id). Sem as duas colunas na chave primária,
-- a API não a trata mais como ligação muitos-para-muitos e a ambiguidade some. A regra de não repetir
-- a mesma etiqueta continua garantida por um índice único. Nenhum dado é apagado.
-- ============================================================================
begin;

alter table public.community_interests add column if not exists id uuid not null default gen_random_uuid();

do $$
declare pk text; cols text;
begin
  select c.conname, string_agg(a.attname, ',' order by a.attname) into pk, cols
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
   where c.conrelid = 'public.community_interests'::regclass and c.contype = 'p'
   group by c.conname;
  if pk is not null and cols <> 'id' then
    execute format('alter table public.community_interests drop constraint %I', pk);
  end if;
  if pk is null or cols <> 'id' then
    alter table public.community_interests add constraint community_interests_pkey primary key (id);
  end if;
end $$;

create unique index if not exists community_interests_pair_uq on public.community_interests (community_id, interest_id);

insert into public.luminova_schema_versions (version, name)
values (5, 'Migracao-5 (correção da página de comunidade: relação ambígua communities ↔ interests)')
on conflict (version) do nothing;

commit;

-- A API do Supabase recarrega o esquema sozinha; se o erro continuar por alguns segundos, rode:
notify pgrst, 'reload schema';
