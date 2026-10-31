/* LUMINOVA — Explorar: pesquisa global (perfis, comunidades, publicações) direto no banco, respeitando RLS. */
(() => {
  "use strict";
  const { esc } = window.LUMI;
  const $ = (s) => document.querySelector(s);
  let sb, me, kind = "all", seq = 0, timer;

  const clean = (q) => q.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
  const snippet = (t, q) => {
    const s = String(t || ""), i = q ? s.toLowerCase().indexOf(q.toLowerCase()) : -1;
    const a = Math.max(0, i - 40);
    return (a > 0 ? "…" : "") + s.slice(a, a + 160) + (s.length > a + 160 ? "…" : "");
  };
  const mark = (txt, q) => {
    const e = esc(txt);
    if (!q) return e;
    const re = new RegExp("(" + esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
    return e.replace(re, "<mark>$1</mark>");
  };

  async function search(raw) {
    const q = clean(raw), my = ++seq;
    const want = (k) => kind === "all" || kind === k;
    const lim = kind === "all" ? 6 : 30;
    $("#xStatus").textContent = q ? `Buscando “${q}”…` : "Mostrando o que há de mais recente na LumiNova.";
    const like = `%${q}%`;
    const tasks = {};
    if (want("profiles")) {
      let p = sb.from("profiles").select("id,username,display_name,bio,avatar_url,is_ai");
      p = q ? p.or(`display_name.ilike.${like},username.ilike.${like}`) : p.order("created_at", { ascending: false });
      tasks.profiles = p.limit(lim);
    }
    if (want("communities")) {
      let c = sb.from("v_community_directory").select("community_id,name,description,avatar_url,cover_url,active_member_count,visibility").eq("visibility", "public");
      c = q ? c.or(`name.ilike.${like},description.ilike.${like}`) : c.order("created_at", { ascending: false });
      tasks.communities = c.limit(lim);
    }
    if (want("posts")) {
      let s = sb.from("v_feed_posts").select("post_id,author_id,username,display_name,avatar_url,is_ai,content,created_at,reaction_count,comment_count");
      if (q) s = s.ilike("content", like);
      tasks.posts = s.order("created_at", { ascending: false }).limit(lim);
    }
    const keys = Object.keys(tasks);
    const res = await Promise.all(keys.map((k) => tasks[k]));
    if (my !== seq) return; // resposta antiga
    const out = {}; const errs = [];
    keys.forEach((k, i) => { if (res[i].error) errs.push(res[i].error.message); out[k] = res[i].data || []; });
    render(out, q, errs);
  }

  function section(title, count, inner, emptyMsg) {
    return `<section class="x-sec"><h2>${title} <span class="ln-muted">${count}</span></h2>${count ? inner : `<p class="ln-muted">${emptyMsg}</p>`}</section>`;
  }

  function render(o, q, errs) {
    let html = "", total = 0;
    if (o.profiles) {
      total += o.profiles.length;
      html += section("Perfis", o.profiles.length, `<div class="x-grid">${o.profiles.map((p) => `
        <a class="x-card" href="${LUMI.profileUrl(p.id)}">${LUMI.avatar(p, "x-av", 48)}
        <span class="x-txt"><strong>${mark(p.display_name || p.username || "Perfil", q)}${LUMI.aiBadge(p)}</strong><small>${p.username ? "@" + mark(p.username, q) : ""}</small>
        <small class="ln-muted">${esc((p.bio || "").slice(0, 90))}</small></span></a>`).join("")}</div>`, "Nenhum perfil encontrado.");
    }
    if (o.communities) {
      total += o.communities.length;
      html += section("Comunidades", o.communities.length, `<div class="x-grid">${o.communities.map((c) => `
        <a class="x-card" href="comunidade-detalhe.html?id=${encodeURIComponent(c.community_id)}">${c.avatar_url ? `<span class="x-av" style="width:48px;height:48px;border-radius:2px;overflow:hidden;display:inline-block"><img src="${esc(c.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>` : '<span class="x-av x-sq" aria-hidden="true"></span>'}
        <span class="x-txt"><strong>${mark(c.name, q)}</strong><small class="ln-muted">${esc((c.description || "").slice(0, 100))}</small>
        <small>${c.active_member_count || 0} membro(s)</small></span></a>`).join("")}</div>`, "Nenhuma comunidade encontrada.");
    }
    if (o.posts) {
      total += o.posts.length;
      html += section("Publicações", o.posts.length, `<div class="x-list">${o.posts.map((p) => `
        <a class="x-post" href="geral.html?post=${encodeURIComponent(p.post_id)}">
        <span class="x-post-head">${LUMI.avatar(p, "x-av", 32)}<strong>${esc(p.display_name || p.username || "Membro")}${LUMI.aiBadge(p)}</strong><small class="ln-muted">${esc(LUMI.time(p.created_at))}</small></span>
        <span class="x-post-body">${mark(snippet(p.content, q), q)}</span>
        <small class="ln-muted">${p.reaction_count || 0} curtidas · ${p.comment_count || 0} comentários</small></a>`).join("")}</div>`, "Nenhuma publicação encontrada.");
    }
    $("#xResults").innerHTML = html;
    $("#xStatus").textContent = errs.length
      ? "Alguns resultados não puderam ser carregados: " + errs[0]
      : q ? (total ? `${total} resultado(s) para “${q}”.` : `Nenhum resultado para “${q}”. Tente outro nome, usuário ou palavra.`) : "Mostrando o que há de mais recente na LumiNova.";
  }

  function sync() {
    const u = new URL(location.href);
    const q = $("#xQuery").value.trim();
    q ? u.searchParams.set("q", q) : u.searchParams.delete("q");
    kind === "all" ? u.searchParams.delete("type") : u.searchParams.set("type", kind);
    history.replaceState(null, "", u);
  }

  async function init() {
    if (!(await LUMI.requireLogin())) return;
    sb = LUMI.sb; me = LUMI.user;
    const params = new URLSearchParams(location.search);
    $("#xQuery").value = params.get("q") || "";
    const t = params.get("type");
    if (["profiles", "communities", "posts"].includes(t)) kind = t;
    document.querySelectorAll("[data-kind]").forEach((b) => {
      const on = b.dataset.kind === kind;
      b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", () => {
        kind = b.dataset.kind;
        document.querySelectorAll("[data-kind]").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
        sync(); search($("#xQuery").value);
      });
    });
    $("#xQuery").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { sync(); search($("#xQuery").value); }, 250); });
    $("#xForm").addEventListener("submit", (e) => { e.preventDefault(); sync(); search($("#xQuery").value); });
    search($("#xQuery").value);
  }
  document.addEventListener("DOMContentLoaded", () => init().catch((e) => { $("#xStatus").textContent = "Erro: " + e.message; }));
})();
