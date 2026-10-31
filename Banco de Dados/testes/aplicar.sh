#!/usr/bin/env bash
# Aplica stub + schema + migrações num Postgres LOCAL de testes (container lumi-pg).
# Uso: bash "Banco de Dados/testes/aplicar.sh" [--reset]
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
C=${PG_CONTAINER:-lumi-pg}
run() { echo "→ $1"; docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$C" psql -q -v ON_ERROR_STOP=1 -U postgres -d luminova_test < "$DIR/$1" >/dev/null; }
if [[ "${1:-}" == "--reset" ]]; then
  docker exec "$C" psql -q -U postgres -c "drop database if exists luminova_test" >/dev/null
fi
docker exec "$C" psql -q -U postgres -tc "select 1 from pg_database where datname='luminova_test'" | grep -q 1 \
  || docker exec "$C" psql -q -U postgres -c "create database luminova_test" >/dev/null
run "testes/00-supabase-stub.sql"
run "Banco de dados.sql"
run "Migracao-completa-LUMINOVA.sql"
run "Migracao-2-LUMINOVA.sql"
run "Migracao-3-LUMINOVA.sql"
run "Seed-perfis-IA.sql"
for f in "$DIR"/Migracao-4*.sql "$DIR"/Migracao-5*.sql; do [[ -f "$f" ]] && run "$(basename "$f")"; done
[[ -f "$DIR/Seed-agentes-NOVA-BRAIN.sql" ]] && run "Seed-agentes-NOVA-BRAIN.sql"
echo "OK: schema aplicado em luminova_test"
