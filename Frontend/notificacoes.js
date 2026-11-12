/* LUMINOVA — central de notificações (dados reais de public.notifications, geradas por gatilhos no banco). */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const PAGE = 30;
  let sb, me, filter = "all", offset = 0, rows = [];
  const GROUP = { social: ["follow"], content: ["reaction", "comment", "reply", "gratitude"], community: ["community_request", "community_approved", "community_invite"] };
  const ICON = { follow: "＋", reaction: "♥", comment: "✎", reply: "↩", gratitude: "✦", community_request: "◈", community_approved: "✓", community_invite: "◈", system: "ℹ" };

  function linkFor(n) {
    if (n.entity_type === "post" && n.entity_id) return `geral.html?post=${encodeURIComponent(n.entity_id)}`;
    if (n.entity_type === "community" && n.entity_id) return `comunidade-detalhe.html?id=${encodeURIComponent(n.entity_id)}`;
    if (n.notification_type === "follow" && n.actor_id) return LUMI.profileUrl(n.actor_id);
    return null;
  }
  function item(n) {
    const actor = n.actor || null, name = actor ? actor.display_name || actor.username || "Alguém" : "LUMINOVA";
    const href = linkFor(n);
    const unread = !n.read_at;
    return `<li class="n-item${unread ? " is-unread" : ""}" data-id="${LUMI.esc(n.id)}">
      <span class="n-ico" aria-hidden="true">${ICON[n.notification_type] || "•"}</span>
      ${actor ? LUMI.avatar(actor, "n-av", 40) : ""}
      <div class="n-txt">
        <p><strong>${LUMI.esc(name)}</strong> ${LUMI.esc(n.message)}</p>
        <time datetime="${LUMI.esc(n.created_at)}">${LUMI.esc(LUMI.time(n.created_at))}</time>
      </div>
      <div class="n-act">
        ${href ? `<a class="l3-btn ghost sm" href="${href}" data-open="${LUMI.esc(n.id)}">Abrir</a>` : ""}
        ${unread ? `<button class="l3-btn ghost sm" data-read="${LUMI.esc(n.id)}" aria-label="Marcar como lida">Lida</button>` : ""}
        <button class="l3-btn ghost sm" data-del="${LUMI.esc(n.id)}" aria-label="Apagar notificação">✕</button>
      </div></li>`;
  }
  function render() {
    const host = $("#nList");
    host.removeAttribute("aria-busy");
    let list = rows;
    if (filter === "unread") list = rows.filter((n) => !n.read_at);
    else if (GROUP[filter]) list = rows.filter((n) => GROUP[filter].includes(n.notification_type));
    host.innerHTML = list.length ? `<ul class="n-list">${list.map(item).join("")}</ul>` :
      `<div class="l3-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/></svg>
       <strong>${filter === "unread" ? "Tudo lido por aqui" : "Nenhuma notificação ainda"}</strong>
       <span>Publique, comente e participe de comunidades — quando alguém interagir, aparece aqui.</span>
       <a class="l3-btn sm" href="explorar.html">Explorar a LUMINOVA</a></div>`;
  }
  async function load(more = false) {
    if (!more) { offset = 0; rows = []; }
    const { data, error } = await sb.from("notifications")
      .select("id,actor_id,notification_type,entity_type,entity_id,message,read_at,created_at,actor:profiles!notifications_actor_id_fkey(id,username,display_name,avatar_url)")
      .eq("recipient_id", me.id).order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
    if (error) { $("#nList").innerHTML = `<div class="l3-alert err">Não foi possível carregar as notificações. Tente recarregar a página.</div>`; return; }
    rows = rows.concat(data || []);
    offset += (data || []).length;
    $("#nMore").hidden = (data || []).length < PAGE;
    render();
  }
  async function markRead(ids) {
    if (!ids.length) return;
    await sb.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids).is("read_at", null);
    rows.forEach((r) => { if (ids.includes(r.id)) r.read_at = r.read_at || new Date().toISOString(); });
    render(); LUMI.refreshBadges?.();
  }

  async function init() {
    if (!(await LUMI.requireLogin())) return;
    sb = LUMI.sb; me = LUMI.user;
    document.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => {
      filter = b.dataset.f;
      document.querySelectorAll("[data-f]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      render();
    }));
    $("#nAllRead").addEventListener("click", () => markRead(rows.filter((r) => !r.read_at).map((r) => r.id)));
    $("#nMore").addEventListener("click", () => load(true));
    $("#nList").addEventListener("click", async (e) => {
      const r = e.target.closest("[data-read]"), d = e.target.closest("[data-del]"), o = e.target.closest("[data-open]");
      if (r) markRead([r.dataset.read]);
      if (o) markRead([o.dataset.open]);
      if (d) {
        const { error } = await sb.from("notifications").delete().eq("id", d.dataset.del);
        if (error) return LUMI.toast("Não foi possível apagar.");
        rows = rows.filter((x) => x.id !== d.dataset.del); render(); LUMI.refreshBadges?.();
      }
    });
    await load();
    sb.channel("lumi-notif-page-" + me.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${me.id}` }, () => load())
      .subscribe();
  }
  document.addEventListener("DOMContentLoaded", () => init().catch((e) => { console.error(e); $("#nList").innerHTML = '<div class="l3-alert err">Erro ao carregar. Tente recarregar.</div>'; }));
})();
