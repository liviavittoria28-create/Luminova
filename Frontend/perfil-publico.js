/* LUMINOVA — Perfil público: mesmo conteúdo do perfil próprio (somente leitura):
 * conquistas, Skill Tree, mural de agradecimentos, comunidades e publicações.
 * Também: seguir/deixar de seguir, mensagem e agradecer publicações. */
(() => {
  "use strict";
  const { esc } = window.LUMI;
  const $ = (s) => document.querySelector(s);
  const fallback = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="60" fill="#0b4a96"/><text x="60" y="75" font-size="52" text-anchor="middle" fill="#1f9fe8">✦</text></svg>');
  const ROLE_NAMES = { owner: "Dono", admin: "Administrador", moderator: "Moderador", member: "Membro" };
  const BRANCH_NAMES = { origem: "Origem", criacao: "Criação", colaboracao: "Colaboração", comunidade: "Comunidade", exploracao: "Exploração" };
  let sb, me, target, following = false, progress = { xp: 0, level: 1, certified: false };
  const nameOf = (p) => esc(p?.display_name || p?.username || "Membro");

  function applyOwnerTheme(st = {}) {
    const wrap = $("#ppWrap");
    // sem cores escolhidas pela pessoa: vidro azul do tema, com texto escuro
    const card = st.card || null;
    const text = !card ? "var(--az-tinta)" : st.textColor && LUMI.contrast(st.textColor, card) >= 4.5 ? st.textColor : "#f5f6fa";
    wrap.style.setProperty("--pp-text", text);
    if (st.accent) wrap.style.setProperty("--pp-accent", st.accent);
    if (st.card) wrap.style.setProperty("--pp-card", st.card);
    if (st.background) document.body.style.background = st.background;
    document.querySelectorAll(".pp-card,.pp-post,.pp-state,.pp-ach,.pp-com,.pp-thank-card").forEach((el) => { if (st.card) el.style.background = st.card + "e6"; });
  }

  async function counts() {
    const [f1, f2, pc] = await Promise.all([
      sb.from("follows").select("follower_id", { count: "exact", head: true }).eq("followed_id", target.id),
      sb.from("follows").select("followed_id", { count: "exact", head: true }).eq("follower_id", target.id),
      sb.from("posts").select("id", { count: "exact", head: true }).eq("author_id", target.id).is("deleted_at", null).eq("visibility", "public"),
    ]);
    $("#ppFollowers").textContent = String(f1.count || 0);
    $("#ppFollowing").textContent = String(f2.count || 0);
    $("#ppPostsCount").textContent = String(pc.count || 0);
    $("#ppLevel").textContent = String(progress.level);
    $("#ppXp").textContent = String(progress.xp);
  }


  function actions() {
    const host = $("#ppActions");
    if (!me) { host.innerHTML = '<a class="pp-btn" href="index.html">Entre para seguir</a>'; return; }
    if (me.id === target.id) { host.innerHTML = '<a class="pp-btn" href="perfil.html">Editar meu perfil</a>'; return; }
    host.innerHTML = `<button type="button" class="pp-btn${following ? " ghost" : ""}" id="ppFollow" aria-pressed="${following}">${following ? "Deixar de seguir" : "Seguir"}</button>
      <a class="pp-btn ghost" href="chats.html?with=${encodeURIComponent(target.id)}">✉ Enviar mensagem</a>`;
    $("#ppFollow").addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try {
        if (following) {
          const { error } = await sb.from("follows").delete().eq("follower_id", me.id).eq("followed_id", target.id);
          if (error) throw error;
          following = false;
        } else {
          const { error } = await sb.from("follows").insert({ follower_id: me.id, followed_id: target.id });
          if (error && error.code !== "23505") throw error;
          following = true;
        }
        actions();
        await Promise.all([counts(), refreshCertification()]);
      } catch (err) { LUMI.toast("Não foi possível atualizar: " + err.message); b.disabled = false; }
    });
  }

  async function showPeople(kind) {
    const modal = $("#ppModal"), list = $("#ppPeople");
    $("#ppModalTitle").textContent = kind === "followers" ? "Seguidores" : "Seguindo";
    list.innerHTML = '<p class="ln-muted">Carregando…</p>';
    modal.classList.add("open");
    const col = kind === "followers" ? "follower_id" : "followed_id", eq = kind === "followers" ? "followed_id" : "follower_id";
    const r = await sb.from("follows").select(`${col}`).eq(eq, target.id).order("created_at", { ascending: false }).limit(100);
    if (r.error) { list.innerHTML = `<p class="ln-muted">${esc(r.error.message)}</p>`; return; }
    const ids = (r.data || []).map((x) => x[col]);
    if (!ids.length) { list.innerHTML = '<p class="ln-muted">Ninguém por aqui ainda.</p>'; return; }
    const pr = await sb.from("profiles").select("id,display_name,username,avatar_url,is_ai").in("id", ids);
    list.innerHTML = (pr.data || []).map((p) => `<a class="pp-person" href="${LUMI.profileUrl(p.id)}">${LUMI.avatar(p, "x-av", 38)}<span><strong>${esc(p.display_name || p.username || "Membro")}${LUMI.aiBadge(p)}</strong><br><small class="ln-muted">${p.username ? "@" + esc(p.username) : ""}</small></span></a>`).join("") || '<p class="ln-muted">Nenhum perfil visível.</p>';
  }

  // ---- Conquistas: progresso calculado no banco ----
  async function renderAchievements() {
    const host = $("#ppAchievements");
    const { data, error } = await sb.rpc("luminova_profile_achievements", { p_user: target.id });
    if (error) { host.innerHTML = '<p class="pp-empty">Não foi possível carregar as conquistas.</p>'; return; }
    const list = data || [];
    $("#ppAchCount").textContent = `${list.filter((a) => a.earned).length} de ${list.length} conquistadas`;
    host.innerHTML = list.length ? list.map((a) => {
      const pct = Math.round((Math.min(a.progress, a.target) * 100) / a.target);
      return `<article class="pp-ach ${a.earned ? "is-earned" : ""}">
        <span class="pp-ach-icon" aria-hidden="true">${esc(a.icon)}</span>
        <div style="min-width:0;flex:1"><strong>${esc(a.name)}</strong>${a.earned ? ' <span style="color:#1f9fe8;font-size:11px">✦ conquistada</span>' : ""}
          <p>${esc(a.description)}</p>
          <div class="pp-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
          <small>${Math.min(a.progress, a.target)}/${a.target}</small></div></article>`;
    }).join("") : '<p class="pp-empty">Nenhuma conquista cadastrada.</p>';
  }

  // ---- Skill Tree: somente leitura (mesma constelação do perfil próprio) ----
  async function renderSkillTree() {
    const host = $("#ppSkills");
    const [nodesRes, unlockedRes] = await Promise.all([
      sb.from("skill_nodes").select("node_key,name,branch,description,requires,pos_x,pos_y").order("xp_required"),
      sb.from("profile_skills").select("node_key").eq("user_id", target.id),
    ]);
    const nodes = nodesRes.data || [];
    if (!nodes.length) { host.innerHTML = '<p class="pp-empty">Skill Tree ainda não configurada.</p>'; return; }
    const unlocked = new Set((unlockedRes.data || []).map((x) => x.node_key));
    $("#ppSkillCount").textContent = `${unlocked.size} de ${nodes.length} acesas`;
    const byKey = Object.fromEntries(nodes.map((n) => [n.node_key, n]));
    const edges = nodes.flatMap((n) => (n.requires || []).map((r) => byKey[r]
      ? `<line x1="${byKey[r].pos_x}" y1="${byKey[r].pos_y}" x2="${n.pos_x}" y2="${n.pos_y}" stroke="${unlocked.has(r) && unlocked.has(n.node_key) ? "#4ade80aa" : "#333d59"}" stroke-width="1.5"/>`
      : ""));
    const circles = nodes.map((n) => {
      const on = unlocked.has(n.node_key), col = on ? "#4ade80" : "#5a6488";
      return `<g><title>${esc(n.name)}: ${on ? "conquistada" : "bloqueada"}</title>
        <circle cx="${n.pos_x}" cy="${n.pos_y}" r="28" fill="#0c1024" stroke="${col}" stroke-width="2" ${on ? "" : 'stroke-dasharray="4 4"'}/>
        <text x="${n.pos_x}" y="${n.pos_y + 5}" text-anchor="middle" font-size="15" fill="${col}">${on ? "✓" : "✦"}</text>
        <text x="${n.pos_x}" y="${n.pos_y + 48}" text-anchor="middle" font-size="11" fill="${on ? "#dfe3f3" : "#7a84a8"}" stroke="#060914" stroke-width="3" paint-order="stroke">${esc(n.name)}</text></g>`;
    }).join("");
    const list = nodes.map((n) => {
      const on = unlocked.has(n.node_key);
      return `<li class="${on ? "on" : ""}"><span>${on ? "✓" : "○"}</span>${esc(n.name)}<small>${esc(BRANCH_NAMES[n.branch] || n.branch)}</small></li>`;
    }).join("");
    host.innerHTML = `<div class="pp-tree"><svg viewBox="0 0 760 620" role="img" aria-label="Skill Tree de ${nameOf(target)}">${edges.join("")}${circles}</svg></div>
      <ul class="pp-skill-list">${list}</ul>`;
  }

  // ---- Mural de agradecimentos (recebidos) ----
  async function renderMural() {
    const host = $("#ppMural");
    const { data, error } = await sb.from("gratitudes")
      .select("id,message,created_at,post_id,giver:profiles!gratitudes_giver_id_fkey(id,username,display_name,avatar_url,is_ai)")
      .eq("recipient_id", target.id).order("created_at", { ascending: false }).limit(24);
    if (error) { host.innerHTML = '<p class="pp-empty">Não foi possível carregar o mural.</p>'; return; }
    $("#ppThanksCount").textContent = `${data.length} agradecimento${data.length === 1 ? "" : "s"}`;
    host.innerHTML = data.length ? data.map((g) => `<article class="pp-thank-card">
        <div class="who">✦ <span>${esc(g.giver?.display_name || g.giver?.username || "Alguém")}</span> agradeceu</div>
        ${g.message ? `<p>${esc(g.message)}</p>` : `<p style="color:#bfb6d3">Agradeceu uma publicação.</p>`}
        <time datetime="${esc(g.created_at)}">${esc(new Date(g.created_at).toLocaleDateString("pt-BR"))}</time>
        ${g.post_id ? ` · <a href="geral.html?post=${encodeURIComponent(g.post_id)}">Ver publicação ↗</a>` : ""}
      </article>`).join("")
      : '<p class="pp-empty">Ainda não há agradecimentos. Quando alguém agradecer uma publicação, ela aparece aqui.</p>';
  }

  // ---- Comunidades que participa (respeita RLS: comunidades privadas não aparecem para quem não é membro) ----
  async function renderCommunities() {
    const host = $("#ppCommunities");
    const { data, error } = await sb.from("community_members")
      .select("role, community:communities(id,name,description,avatar_url,visibility)")
      .eq("user_id", target.id).eq("status", "active").limit(60);
    if (error) { host.innerHTML = '<p class="pp-empty">Não foi possível carregar as comunidades.</p>'; return; }
    const list = (data || []).filter((r) => r.community);
    $("#ppComCount").textContent = `${list.length} comunidade${list.length === 1 ? "" : "s"}`;
    host.innerHTML = list.length ? list.map((r) => {
      const c = r.community;
      const av = c.avatar_url
        ? `<img class="pp-com-av" src="${esc(c.avatar_url)}" alt="">`
        : `<span class="pp-com-av" aria-hidden="true">${esc((c.name || "?").slice(0, 1).toUpperCase())}</span>`;
      return `<a class="pp-com" href="comunidade-detalhe.html?id=${encodeURIComponent(c.id)}">${av}<span><strong>${esc(c.name)}</strong><small>${esc(ROLE_NAMES[r.role] || "Membro")}</small></span></a>`;
    }).join("") : '<p class="pp-empty">Ainda não participa de comunidades.</p>';
  }

  // ---- Publicações no estilo de rede social: comentários, agradecer e abrir ----
  async function renderPosts(posts) {
    const host = $("#ppPosts");
    if (!posts.length) {
      host.innerHTML = '<div class="pp-state">Esta pessoa ainda não tem publicações públicas. Quando publicar algo, aparecerá aqui.</div>';
      return;
    }
    const ids = posts.map((p) => p.id);
    const [thanksRes, commentsRes] = await Promise.all([
      sb.from("gratitudes").select("post_id,giver_id").in("post_id", ids),
      sb.from("comments").select("post_id").in("post_id", ids).is("deleted_at", null),
    ]);
    const thanks = new Map(), mine = new Set(), comments = new Map();
    (thanksRes.data || []).forEach((g) => {
      thanks.set(g.post_id, (thanks.get(g.post_id) || 0) + 1);
      if (me && g.giver_id === me.id) mine.add(g.post_id);
    });
    (commentsRes.data || []).forEach((c) => comments.set(c.post_id, (comments.get(c.post_id) || 0) + 1));

    host.innerHTML = posts.map((post) => {
      const media = (post.media_urls || []).map((u) => /\.(mp4|webm|ogg)(\?|$)/i.test(u) ? `<video controls preload="metadata" src="${esc(u)}"></video>` : `<img loading="lazy" src="${esc(u)}" alt="Mídia publicada" onerror="this.style.display='none'">`).join("");
      const isMine = mine.has(post.id);
      return `<article class="pp-post" data-post="${esc(post.id)}">
        <div class="pp-post-top"><img src="${esc(target.avatar_url || fallback)}" alt="">
          <div><strong>${nameOf(target)}${LUMI.certBadge(progress.certified)}${LUMI.aiBadge(target)}</strong>
            <span class="pp-meta">${target.username ? "@" + esc(target.username) : ""}<time>· ${esc(LUMI.time(post.created_at))}</time></span></div></div>
        <div class="pp-post-content">${esc(post.content || "")}</div>${media ? `<div class="pp-media">${media}</div>` : ""}
        <div class="pp-act-row" role="group" aria-label="Interações da publicação">
          <a class="pp-act" href="geral.html?post=${encodeURIComponent(post.id)}" title="Comentários">💬 <span>${comments.get(post.id) || 0}</span></a>
          <button type="button" class="pp-act${isMine ? " on" : ""}" data-thank="${esc(post.id)}" aria-pressed="${isMine}" ${me ? "" : "disabled"}
            title="${isMine ? "Remover agradecimento" : "Agradecer esta publicação"}">✦ <span>${thanks.get(post.id) || 0}</span> ${isMine ? "Agradecido" : "Agradecer"}</button>
          <a class="pp-act" href="geral.html?post=${encodeURIComponent(post.id)}">Abrir ↗</a>
        </div></article>`;
    }).join("");

    host.querySelectorAll("[data-thank]").forEach((btn) => btn.addEventListener("click", () => toggleThanks(btn)));
  }

  async function toggleThanks(btn) {
    if (!me) return;
    const postId = btn.dataset.thank;
    const wasOn = btn.getAttribute("aria-pressed") === "true";
    const countEl = btn.querySelector("span");
    const current = Number(countEl.textContent) || 0;
    btn.disabled = true;
    try {
      if (wasOn) {
        const { error } = await sb.from("gratitudes").delete().eq("giver_id", me.id).eq("post_id", postId);
        if (error) throw error;
      } else {
        const { error } = await sb.from("gratitudes").insert({ giver_id: me.id, recipient_id: target.id, post_id: postId, message: "" });
        if (error && error.code !== "23505") throw error;
      }
      // Atualiza o botão sem recarregar a página
      const on = !wasOn;
      btn.setAttribute("aria-pressed", String(on));
      btn.classList.toggle("on", on);
      countEl.textContent = String(Math.max(0, current + (on ? 1 : -1)));
      btn.lastChild.textContent = on ? " Agradecido" : " Agradecer";
      btn.title = on ? "Remover agradecimento" : "Agradecer esta publicação";
      renderMural();
    } catch (err) {
      LUMI.toast("Não foi possível agradecer: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // Certificação pode mudar quando alguém segue/deixa de seguir.
  async function refreshCertification() {
    const { data } = await sb.from("profile_progress").select("xp,level,certified").eq("user_id", target.id).maybeSingle();
    if (data) progress = data;
    $("#ppName").innerHTML = nameOf(target) + LUMI.certBadge(progress.certified) + LUMI.aiBadge(target);
  }

  async function init() {
    await LUMI.ready; sb = LUMI.sb; me = LUMI.user;
    if (!me) {
      $("#ppName").textContent = "Faça login para continuar";
      $("#ppPosts").innerHTML = '<div class="pp-state">Entre na sua conta para ver perfis. <a href="index.html">Entrar na LumiNova</a></div>';
      return;
    }
    const id = new URLSearchParams(location.search).get("id");
    if (!id) { $("#ppName").textContent = "Perfil não encontrado"; $("#ppPosts").innerHTML = '<div class="pp-state">Este link não contém um perfil válido. <a href="explorar.html?type=profiles">Pesquisar pessoas</a></div>'; return; }
    if (id === me.id) { location.replace("perfil.html"); return; }
    const { data: p, error } = await sb.from("profiles").select("id,username,display_name,bio,avatar_url,cover_url,account_visibility,created_at,profile_settings,is_ai").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!p) {
      $("#ppName").textContent = "Perfil indisponível";
      $("#ppBio").textContent = "Este perfil não existe, está privado ou você não tem permissão para visualizá-lo.";
      $("#ppPosts").innerHTML = '<div class="pp-state">Não foi possível abrir este perfil. <a href="explorar.html?type=profiles">Pesquisar pessoas</a></div>';
      return;
    }
    target = p;
    document.title = `${p.display_name || p.username || "Perfil"} — LumiNova`;
    $("#ppHandle").textContent = p.username ? "@" + p.username : "Membro da LumiNova";
    $("#ppBio").textContent = p.bio || "Esta pessoa ainda não adicionou uma apresentação.";
    $("#ppAvatar").src = p.avatar_url || fallback;
    if (p.cover_url) $("#ppCover").style.backgroundImage = `linear-gradient(90deg,#090a1888,#090a1844),url("${String(p.cover_url).replace(/["\\]/g, "")}")`;

    const [progRes, f] = await Promise.all([
      sb.from("profile_progress").select("xp,level,certified").eq("user_id", p.id).maybeSingle(),
      sb.from("follows").select("follower_id", { head: true, count: "exact" }).eq("follower_id", me.id).eq("followed_id", p.id),
    ]);
    if (progRes.data) progress = progRes.data;
    following = (f.count || 0) > 0;
    $("#ppName").innerHTML = nameOf(p) + LUMI.certBadge(progress.certified) + LUMI.aiBadge(p);
    actions();
    applyOwnerTheme(p.profile_settings || {});
    $("#ppFollowersBtn").addEventListener("click", () => showPeople("followers"));
    $("#ppFollowingBtn").addEventListener("click", () => showPeople("following"));
    document.querySelectorAll("#ppModal [data-close]").forEach((b) => b.addEventListener("click", () => $("#ppModal").classList.remove("open")));
    $("#ppModal").addEventListener("click", (e) => { if (e.target.id === "ppModal") $("#ppModal").classList.remove("open"); });

    // Seções independentes: uma falha não derruba as outras.
    const safe = (fn) => fn().catch((err) => console.warn("Seção do perfil:", err));
    const postsPromise = sb.from("posts").select("id,content,media_urls,created_at,post_type").eq("author_id", p.id).is("deleted_at", null).eq("visibility", "public").order("created_at", { ascending: false }).limit(30);
    await Promise.all([
      counts(),
      safe(renderAchievements),
      safe(renderSkillTree),
      safe(renderMural),
      safe(renderCommunities),
      postsPromise.then((r) => (r.error ? Promise.reject(r.error) : renderPosts(r.data || []))).catch((err) => {
        $("#ppPosts").innerHTML = `<div class="pp-state">Não foi possível carregar as publicações: ${esc(err.message || "erro")}</div>`;
      }),
    ]);
  }
  document.addEventListener("DOMContentLoaded", () => init().catch((err) => {
    console.error("Falha ao abrir perfil público:", err);
    $("#ppName").textContent = "Não foi possível abrir este perfil";
    $("#ppPosts").innerHTML = `<div class="pp-state">O perfil não pôde ser carregado. Erro: ${esc(err.message || "erro desconhecido")}<br><a href="explorar.html?type=profiles">Pesquisar pessoas</a></div>`;
  }));
})();
