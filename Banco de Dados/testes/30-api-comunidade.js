#!/usr/bin/env node
/* Teste de API (PostgREST local, igual ao Supabase): uma conta COMUM cria uma comunidade e a página
 * de detalhe consegue carregá-la com a MESMA consulta do comunidade-detalhe.html.
 * Pré-requisitos: banco local (aplicar.sh) + container lumi-rest na porta 3300.
 *   node "Banco de Dados/testes/30-api-comunidade.js"
 */
"use strict";
const crypto = require("crypto");
const { execSync } = require("child_process");
const API = process.env.API || "http://localhost:3300";
const SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub, role = "authenticated") => {
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
const sql = (q) => execSync(`docker exec -i lumi-pg psql -qtA -U postgres -d luminova_test`, { input: q }).toString().trim();
async function call(method, path, token, body, extra = {}) {
  const r = await fetch(API + path, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...extra }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}
let fail = 0;
const ok = (name, cond, detail) => { console.log((cond ? "PASSOU " : "FALHOU ") + name + (detail ? " — " + detail : "")); if (!cond) fail++; };

(async () => {
  const uid = "00000000-0000-4000-c000-00000000000" + Math.floor(Math.random() * 9);
  sql(`delete from auth.users where id='${uid}'; insert into auth.users (id,email,raw_user_meta_data) values ('${uid}','sunny${Date.now()}@teste.invalid','{"name":"Sunny Teste","username":"sunny_t${Date.now() % 100000}"}');`);
  const tk = jwt(uid);
  // mesmo insert do comunidades.js
  const ins = await call("POST", "/communities?select=id", tk,
    { owner_id: uid, name: "Clube de Teste", slug: "clube-teste-" + Date.now(), description: "teste", visibility: "public", join_policy: "open" },
    { Prefer: "return=representation", Accept: "application/vnd.pgrst.object+json" });
  ok("conta comum cria comunidade", ins.status === 201, `HTTP ${ins.status} ${JSON.stringify(ins.body).slice(0, 120)}`);
  const id = ins.body && ins.body.id;
  const base = "id,owner_id,name,slug,description,category_id,avatar_url,cover_url,visibility,join_policy,rules,settings,welcome_text,created_at,owner:profiles!communities_owner_id_fkey(id,username,display_name,avatar_url)";
  const old = await call("GET", `/communities?select=${base},category:interests(id,name,slug)&id=eq.${id}`, tk);
  console.log(`       consulta ANTIGA da página (sem nome do relacionamento): HTTP ${old.status} ${old.body && old.body.code ? old.body.code : ""}`);
  const neu = await call("GET", `/communities?select=${base},category:interests!communities_category_id_fkey(id,name,slug)&id=eq.${id}`, tk);
  ok("consulta NOVA da página carrega a comunidade", neu.status === 200 && neu.body.length === 1, `HTTP ${neu.status}`);
  if (process.argv.includes("--exigir-antiga")) ok("consulta ANTIGA também funciona (correção pelo banco)", old.status === 200 && old.body.length === 1, `HTTP ${old.status} ${old.body && old.body.code || ""}`);
  const mem = await call("GET", `/community_members?select=role,status&community_id=eq.${id}&user_id=eq.${uid}`, tk);
  ok("criadora vira membro 'owner' automaticamente", mem.status === 200 && mem.body[0] && mem.body[0].role === "owner", JSON.stringify(mem.body));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
