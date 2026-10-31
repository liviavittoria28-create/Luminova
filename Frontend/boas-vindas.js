/* LUMINOVA 3.x — onboarding: interesses → agentes (opcional) → comunidades sugeridas. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const CAT = { fandoms: "Fandoms", entretenimento: "Entretenimento", criatividade: "Criatividade", hobbies: "Hobbies", ciencia: "Ciência", aprendizado: "Aprendizado", vida: "Vida", geral: "Outros" };
  let sb, me, chosen = new Set(), interests = [];

  const flash = (t, k = "ok") => { const a = $("#obAlert"); a.className = "l3-alert " + k; a.textContent = t; a.hidden = !t; };
  function go(n) {
    [1, 2, 3].forEach((i) => ($("#ob" + i).hidden = i !== n));
    $("#obStep").textContent = `passo ${n} de 3`;
    if (n === 2) renderAgents();
    if (n === 3) renderCommunities();
    $("#ob" + n).querySelector("h2").setAttribute("tabindex", "-1");
    $("#ob" + n).querySelector("h2").focus();
  }

  async function renderInterests() {
    const [all, mine] = await Promise.all([
      sb.from("interests").select("id,name,slug,category").order("name"),
      sb.from("profile_interests").select("interest_id").eq("profile_id", me.id),
    ]);
    if (all.error) { $("#obInterests").innerHTML = '<p class="l3-small">Não foi possível carregar os interesses agora.</p>'; return; }
    interests = all.data;
    chosen = new Set((mine.data || []).map((r) => r.interest_id));
    const groups = {};
    interests.forEach((i) => (groups[i.category || "geral"] ||= []).push(i));
    const order = ["fandoms", "entretenimento", "criatividade", "hobbies", "ciencia", "aprendizado", "vida", "geral"];
    $("#obInterests").innerHTML = order.filter((k) => groups[k]).map((k) => `<div class="ob-group"><h3>${CAT[k] || k}</h3><div class="l3-row">${groups[k].map((i) => `<button type="button" class="l3-chip" data-int="${LUMI.esc(i.id)}" aria-pressed="${chosen.has(i.id)}">${LUMI.esc(i.name)}</button>`).join("")}</div></div>`).join("");
    count();
  }
  function count() { $("#obCount").textContent = chosen.size ? `${chosen.size} interesse${chosen.size > 1 ? "s" : ""} escolhido${chosen.size > 1 ? "s" : ""}` : "Nenhum escolhido (tudo bem, dá para pular)"; }

  async function renderAgents() {
    const host = $("#agents");
    const { rows, following } = await LUMI_AGENTS.loadAgents();
    // ordena pelos agentes cujos interesses batem com os escolhidos
    const slugs = new Set(interests.filter((i) => chosen.has(i.id)).map((i) => i.slug));
    const score = (a) => (a.interests || (NovaPersona.get(a.username) || {}).interests || []).filter((s) => slugs.has(s)).length;
    rows.sort((a, b) => score(b) - score(a));
    host.removeAttribute("aria-busy");
    host.innerHTML = rows.map((a) => LUMI_AGENTS.cardHtml(a, { following: following.has(a.profile_id) })).join("") || '<p class="l3-small">Os agentes ainda não foram configurados.</p>';
  }

  async function renderCommunities() {
    const host = $("#obComms");
    const { data, error } = await sb.rpc("luminova_recommend_communities", { result_limit: 9 });
    if (error) { host.innerHTML = '<p class="l3-small">Não foi possível sugerir comunidades agora. Veja todas em <a href="comunidades.html">Comunidades</a>.</p>'; return; }
    if (!data?.length) {
      host.innerHTML = `<div class="l3-empty" style="grid-column:1/-1"><strong>Ainda não há comunidades públicas com esse tema</strong><span>Que tal criar a primeira? Você vira dono(a) e convida quem curte o mesmo.</span><a class="l3-btn sm" href="comunidades.html?criar=1">Criar comunidade</a></div>`;
      return;
    }
    host.innerHTML = data.map((c) => `<article class="l3-card"><div class="l3-card-cover" style="${c.cover_url ? `background-image:url('${LUMI.esc(c.cover_url)}')` : "background:linear-gradient(135deg,#2a83dc,#0a8fb8 60%,#45ad2a)"}"></div>
      <div class="l3-card-b"><h3>${LUMI.esc(c.name)}</h3><span class="l3-small">${LUMI.esc(c.category_name || "Comunidade")} · ${c.members} membro${c.members == 1 ? "" : "s"} · ${LUMI.esc(c.reason)}</span>
      <p>${LUMI.esc((c.description || "").slice(0, 140))}</p>
      <div class="l3-row"><a class="l3-btn ghost sm" href="comunidade-detalhe.html?id=${encodeURIComponent(c.community_id)}">Ver</a><button class="l3-btn sm" data-join="${LUMI.esc(c.community_id)}">Participar</button></div></div></article>`).join("");
  }

  async function init() {
    if (!(await LUMI.requireLogin())) return;
    sb = LUMI.sb; me = LUMI.user;
    const name = (LUMI.profile?.display_name || "").split(" ")[0];
    if (name && name !== "Novo") $("#obHello").textContent = `Boas-vindas, ${name}!`;
    await renderInterests();
    $("#obInterests").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-int]"); if (!b) return;
      const id = b.dataset.int, on = chosen.has(id);
      b.disabled = true;
      const { error } = on ? await sb.from("profile_interests").delete().eq("profile_id", me.id).eq("interest_id", id)
                           : await sb.from("profile_interests").insert({ profile_id: me.id, interest_id: id });
      b.disabled = false;
      if (error && error.code !== "23505") return flash("Não foi possível salvar esse interesse.", "err");
      on ? chosen.delete(id) : chosen.add(id);
      b.setAttribute("aria-pressed", String(!on)); count();
    });
    document.querySelectorAll("[data-next]").forEach((b) => b.addEventListener("click", () => go(+b.dataset.next)));
    LUMI_AGENTS.bindFollow($("#agents"));
    $("#obComms").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-join]"); if (!b) return;
      b.disabled = true;
      const { data: c } = await sb.from("communities").select("join_policy").eq("id", b.dataset.join).maybeSingle();
      const status = c?.join_policy === "approval" ? "pending" : "active";
      const { error } = await sb.from("community_members").insert({ community_id: b.dataset.join, user_id: me.id, role: "member", status });
      if (error && error.code !== "23505") { b.disabled = false; return flash(/Limite/.test(error.message) ? error.message : "Não foi possível entrar nesta comunidade.", "err"); }
      b.textContent = status === "pending" ? "Pedido enviado" : "Participando";
    });
    await sb.from("profiles").update({ onboarding_completed: true }).eq("id", me.id);
  }
  document.addEventListener("DOMContentLoaded", () => init().catch((e) => { console.error(e); flash("Erro ao carregar. Recarregue a página.", "err"); }));
})();
