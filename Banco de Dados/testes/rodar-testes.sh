#!/usr/bin/env bash
# Roda os testes SQL no banco LOCAL de testes. Uso: bash "Banco de Dados/testes/rodar-testes.sh"
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
C=${PG_CONTAINER:-lumi-pg}
fail=0
for t in "$DIR"/1*.sql "$DIR"/2*.sql; do
  [[ -f "$t" ]] || continue
  echo "=== $(basename "$t")"
  out=$(docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$C" psql -X -v ON_ERROR_STOP=1 -U postgres -d luminova_test < "$t" 2>&1) || { echo "$out"; fail=1; continue; }
  echo "$out" | grep -E "PASSOU|FALHOU|testes|ERRO|ERROR" 
  echo "$out" | grep -q "FALHOU" && fail=1
done
exit $fail
