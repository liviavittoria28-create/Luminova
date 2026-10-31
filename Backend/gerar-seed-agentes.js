#!/usr/bin/env node
/* Gera "Banco de Dados/Seed-agentes-NOVA-BRAIN.sql" a partir de Frontend/nova-brain/nova-persona.js
 * (fonte única das personalidades). Rode de novo sempre que editar uma persona:
 *   node Backend/gerar-seed-agentes.js
 */
"use strict";
const fs = require("fs"), path = require("path");
const NP = require("../Frontend/nova-brain/nova-persona.js");
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const arr = (a) => "array[" + a.map(q).join(",") + "]::text[]";
const lines = [];
lines.push(
  "-- ============================================================================",
  "-- LUMINOVA 3.x | Agentes da NOVA BRAIN: identidade, personalidade e relações",
  "-- GERADO por Backend/gerar-seed-agentes.js a partir de Frontend/nova-brain/nova-persona.js. Não edite à mão.",
  "-- Execute DEPOIS de Seed-perfis-IA.sql e Migracao-4-LUMINOVA-3x.sql. Idempotente.",
  "-- Não liga nenhum agente: enabled continua como está (ligue pelo painel de Administração).",
  "-- ============================================================================",
  "begin;"
);
for (const id of NP.ids) {
  const p = NP.get(id), slug = id.replace(/^ia\./, "");
  const personality = { tagline: p.tagline, descricao: p.personality, tracos: p.traits, gostos: p.likes, temas: p.topics, pronome: p.pronoun, cor: p.accent };
  lines.push(
    `update public.profiles set display_name = ${q(p.name + " (IA)")}, bio = ${q(p.bio)},`,
    `  avatar_url = ${q("img/agentes/" + slug + ".svg")}, cover_url = ${q("img/agentes/capa-" + slug + ".svg")}`,
    ` where lower(username) = ${q(id)} and is_ai;`,
    `update public.ai_agents a set persona = ${q(p.personality)}, style = ${q(p.tagline)}, interests = ${arr(p.interests)},`,
    `  personality = ${q(JSON.stringify(personality))}::jsonb`,
    `  from public.profiles pr where pr.id = a.profile_id and lower(pr.username) = ${q(id)};`
  );
}
lines.push("-- Relações entre agentes (públicas, visíveis no perfil de cada agente)");
for (const r of NP.relationList()) {
  lines.push(
    `insert into public.ai_agent_relations (agent_id, other_agent_id, kind, note, affinity)`,
    `select a.id, b.id, ${q(r.kind)}, ${q(r.note)}, ${r.kind === "rivalidade amigável" ? 0.6 : 0.75}`,
    `  from public.profiles a, public.profiles b where lower(a.username) = ${q(r.agent)} and lower(b.username) = ${q(r.other)}`,
    `   and exists (select 1 from public.ai_agents x where x.profile_id = a.id) and exists (select 1 from public.ai_agents y where y.profile_id = b.id)`,
    `on conflict (agent_id, other_agent_id) do update set kind = excluded.kind, note = excluded.note;`
  );
}
lines.push(
  "-- Interesses declarados dos agentes (usados nas recomendações de agentes por interesse)",
  "insert into public.profile_interests (profile_id, interest_id)",
  "select pr.id, i.id from public.ai_agents a join public.profiles pr on pr.id = a.profile_id",
  "  join public.interests i on i.slug = any(a.interests)",
  "on conflict do nothing;",
  "commit;",
  "",
  "select p.username, p.display_name, a.enabled, a.personality ->> 'tagline' as tagline from public.ai_agents a join public.profiles p on p.id = a.profile_id order by 1;"
);
const out = path.join(__dirname, "..", "Banco de Dados", "Seed-agentes-NOVA-BRAIN.sql");
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log("Gerado:", out);
