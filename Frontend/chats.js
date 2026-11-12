/* LUMINOVA — Chats (estilo MSN): conversas reais no Supabase, tempo real, presença real via Realtime Presence.
   Nada aqui é inventado: sem contatos de exemplo, sem "digitando…", sem "visto". */
(() => {
  "use strict";
  const { esc } = window.LUMI;
  const $ = (s) => document.querySelector(s);
  const ICO = {
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" aria-hidden="true"><path d="M5 9l7 7 7-7"/></svg>',
  };
  let sb, me, activeId = null, channel = null, filter = "";
  const collapsed = new Set();
  const convs = new Map(); // id -> {id,last_message,last_message_at,last_sender_id,updated_at,other,last_read_at}
  const failedDrafts = new Map(); // tmpId -> texto, para tentar de novo

  const note = (t) => { $("#chatNotice").textContent = t || ""; };
  const nameOf = (p) => p?.display_name || p?.username || "Conversa";
  const stamp = (c) => c.last_message_at || c.updated_at || c.created_at;
  const isOnline = (c) => !!c.other?.id && LUMI.presence?.ready && LUMI.presence.online.has(c.other.id);

  async function loadConversations() {
    const host = $("#chatList");
    const mem = await sb.from("conversation_members").select("conversation_id,last_read_at").eq("user_id", me.id);
    if (mem.error) throw mem.error;
    const ids = (mem.data || []).map((x) => x.conversation_id);
    convs.clear();
    if (!ids.length) { renderList(); return; }
    const [cr, all] = await Promise.all([
      sb.from("conversations").select("id,last_message,last_message_at,last_sender_id,updated_at,created_at").in("id", ids),
      sb.from("conversation_members").select("conversation_id,user_id").in("conversation_id", ids),
    ]);
    if (cr.error) throw cr.error;
    if (all.error) throw all.error;
    const otherIds = [...new Set((all.data || []).filter((m) => m.user_id !== me.id).map((m) => m.user_id))];
    let pmap = {};
    if (otherIds.length) {
      const pr = await sb.from("profiles").select("id,display_name,username,avatar_url").in("id", otherIds);
      pmap = Object.fromEntries((pr.data || []).map((p) => [p.id, p]));
    }
    const readMap = Object.fromEntries((mem.data || []).map((m) => [m.conversation_id, m.last_read_at]));
    (cr.data || []).forEach((c) => {
      const o = (all.data || []).find((m) => m.conversation_id === c.id && m.user_id !== me.id);
      convs.set(c.id, { ...c, other: pmap[o?.user_id] || { id: o?.user_id }, last_read_at: readMap[c.id] });
    });
    renderList();
    host.removeAttribute("aria-busy");
  }

  function itemHtml(c) {
    const unread = c.last_sender_id && c.last_sender_id !== me.id && (!c.last_read_at || new Date(c.last_message_at) > new Date(c.last_read_at)) && c.id !== activeId;
    const dot = !LUMI.presence?.ready ? "" : `<i class="lumi-dot${isOnline(c) ? " on" : ""}" aria-hidden="true"></i>`;
    const status = LUMI.presence?.ready ? (isOnline(c) ? "online" : "offline") : "";
    return `<button type="button" class="chat-item${c.id === activeId ? " active" : ""}" data-id="${esc(c.id)}" aria-current="${c.id === activeId}">
      <span class="chat-av-wrap">${LUMI.avatar(c.other, "chat-av", 40)}${dot}</span>
      <span class="chat-item-txt"><strong>${esc(nameOf(c.other))}</strong>
      <small class="chat-muted">${esc(c.last_message ? (c.last_sender_id === me.id ? "Você: " : "") + c.last_message : "Nova conversa")}${status ? ` · ${status}` : ""}</small></span>
      <span class="chat-item-meta">${c.last_message_at ? esc(LUMI.hhmm(c.last_message_at)) : ""}${unread ? '<i class="chat-unread" aria-label="Mensagem nova"></i>' : ""}</span></button>`;
  }

  function renderList() {
    const host = $("#chatList");
    const q = filter.trim().toLowerCase();
    const all = [...convs.values()].sort((a, b) => new Date(stamp(b)) - new Date(stamp(a)));
    $("#chatCount").textContent = all.length ? String(all.length) : "";
    if (!all.length) {
      host.innerHTML = '<div class="chat-state"><strong>Nenhum contato ainda</strong>Abra o perfil de alguém e use “Enviar mensagem” para começar uma conversa.</div>';
      return;
    }
    const list = q ? all.filter((c) => nameOf(c.other).toLowerCase().includes(q) || (c.other?.username || "").toLowerCase().includes(q)) : all;
    if (!list.length) { host.innerHTML = `<div class="chat-state"><strong>Nada encontrado</strong>Nenhum contato com “${esc(filter)}”.</div>`; return; }
    // Grupos só existem quando a presença real está funcionando; senão, uma lista única, sem afirmar nada.
    let groups;
    if (LUMI.presence?.ready) {
      groups = [
        ["Online", list.filter((c) => isOnline(c))],
        ["Offline", list.filter((c) => !isOnline(c))],
      ];
    } else {
      groups = [["Conversas", list]];
    }
    host.innerHTML = groups.filter(([, l]) => l.length).map(([g, l]) => `
      <button type="button" class="chat-group-h" data-group="${esc(g)}" aria-expanded="${!collapsed.has(g)}">${ICO.chev}<span>${esc(g)} (${l.length})</span></button>
      <div role="group" aria-label="${esc(g)}"${collapsed.has(g) ? " hidden" : ""}>${l.map(itemHtml).join("")}</div>`).join("");
  }

  function bubble(m, state) {
    const mine = m.sender_id === me.id;
    const el = document.createElement("div");
    el.className = "chat-bubble" + (mine ? " mine" : "") + (state === "pending" ? " pending" : "") + (state === "failed" ? " failed" : "");
    el.dataset.messageId = m.id;
    const who = document.createElement("span"); who.className = "chat-says";
    who.textContent = (mine ? "Você" : nameOf(convs.get(activeId)?.other)) + " diz:";
    const t = document.createElement("span"); t.className = "chat-text"; t.textContent = m.content || "";
    const tm = document.createElement("time");
    tm.textContent = state === "pending" ? "enviando…" : state === "failed" ? "não enviada" : LUMI.hhmm(m.created_at);
    el.append(who, t, tm);
    if (state === "failed") {
      const b = document.createElement("button"); b.type = "button"; b.className = "chat-retry"; b.textContent = "Tentar de novo";
      b.addEventListener("click", () => { el.remove(); doSend(m.content); });
      el.append(b);
    }
    return el;
  }
  function append(m, state) {
    const box = $("#chatMessages");
    if (!state && box.querySelector(`[data-message-id="${CSS.escape(String(m.id))}"]`)) return null;
    const el = bubble(m, state);
    box.append(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  function headerFor(c) {
    const o = c?.other;
    const pres = LUMI.presence?.ready ? (isOnline(c) ? "Online" : "Offline") : "";
    $("#chatHeader").innerHTML = `<a class="chat-who" href="${o?.id ? LUMI.profileUrl(o.id) : "#"}"><span class="chat-av-wrap">${LUMI.avatar(o, "chat-av", 38)}${!LUMI.presence?.ready ? "" : `<i class="lumi-dot${isOnline(c) ? " on" : ""}" aria-hidden="true"></i>`}</span><span><strong>${esc(nameOf(o))}</strong>${pres ? `<span class="chat-presence-line">${pres}</span>` : ""}</span></a>`;
    $("#chatWinTitle").textContent = "Conversa com " + nameOf(o);
  }

  async function open(id) {
    activeId = id;
    const c = convs.get(id);
    $("#chatShell").classList.add("is-open");
    headerFor(c);
    const input = $("#chatInput");
    input.disabled = !navigator.onLine; $("#chatSend").disabled = !navigator.onLine;
    const box = $("#chatMessages");
    box.innerHTML = '<p class="chat-state" role="status">Carregando histórico…</p>';
    box.setAttribute("aria-busy", "true");
    const r = await sb.from("messages").select("id,sender_id,content,created_at").eq("conversation_id", id).is("deleted_at", null).order("created_at", { ascending: true }).limit(300);
    if (activeId !== id) return; // a pessoa trocou de conversa enquanto carregava
    box.removeAttribute("aria-busy");
    box.innerHTML = "";
    if (r.error) {
      box.innerHTML = `<div class="chat-state"><strong>Não foi possível carregar as mensagens</strong>${esc(r.error.message)}<br><button type="button" class="ln-btn" id="chatRetryLoad">Tentar de novo</button></div>`;
      $("#chatRetryLoad").addEventListener("click", () => open(id).catch((x) => note(x.message)));
      return;
    }
    if (!r.data.length) box.innerHTML = '<div class="chat-empty-main" id="chatEmpty"><strong>Nenhuma mensagem ainda</strong>Escreva a primeira abaixo.</div>';
    r.data.forEach((m) => append(m));
    box.scrollTop = box.scrollHeight;
    if (c) c.last_read_at = new Date().toISOString();
    sb.from("conversation_members").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", id).eq("user_id", me.id).then(() => {});
    renderList();
    input.focus({ preventScroll: true });
  }

  function listen() {
    channel = sb.channel("luminova-dm-" + me.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new;
        const c = convs.get(m.conversation_id);
        if (!c) { loadConversations().catch(() => {}); return; } // conversa nova iniciada pela outra pessoa
        c.last_message = m.content.slice(0, 200); c.last_message_at = m.created_at; c.last_sender_id = m.sender_id;
        if (m.conversation_id === activeId && m.sender_id !== me.id) {
          $("#chatEmpty")?.remove(); append(m);
          sb.from("conversation_members").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", activeId).eq("user_id", me.id).then(() => {});
        }
        renderList();
      }).subscribe();
  }

  async function doSend(content) {
    if (!content || !activeId) return;
    $("#chatEmpty")?.remove();
    const tmpId = "tmp-" + Date.now();
    const el = append({ id: tmpId, sender_id: me.id, content, created_at: new Date().toISOString() }, "pending");
    const sendBtn = $("#chatSend");
    sendBtn.setAttribute("aria-busy", "true");
    const { data, error } = await sb.from("messages").insert({ conversation_id: activeId, sender_id: me.id, content }).select("id,sender_id,content,created_at").single();
    sendBtn.removeAttribute("aria-busy");
    if (error) {
      el?.remove();
      append({ id: tmpId, sender_id: me.id, content }, "failed");
      note("Não foi possível enviar: " + error.message);
    } else {
      el?.remove();
      append(data);
      note("");
      const c = convs.get(activeId);
      if (c) { c.last_message = content.slice(0, 200); c.last_message_at = data.created_at; c.last_sender_id = me.id; renderList(); }
    }
  }
  function onSubmit(e) {
    e.preventDefault();
    const input = $("#chatInput"), content = input.value.trim();
    if (!content || !activeId || !navigator.onLine) return;
    input.value = "";
    doSend(content).finally(() => input.focus());
  }

  function netState() {
    const off = !navigator.onLine;
    $("#chatNet").hidden = !off;
    const dis = off || !activeId;
    $("#chatInput").disabled = dis; $("#chatSend").disabled = dis;
  }

  async function init() {
    if (!(await LUMI.requireLogin())) return;
    sb = LUMI.sb; me = LUMI.user;
    netState();
    addEventListener("online", () => { netState(); loadConversations().catch(() => {}); });
    addEventListener("offline", netState);
    const host = $("#chatList");
    host.setAttribute("aria-busy", "true");
    host.addEventListener("click", (e) => {
      const g = e.target.closest("[data-group]");
      if (g) { const k = g.dataset.group; collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k); renderList(); return; }
      const b = e.target.closest("[data-id]");
      if (b) open(b.dataset.id).catch((x) => note(x.message));
    });
    $("#chatSearch").addEventListener("input", (e) => { filter = e.target.value; renderList(); });
    $("#chatForm").addEventListener("submit", onSubmit);
    $("#chatBack").addEventListener("click", () => { $("#chatShell").classList.remove("is-open"); activeId = null; renderList(); netState(); });
    LUMI.presence?.onChange(() => { renderList(); if (activeId) headerFor(convs.get(activeId)); });
    try { await loadConversations(); }
    catch (e) {
      host.removeAttribute("aria-busy");
      host.innerHTML = `<div class="chat-state"><strong>Não foi possível carregar os contatos</strong>${esc(e.message || "Erro de rede")}<br><button type="button" class="ln-btn" id="chatRetryList">Tentar de novo</button></div>`;
      $("#chatRetryList").addEventListener("click", () => location.reload());
      return;
    }
    listen();
    const withId = new URLSearchParams(location.search).get("with");
    if (withId) {
      note("Abrindo conversa…");
      const { data, error } = await sb.rpc("luminova_start_conversation", { other_user: withId });
      if (error) { note("Não foi possível iniciar a conversa: " + error.message); return; }
      if (!convs.has(data)) await loadConversations();
      history.replaceState(null, "", "chats.html");
      await open(data); note("");
    }
  }
  document.addEventListener("DOMContentLoaded", () => init().catch((e) => note("Erro ao carregar chats: " + e.message)));
  window.addEventListener("beforeunload", () => { if (channel) sb.removeChannel(channel); });
})();
