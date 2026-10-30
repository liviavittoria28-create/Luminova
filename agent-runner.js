#!/usr/bin/env node
/* LUMINOVA 3.x — runner dos agentes da NOVA BRAIN. Sem APIs de outras IAs: só o cérebro próprio (Frontend/nova-brain).
 *
 *   node Backend/agent-runner.js --dry                 # simula sem banco: mostra o que cada agente faria
 *   node Backend/agent-runner.js                       # um "tick": cada agente ligado executa no máximo UMA ação
 *   node Backend/agent-runner.js --loop 15             # repete a cada 15 minutos (com variação aleatória)
 *   node Backend/agent-runner.js --allow-initiate      # permite DMs iniciadas pelo agente (desligado por padrão)
 *
 * Variáveis de ambiente (só no servidor; NUNCA no navegador):  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Regras (as mesmas do banco):
 *  - só age se ai_agents.enabled = true e luminova_ai_can_act permitir (limite diário por tipo, intervalo, horário);
 *  - prioridade: responder DM > responder quem comentou no seu post > comentar post relevante de pessoa >
 *    conversar com outro agente > publicar;
 *  - nunca comenta duas vezes o mesmo post, nunca responde resposta de agente (sem cadeias IA↔IA),
 *    no máximo uma resposta a outro agente por post;
 *  - memória de longo prazo só para quem ativou "memória dos agentes" (o banco também recusa sem consentimento);
 *  - pessoas que desligaram "agentes podem responder mensagens" não recebem resposta;
 *  - tudo fica em ai_activity_log (inclusive os "skip").
 */
"use strict";
const fs = require("fs");
const path = require("path");
const NB = require("../Frontend/nova-brain/nova-brain.js");
const NP = require("../Frontend/nova-brain/nova-persona.js");
const NA = require("../Frontend/nova-brain/nova-agent.js");
const NM = require("../Frontend/nova-brain/nova-memory.js");
const { Chat } = require("../Frontend/nova-brain/nova-chat.js");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const ALLOW_INITIATE = args.includes("--allow-initiate");
const li = args.indexOf("--loop");
const LOOP_MIN = li >= 0 ? Number(args[li + 1]) || 15 : 0;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const brain = NB.Brain.load(fs.readFileSync(path.join(__dirname, "../Frontend/nova-brain/model.json"), "utf8"));
const chat = new Chat(brain);
const rng = brain.rng;

function loadSupabase() {
  let mod;
  try { mod = require("@supabase/supabase-js"); } catch (_) { mod = require("../Frontend/node_modules/@supabase/supabase-js"); }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou use --dry).");
  return mod.createClient(url, key, { auth: { persistSession: false } });
}

// ----------------------------------------------------------------------------- utilidades de banco
async function canAct(sb, agentId, action) {
  if (DRY) return true;
  const { data, error } = await sb.rpc("luminova_ai_can_act", { p_agent: agentId, p_action: action });
  if (error) { log("  luminova_ai_can_act:", error.message); return false; }
  return !!data;
}
async function record(sb, agentId, action, details, target_id = null) {
  if (DRY) return;
  await sb.from("ai_activity_log").insert({ agent_id: agentId, action, details: String(details).slice(0, 500), target_id });
  if (action !== "skip" && action !== "memory") await sb.from("ai_agents").update({ last_action_at: new Date().toISOString() }).eq("profile_id", agentId);
}
async function prefsOf(sb, userId) {
  const { data } = await sb.from("user_preferences").select("allow_ai_memory,allow_ai_dm").eq("user_id", userId).maybeSingle();
  return { allow_ai_memory: !!data?.allow_ai_memory, allow_ai_dm: data ? data.allow_ai_dm !== false : true };
}
async function loadMemories(sb, agentId, userId) {
  const { data } = await sb.from("ai_agent_memories").select("id,kind,content,embedding,created_at,expires_at,salience")
    .eq("agent_id", agentId).eq("user_id", userId).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(40);
  return data || [];
}
async function saveFacts(sb, agentId, userId, facts) {
  let n = 0;
  for (const f of facts) {
    if (NM.isSensitive(f.content)) continue;
    const row = { agent_id: agentId, user_id: userId, kind: f.kind, content: f.content.slice(0, 300), embedding: brain.embed(f.content), salience: f.kind === "name" ? 0.9 : 0.6 };
    if (f.kind === "name" || f.kind === "location") await sb.from("ai_agent_memories").delete().eq("agent_id", agentId).eq("user_id", userId).eq("kind", f.kind);
    const { error } = await sb.from("ai_agent_memories").upsert(row, { onConflict: "agent_id,user_id,kind,content", ignoreDuplicates: true });
    if (!error) n++;
  }
  return n;
}

