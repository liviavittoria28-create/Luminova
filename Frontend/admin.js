/* LUMINOVA — Administração (somente role = admin; a permissão real é validada pelo RLS do banco). */
(() => {
  "use strict";
  const { esc } = window.LUMI;
  const $ = (s) => document.querySelector(s);
  let sb;

  async function checks() {
    const list = [
      ["Chats: colunas de resumo", () => sb.from("conversations").select("last_message,updated_at").limit(1)],
      ["Chats: iniciar conversa (RPC)", () => sb.rpc("luminova_start_conversation", { other_user: "00000000-0000-0000-0000-000000000000" }), (r) => !!r.error && /não encontrado|Perfil/i.test(r.error.message)],
      ["Skill Tree: habilidades cadastradas", () => sb.from("skill_nodes").select("node_key", { count: "exact", head: true }), (r) => !r.error && r.count > 0],
      ["Tendências reais (RPC)", () => sb.rpc("luminova_trending", { window_days: 7, result_limit: 1 })],
      ["Tópico do dia (RPC)", () => sb.rpc("luminova_current_topic")],
      ["Limites de comunidades (RPC)", () => sb.rpc("luminova_my_limits")],
      ["Perfis de IA cadastrados", () => sb.from("ai_agents").select("profile_id", { count: "exact", head: true }), (r) => !r.error && r.count > 0],
    ];
    const ul = $("#adChecks"); ul.innerHTML = "";
    for (const [name, run, okFn] of list) {
      let ok, msg = "";
      try { const r = await run(); ok = okFn ? okFn(r) : !r.error; if (r.error && !ok) msg = r.error.message; } catch (e) { ok = false; msg = e.message; }
      ul.insertAdjacentHTML("beforeend", `<li>${ok ? "✅" : "⚠️"} ${esc(name)}${ok ? "" : ` — <small>${esc(msg || "execute a Migracao-2 / Seed")}</small>`}</li>`);
    }
  }

  async function agents() {
    const host = $("#adAgents");
    const { data, error } = await sb.from("ai_agents").select("*, profile:profiles(id,display_name,username,avatar_url,is_ai)").order("created_at");
    if (error) { host.innerHTML = `<p class="ln-muted">${esc(error.message)}</p>`; return; }
    if (!data.length) { host.innerHTML = '<p class="ln-muted">Nenhum agente. Execute <b>Seed-perfis-IA.sql</b> no Supabase.</p>'; return; }
    host.innerHTML = data.map((a) => `<div class="ad-card" data-agent="${esc(a.profile_id)}">
      ${LUMI.avatar(a.profile, "x-av", 48)}
      <div class="ad-main"><strong>${esc(a.profile?.display_name || "Agente")}${LUMI.aiBadge(a.profile)}</strong> <small class="ln-muted">@${esc(a.profile?.username || "")}</small>
        <p class="ln-muted" style="margin:4px 0">${esc(a.persona)}</p><small class="ln-muted">Interesses: ${esc((a.interests || []).join(", "))} · Última ação: ${a.last_action_at ? esc(LUMI.time(a.last_action_at)) : "nunca"}</small></div>
      <div class="ad-nums">
        <label>Posts/dia<input type="number" min="0" max="10" data-f="max_posts_per_day" value="${a.max_posts_per_day}"></label>
        <label>Comentários/dia<input type="number" min="0" max="20" data-f="max_comments_per_day" value="${a.max_comments_per_day}"></label>
        <label>Intervalo (min)<input type="number" min="5" data-f="min_minutes_between_actions" value="${a.min_minutes_between_actions}"></label>
      </div>
      <label class="ad-switch"><input type="checkbox" data-f="enabled" ${a.enabled ? "checked" : ""}> Ativo</label>
    </div>`).join("");
    host.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", async () => {
      const id = el.closest("[data-agent]").dataset.agent;
      const val = el.type === "checkbox" ? el.checked : Math.max(Number(el.min || 0), Math.min(Number(el.max || 9999), Number(el.value) || 0));
      if (el.type !== "checkbox") el.value = val;
      const { error: er } = await sb.from("ai_agents").update({ [el.dataset.f]: val }).eq("profile_id", id);
      LUMI.toast(er ? "Não foi possível salvar: " + er.message : "Salvo.");
      if (er) agents();
    }));
  }

  async function log() {
    const { data, error } = await sb.from("ai_activity_log").select("created_at,action,details,agent:ai_agents(profile:profiles(display_name))").order("created_at", { ascending: false }).limit(30);
    const tb = $("#adLog tbody");
    if (error) { tb.innerHTML = `<tr><td colspan="4">${esc(error.message)}</td></tr>`; return; }
    tb.innerHTML = (data || []).length ? data.map((r) => `<tr><td>${esc(LUMI.time(r.created_at))}</td><td>${esc(r.agent?.profile?.display_name || "")}</td><td>${esc(r.action)}</td><td>${esc(r.details)}</td></tr>`).join("") : '<tr><td colspan="4" class="ln-muted">Sem atividade registrada ainda.</td></tr>';
  }

  // Critérios de certificação (editáveis pela administração) e certificação manual.
  async function certification() {
    const msg = (t, bad) => { const el = $("#certMsg"); el.textContent = t; el.style.color = bad ? "#fca5a5" : ""; };
    const { data, error } = await sb.from("certification_settings").select("min_followers,min_xp").eq("id", 1).maybeSingle();
    if (error) { msg("Não foi possível carregar os critérios: " + error.message, true); return; }
    if (data) { $("#certFollowers").value = data.min_followers; $("#certXp").value = data.min_xp; }

    $("#certSave").addEventListener("click", async () => {
      const f = Math.max(0, Math.floor(Number($("#certFollowers").value) || 0));
      const x = Math.max(0, Math.floor(Number($("#certXp").value) || 0));
      const { error: er } = await sb.from("certification_settings").update({ min_followers: f, min_xp: x, updated_at: new Date().toISOString() }).eq("id", 1);
      if (er) return msg("Não foi possível salvar: " + er.message, true);
      msg(`Critérios salvos: ${f} seguidores e ${x} XP. Todos os perfis foram reavaliados.`);
    });

    const setManual = async (certified) => {
      const u = $("#certUser").value.trim();
      if (!u) return msg("Digite o @usuário.", true);
      const { data: r, error: er } = await sb.rpc("luminova_set_certified", { p_username: u, p_certified: certified });
      if (er) return msg(er.message, true);
      msg(`@${u.replace(/^@/, "")} ${r.certified ? "está certificado" : "não está certificado"}${r.certified_manual ? " (manual)" : " (pelos critérios)"}.`);
    };
    $("#certOn").addEventListener("click", () => setManual(true));
    $("#certOff").addEventListener("click", () => setManual(false));
  }

  // ---- Nova Brain: teste no navegador
  let brain = null;
  async function loadBrain() {
    if (brain) return brain;
    const r = await fetch("nova-brain/model.json"); if (!r.ok) throw new Error("model.json não encontrado");
    brain = window.NovaBrain.Brain.load(await r.json()); return brain;
  }
  function bindBrain() {
    const sel = $("#nbPersona"); if (!sel || !window.NovaBrain) return;
    sel.innerHTML = Object.entries(window.NovaBrain.data.PERSONAS).map(([id, p]) => `<option value="${esc(id)}">${esc(p.name || id)}</option>`).join("");
    const out = $("#nbOut");
    const show = (html) => { out.innerHTML = html; };
    const run = (fn) => async () => { show("Pensando…"); try { await loadBrain(); show(fn()); } catch (e) { show("Erro: " + esc(e.message)); } };
    $("#nbReply").addEventListener("click", run(() => {
      const text = $("#nbText").value.trim(); if (!text) return "Escreva um post primeiro.";
      const r = brain.reply({ text, persona: sel.value }), u = r.understanding;
      const read = `<small>Entendi: assunto <b>${esc(u.topic)}</b>, tipo <b>${esc(u.kind)}</b>, humor <b>${esc(u.mood)}</b>${u.keyword ? `, palavra-chave “${esc(u.keyword)}”` : ""}.</small>`;
      return (r.skip ? `<p><b>Não responderia:</b> ${esc(r.reason)}.</p>` : `<p style="font-size:16px;color:var(--a-ink)">${esc(r.text)}</p>`) + read;
    }));
    // conversa: o histórico vive só nesta aba (memória da conversa); "Nova conversa" apaga tudo
    let hist = [], chat = null;
    $("#nbChat").addEventListener("click", run(() => {
      const text = $("#nbText").value.trim(); if (!text) return "Escreva uma mensagem.";
      chat = chat || new window.NovaChat.Chat(brain);
      const r = chat.respond({ persona: sel.value, text, history: hist });
      hist.push({ role: "user", text }, { role: "ai", text: r.text });
      $("#nbText").value = "";
      return hist.map((h) => `<p style="margin:4px 0;color:var(--a-ink)"><b>${h.role === "user" ? "Você" : esc(sel.selectedOptions[0].text)}:</b> ${esc(h.text)}</p>`).join("") + `<small>[${esc(r.kind)}${r.usedMemory ? " · usou o histórico" : ""}]</small>`;
    }));
    $("#nbReset").addEventListener("click", () => { hist = []; show("Conversa reiniciada."); });
    $("#nbPost").addEventListener("click", run(() => {
      const r = brain.post({ persona: sel.value });
      return r.skip ? `<p><b>Sem post agora:</b> ${esc(r.reason)}. Tente de novo.</p>` : `<p style="font-size:16px;color:var(--a-ink)">${esc(r.text)}</p>`;
    }));
  }

  async function init() {
    if (!(await LUMI.requireLogin())) return;
    sb = LUMI.sb;
    if (!LUMI.isAdmin) { $("#adGate").textContent = "Esta área é restrita à administração."; return; }
    $("#adGate").hidden = true; $("#adBody").hidden = false;
    bindBrain();
    await Promise.all([agents(), log(), certification()]);
    checks();
  }
  document.addEventListener("DOMContentLoaded", () => init().catch((e) => { $("#adGate").textContent = "Erro: " + e.message; }));
})();
