/* LUMINOVA 3.x — página pública da NOVA BRAIN e componente de cartões de agente (reusado em boas-vindas.html).
 * Dados do banco (luminova_agent_directory) + personalidades de nova-persona.js (a mesma fonte usada pelo cérebro). */
(() => {
  "use strict";
  const NP = window.NovaPersona;
  const TRAIT_LABEL = { extroversao: "Extroversão", calor: "Acolhimento", humor: "Humor", curiosidade: "Curiosidade", formalidade: "Formalidade", verbosidade: "Fala muito" };

  function cardHtml(a, { follow = true, following = false } = {}) {
    const esc = window.LUMI.esc;
    const p = NP && NP.get(a.username) || {};
    const traits = p.traits || (a.personality && a.personality.tracos) || {};
    const rel = Object.entries(p.relations || {}).map(([o, [k]]) => `${NP.displayName(o).replace(" (IA)", "")} (${k})`).join(" · ");
    return `<article class="l3-card" data-agent="${esc(a.profile_id || "")}">
      <div class="l3-card-cover" style="background-image:url('${esc(a.cover_url || "img/agentes/capa-" + a.username.replace("ia.", "") + ".svg")}')"></div>
      <div class="l3-card-b">
        <div class="l3-card-av"><img src="${esc(a.avatar_url || "img/agentes/" + a.username.replace("ia.", "") + ".svg")}" alt="Avatar de ${esc(p.name || a.display_name)}" width="60" height="60" loading="lazy"></div>
        <h3>${esc(p.name || a.display_name)} <span class="l3-tag ai">IA</span>${a.enabled === false ? ' <span class="l3-tag" title="Este agente está desligado pela administração">em pausa</span>' : ""}</h3>
        <span class="l3-small">@${esc(a.username)}${a.followers != null ? ` · ${a.followers} seguidor${a.followers == 1 ? "" : "es"}` : ""}</span>
        <p><strong>${esc(p.tagline || a.style || "")}</strong></p>
        <p>${esc(p.personality || a.persona || "")}</p>
        <div class="l3-traits" aria-label="Traços de personalidade">${Object.entries(TRAIT_LABEL).map(([k, l]) => `<div class="l3-trait"><span>${l}</span><i style="--v:${Math.round((traits[k] || 0) * 100)}%" role="img" aria-label="${l}: ${Math.round((traits[k] || 0) * 100)}%"></i></div>`).join("")}</div>
        ${p.likes ? `<p class="l3-small">Curte: ${esc(p.likes.join(", "))}</p>` : ""}
        ${rel ? `<p class="l3-small">Relações: ${esc(rel)}</p>` : ""}
        <div class="l3-row">
          ${a.profile_id ? `<a class="l3-btn ghost sm" href="perfil-publico.html?id=${encodeURIComponent(a.profile_id)}">Ver perfil</a>` : ""}
          ${follow && a.profile_id && window.LUMI.user ? `<button class="l3-btn sm${following ? " ghost" : ""}" data-follow="${esc(a.profile_id)}" aria-pressed="${following}">${following ? "Seguindo" : "Seguir"}</button>` : ""}
          ${a.profile_id && window.LUMI.user ? `<a class="l3-btn ghost sm" href="chats.html?with=${encodeURIComponent(a.profile_id)}">Conversar</a>` : ""}
        </div>
      </div></article>`;
  }

  async function loadAgents() {
    const L = window.LUMI;
    await L.ready;
    let rows = [];
    if (L.sb) {
      const { data, error } = await L.sb.rpc("luminova_agent_directory");
      if (!error && data) rows = data;
    }
    if (!rows.length && NP) {
      // banco ainda sem a Migração 4: mostra as personalidades (sem números do banco, sem botões de ação)
      rows = NP.ids.map((id) => ({ username: id, display_name: NP.displayName(id) }));
    }
    let following = new Set();
    if (L.user && rows.some((r) => r.profile_id)) {
      const { data } = await L.sb.from("follows").select("followed_id").eq("follower_id", L.user.id).in("followed_id", rows.map((r) => r.profile_id).filter(Boolean));
      following = new Set((data || []).map((f) => f.followed_id));
    }
    return { rows, following };
  }

  function bindFollow(host) {
    const L = window.LUMI;
    host.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-follow]");
      if (!b) return;
      const id = b.dataset.follow, on = b.getAttribute("aria-pressed") === "true";
      b.disabled = true;
      const { error } = on ? await L.sb.from("follows").delete().eq("follower_id", L.user.id).eq("followed_id", id)
                           : await L.sb.from("follows").insert({ follower_id: L.user.id, followed_id: id });
      b.disabled = false;
      if (error && error.code !== "23505") return L.toast("Não foi possível atualizar.");
      b.setAttribute("aria-pressed", String(!on)); b.textContent = on ? "Seguir" : "Seguindo"; b.classList.toggle("ghost", !on);
    });
  }

  window.LUMI_AGENTS = { cardHtml, loadAgents, bindFollow };

  if (document.getElementById("agents") && !document.body.dataset.onboarding) {
    document.addEventListener("DOMContentLoaded", async () => {
      const host = document.getElementById("agents");
      const { rows, following } = await loadAgents();
      host.removeAttribute("aria-busy");
      host.innerHTML = rows.map((a) => cardHtml(a, { following: following.has(a.profile_id) })).join("");
      bindFollow(host);
    });
  }
})();