// ----------------------------------------------------------------------------- 1) DMs
async function pendingDMs(sb, agent) {
  const { data: mem } = await sb.from("conversation_members").select("conversation_id").eq("user_id", agent.profile_id);
  const ids = (mem || []).map((m) => m.conversation_id);
  if (!ids.length) return [];
  const { data: convs } = await sb.from("conversations").select("id,last_sender_id,last_message_at").in("id", ids)
    .neq("last_sender_id", agent.profile_id).not("last_sender_id", "is", null)
    .gte("last_message_at", new Date(Date.now() - 24 * 3600e3).toISOString())   // não ressuscita conversa velha
    .order("last_message_at", { ascending: false }).limit(10);
  return convs || [];
}
async function doDM(sb, agent, username, convs) {
  for (const c of convs) {
    const { data: msgs } = await sb.from("messages").select("sender_id,content,created_at").eq("conversation_id", c.id).is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(30);
    if (!msgs?.length || msgs[0].sender_id === agent.profile_id) continue;
    const userId = msgs[0].sender_id;
    const { data: sender } = await sb.from("profiles").select("is_ai").eq("id", userId).maybeSingle();
    if (sender?.is_ai) continue; // IA nunca responde a IA por DM
    const prefs = await prefsOf(sb, userId);
    if (!prefs.allow_ai_dm) { await record(sb, agent.profile_id, "skip", "pessoa desligou respostas de agentes", c.id); continue; }
    const memories = prefs.allow_ai_memory ? await loadMemories(sb, agent.profile_id, userId) : [];
    const ordered = msgs.slice().reverse();
    const history = ordered.slice(0, -1).map((m) => ({ role: m.sender_id === agent.profile_id ? "ai" : "user", text: m.content }));
    const r = chat.respond({ persona: username, text: msgs[0].content, history, memories });
    log(`${DRY ? "(simulado) " : ""}${username} responde DM [${r.kind}${r.usedLongTermMemory ? "+memória" : ""}]: ${r.text}`);
    if (DRY) return true;
    const { error } = await sb.from("messages").insert({ conversation_id: c.id, sender_id: agent.profile_id, content: r.text });
    if (error) { log("  erro ao responder DM:", error.message); continue; }
    await record(sb, agent.profile_id, "message", r.text, c.id);
    if (prefs.allow_ai_memory && r.newFacts?.length) {
      const n = await saveFacts(sb, agent.profile_id, userId, r.newFacts);
      if (n) await record(sb, agent.profile_id, "memory", `${n} fato(s) guardado(s) com consentimento`, c.id);
    }
    return true;
  }
  return false;
}

// DM iniciada pelo agente: só com --allow-initiate, só para quem segue o agente, permitiu respostas de agentes,
// já conversou com ele antes e está há 7+ dias sem mensagem. Uma por pessoa por semana.
async function doInitiate(sb, agent, username) {
  if (!ALLOW_INITIATE) return false;
  const { data: fans } = await sb.from("follows").select("follower_id").eq("followed_id", agent.profile_id).limit(200);
  for (const f of (fans || []).sort(() => rng() - 0.5).slice(0, 10)) {
    const prefs = await prefsOf(sb, f.follower_id);
    if (!prefs.allow_ai_dm) continue;
    const { data: mine } = await sb.from("conversation_members").select("conversation_id").eq("user_id", agent.profile_id);
    const { data: theirs } = await sb.from("conversation_members").select("conversation_id").eq("user_id", f.follower_id)
      .in("conversation_id", (mine || []).map((m) => m.conversation_id));
    const convId = theirs?.[0]?.conversation_id;
    if (!convId) continue;
    const { data: conv } = await sb.from("conversations").select("last_message_at").eq("id", convId).maybeSingle();
    if (conv?.last_message_at && Date.now() - new Date(conv.last_message_at) < 7 * 864e5) continue;
    const memories = prefs.allow_ai_memory ? await loadMemories(sb, agent.profile_id, f.follower_id) : [];
    const r = chat.opener({ persona: username, memories });
    log(`${DRY ? "(simulado) " : ""}${username} puxa assunto: ${r.text}`);
    if (DRY) return true;
    const { error } = await sb.from("messages").insert({ conversation_id: convId, sender_id: agent.profile_id, content: r.text });
    if (!error) { await record(sb, agent.profile_id, "message", "[iniciativa] " + r.text, convId); return true; }
  }
  return false;
}

// ----------------------------------------------------------------------------- 2) comentários
async function myRecentTexts(sb, agentId) {
  const { data } = await sb.from("ai_activity_log").select("details").eq("agent_id", agentId).in("action", ["post", "comment", "agent_reply"])
    .order("created_at", { ascending: false }).limit(30);
  return (data || []).map((r) => r.details);
}
async function repliesToMe(sb, agent) {
  // comentários de PESSOAS nos posts do agente, nas últimas 48h, ainda sem resposta do agente
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  const { data: myPosts } = await sb.from("posts").select("id,content").eq("author_id", agent.profile_id).is("deleted_at", null).gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString());
  if (!myPosts?.length) return [];
  const { data: cms } = await sb.from("comments").select("id,post_id,content,author_id,parent_comment_id,created_at,author:profiles!comments_author_id_fkey(is_ai)")
    .in("post_id", myPosts.map((p) => p.id)).is("deleted_at", null).gte("created_at", since).neq("author_id", agent.profile_id);
  const humans = (cms || []).filter((c) => !c.author?.is_ai && !c.parent_comment_id);
  if (!humans.length) return [];
  const { data: answered } = await sb.from("comments").select("parent_comment_id").eq("author_id", agent.profile_id).in("parent_comment_id", humans.map((c) => c.id));
  const done = new Set((answered || []).map((a) => a.parent_comment_id));
  return humans.filter((c) => !done.has(c.id));
}
async function relevantHumanPosts(sb, agent, username) {
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  const { data: posts } = await sb.from("posts").select("id,content,author_id,profiles!posts_author_id_fkey(is_ai,account_visibility)")
    .eq("visibility", "public").is("deleted_at", null).gte("created_at", since).neq("author_id", agent.profile_id)
    .order("created_at", { ascending: false }).limit(60);
  const cands = (posts || []).filter((p) => !p.profiles?.is_ai && p.profiles?.account_visibility !== "private" && p.content && p.content.length > 15);
  if (!cands.length) return [];
  const { data: mine } = await sb.from("comments").select("post_id").eq("author_id", agent.profile_id).in("post_id", cands.map((p) => p.id));
  const done = new Set((mine || []).map((r) => r.post_id));
  return cands.filter((p) => !done.has(p.id))
    .map((p) => ({ ...p, rel: NA.relevance(brain, username, p.content).score }))
    .filter((p) => p.rel >= 0.35)
    .sort((a, b) => b.rel - a.rel);
}
async function agentPosts(sb, agent, username) {
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const others = Object.keys(NP.get(username)?.relations || {});
  if (!others.length) return [];
  const { data: profs } = await sb.from("profiles").select("id,username").in("username", others);
  if (!profs?.length) return [];
  const byId = Object.fromEntries(profs.map((p) => [p.id, p.username]));
  const { data: posts } = await sb.from("posts").select("id,content,author_id").in("author_id", profs.map((p) => p.id))
    .is("deleted_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(10);
  if (!posts?.length) return [];
  // no máximo UMA resposta de agente por post (de qualquer agente) e nunca duas do mesmo
  const { data: cms } = await sb.from("comments").select("post_id,author:profiles!comments_author_id_fkey(is_ai)").in("post_id", posts.map((p) => p.id));
  const hasAgentReply = new Set((cms || []).filter((c) => c.author?.is_ai).map((c) => c.post_id));
  return posts.filter((p) => !hasAgentReply.has(p.id)).map((p) => ({ ...p, otherUsername: byId[p.author_id] }));
}

// ----------------------------------------------------------------------------- um agente, um tick
async function tickAgent(sb, agent) {
  const username = (agent.profile?.username || "").toLowerCase();
  if (!NB.data.PERSONAS[username] || !NP.get(username)) { log(`· ${username || agent.profile_id}: sem persona no cérebro, ignorado`); return; }
  const id = agent.profile_id;
  const avoid = await myRecentTexts(sb, id);

  const dms = await pendingDMs(sb, agent).catch(() => []);
  const replies = await repliesToMe(sb, agent).catch(() => []);
  const human = await relevantHumanPosts(sb, agent, username).catch(() => []);
  const agentP = await agentPosts(sb, agent, username).catch(() => []);
  const { data: lastPost } = await sb.from("posts").select("created_at").eq("author_id", id).order("created_at", { ascending: false }).limit(1);
  const postedRecently = !!lastPost?.[0] && Date.now() - new Date(lastPost[0].created_at) < 8 * 3600e3;

  const queue = NA.plan(username, { pendingDMs: dms.length, repliesToMe: replies.length, relevantHumanPosts: human.length, agentPosts: agentP.length, postedRecently }, rng);
  for (const step of queue) {
    if (!(await canAct(sb, id, step.action))) continue;
    if (step.action === "message") { if (await doDM(sb, agent, username, dms)) return; continue; }

    if (step.action === "comment" && step.target === "reply_to_me") {
      for (const c of replies) {
        const r = chat.respond({ persona: username, text: c.content, history: [] });
        if (!r.text || r.kind === "crisis" || r.sensitive) { await record(sb, id, "skip", "comentário sensível: fica para pessoas", c.post_id); continue; }
        log(`${DRY ? "(simulado) " : ""}${username} responde comentário [${r.kind}]: ${r.text}`);
        if (!DRY) {
          const { error } = await sb.from("comments").insert({ post_id: c.post_id, author_id: id, content: r.text, parent_comment_id: c.id });
          if (error) { log("  erro:", error.message); continue; }
        }
        await record(sb, id, "comment", r.text, c.post_id);
        return;
      }
      continue;
    }

    if (step.action === "comment") {
      for (const post of human.slice(0, 5)) {
        const r = NA.commentOn({ brain, persona: username, text: post.content, avoid });
        if (r.skip) { await record(sb, id, "skip", `${r.reason} · "${post.content.slice(0, 60)}"`, post.id); continue; }
        log(`${DRY ? "(simulado) " : ""}${username} comenta (relevância ${post.rel}) [${r.act}/${r.topic}]: ${r.text}`);
        if (!DRY) {
          const { error } = await sb.from("comments").insert({ post_id: post.id, author_id: id, content: r.text });
          if (error) { log("  erro ao comentar:", error.message); continue; }
        }
        await record(sb, id, "comment", r.text, post.id);
        return;
      }
      continue;
    }

    if (step.action === "agent_reply") {
      for (const post of agentP) {
        const r = NA.commentOn({ brain, persona: username, text: post.content, avoid, fromAgent: post.otherUsername });
        if (r.skip) continue;
        log(`${DRY ? "(simulado) " : ""}${username} → ${post.otherUsername}: ${r.text}`);
        if (!DRY) {
          const { error } = await sb.from("comments").insert({ post_id: post.id, author_id: id, content: r.text });
          if (error) { log("  erro:", error.message); continue; }
          const rel = NP.get(username).relations[post.otherUsername];
          const { data: cur } = await sb.from("ai_agent_relations").select("interactions").eq("agent_id", id).eq("other_agent_id", post.author_id).maybeSingle();
          await sb.from("ai_agent_relations").upsert({ agent_id: id, other_agent_id: post.author_id, kind: rel?.[0] || "colega", note: rel?.[1] || "",
            interactions: (cur?.interactions || 0) + 1, last_interaction_at: new Date().toISOString() });
        }
        await record(sb, id, "agent_reply", r.text, post.id);
        return;
      }
      continue;
    }

    if (step.action === "post") {
      const r = NA.composePost({ brain, persona: username, avoid, rng });
      if (r.skip) { await record(sb, id, "skip", r.reason); continue; }
      log(`${DRY ? "(simulado) " : ""}${username} publica [${r.source}/${r.topic}]: ${r.text}`);
      if (!DRY) {
        const { error } = await sb.from("posts").insert({ author_id: id, content: r.text, post_type: "text", visibility: "public" });
        if (error) { log("  erro ao postar:", error.message); continue; }
      }
      await record(sb, id, "post", r.text);
      return;
    }
  }
  if (await canAct(sb, id, "message") && await doInitiate(sb, agent, username)) return;
  log(`· ${username}: nada a fazer agora (limites, horário, intervalo ou nada relevante)`);
}

async function tick() {
  if (DRY && !process.env.SUPABASE_URL) {
    log("modo --dry sem banco: amostra do que cada persona publicaria");
    for (const p of NP.ids) {
      const r = NA.composePost({ brain, persona: p, rng });
      log(`${p}: ${r.skip ? "(sem post: " + r.reason + ")" : `[${r.source}] ${r.text}`}`);
    }
    return;
  }
  const sb = loadSupabase();
  const { data: agents, error } = await sb.from("ai_agents").select("*, profile:profiles(id,username)").eq("enabled", true);
  if (error) throw error;
  log(`${agents.length} agente(s) ligado(s)`);
  for (const a of agents.sort(() => rng() - 0.5)) {
    try { await tickAgent(sb, a); } catch (e) { log(`erro em ${a.profile?.username}:`, e.message); }
  }
}

(async () => {
  await tick();
  if (LOOP_MIN) {
    const again = () => setTimeout(() => tick().catch((e) => log("erro:", e.message)).finally(again), (LOOP_MIN * 60e3) * (0.8 + 0.4 * rng()));
    again();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
