/* LUMINOVA — Comunidades: lista real, filtro "Minhas", criação com identidade visual, capa e avatar. */
(() => {
  "use strict";
  const { esc } = window.LUMI;
  const $ = (s, r = document) => r.querySelector(s);
  const THEMES = {
    purple: { page_color: "#0b0720", accent_color: "#a78bfa", card_color: "#15102e" },
    blue: { page_color: "#04101f", accent_color: "#60a5fa", card_color: "#0a1a30" },
    rose: { page_color: "#1a0714", accent_color: "#f472b6", card_color: "#2a0f20" },
    green: { page_color: "#04140d", accent_color: "#4ade80", card_color: "#0a2418" },
  };
  window.LUMI.THEMES = THEMES;
  let sb, me, rows = [], mine = new Set(), filter = "all";

  async function upload(file, folder) {
    if (!file.type.startsWith("image/")) throw Error("Escolha uma imagem.");
    if (file.size > 5 * 1024 * 1024) throw Error("A imagem deve ter até 5 MB.");
    const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
    const path = `${me.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await sb.storage.from("community-media").upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    return sb.storage.from("community-media").getPublicUrl(path).data.publicUrl;
  }

  async function load() {
    const r = await sb.from("v_community_directory").select("community_id,name,slug,description,visibility,join_policy,avatar_url,cover_url,created_at,owner_id,active_member_count").order("created_at", { ascending: false }).limit(200);
    if (r.error) throw r.error;
    rows = (r.data || []).filter((c) => c.visibility === "public" || c.owner_id === me?.id);
    mine = new Set();
    if (me) {
      const m = await sb.from("community_members").select("community_id").eq("user_id", me.id).eq("status", "active");
      (m.data || []).forEach((x) => mine.add(x.community_id));
    }
  }

  function render() {
    const q = ($("#communitySearch").value || new URLSearchParams(location.search).get("q") || "").trim().toLowerCase();
    const list = rows.filter((c) => (filter === "all" || mine.has(c.community_id)) && `${c.name} ${c.description}`.toLowerCase().includes(q));
    const grid = $("#communityGrid");
    grid.innerHTML = list.length
      ? list.map((c) => {
          const cover = c.cover_url ? `background-image:linear-gradient(0deg,rgba(5,8,18,.72),rgba(5,8,18,.04)),url('${esc(c.cover_url)}');background-size:cover;background-position:center` : "";
          const n = c.active_member_count || 0;
          return `<a class="ln-community-card ln-real-card" href="comunidade-detalhe.html?id=${encodeURIComponent(c.community_id)}" style="text-decoration:none;color:inherit">
            <div class="ln-card-art" style="${cover}"><span class="ln-card-symbol">${c.avatar_url ? `<img src="${esc(c.avatar_url)}" alt="" loading="lazy">` : (window.LUMI_THEME ? LUMI_THEME.logo(30,"cc"+c.community_id) : "")}</span><span class="ln-card-tag">${mine.has(c.community_id) ? "VOCÊ PARTICIPA" : "LUMINOVA / ESPAÇO"}</span></div>
            <div class="ln-card-body"><div class="ln-card-title"><h3>${esc(c.name)}</h3></div><p>${esc(c.description || "Um espaço para compartilhar o que você ama.")}</p>
            <div class="ln-card-foot"><span>${n} ${n === 1 ? "membro" : "membros"}</span><strong>Conhecer espaço</strong></div></div></a>`;
        }).join("")
      : `<div class="ln-panel ln-empty">${filter === "mine" ? "Você ainda não participa de comunidades." : "Nenhuma comunidade encontrada. Você pode criar a primeira."}</div>`;
    $("#communityCount").textContent = `${list.length} ${list.length === 1 ? "comunidade" : "comunidades"}`;
  }

  async function limits() {
    const n = $("#limitNotice");
    if (!me) return;
    const { data, error } = await sb.rpc("luminova_my_limits");
    if (error || !data?.[0]) return;
    const d = data[0];
    n.textContent = d.is_admin
      ? "Administradora: comunidades ilimitadas."
      : `Você participa de ${d.communities_joined} de ${d.community_limit} comunidades. Com 500 XP o limite sobe para 5 (você tem ${d.xp} XP).`;
  }

  function bindModal() {
    const modal = $("#createModal"), form = $("#createForm");
    $("#createCommunity").addEventListener("click", () => {
      if (!me) { LUMI.toast("Entre na sua conta para criar uma comunidade."); return; }
      modal.classList.add("open"); $("#newName").focus();
    });
    modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => modal.classList.remove("open")));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") modal.classList.remove("open"); });
    const prev = (inp, box) => inp.addEventListener("change", () => {
      const f = inp.files?.[0];
      box.hidden = !f;
      if (f) box.style.backgroundImage = `url('${URL.createObjectURL(f)}')`;
    });
    prev($("#newCover"), $("#coverPrev")); prev($("#newAvatar"), $("#avatarPrev"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[type=submit]"), err = $("#createErr");
      err.textContent = ""; btn.disabled = true;
      try {
        const name = $("#newName").value.trim(), description = $("#newDesc").value.trim();
        if (name.length < 3) throw Error("O nome precisa ter pelo menos 3 caracteres.");
        const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + crypto.randomUUID().slice(0, 6);
        const cf = $("#newCover").files?.[0], af = $("#newAvatar").files?.[0];
        const cover_url = cf ? await upload(cf, "cover") : null;
        const avatar_url = af ? await upload(af, "avatar") : null;
        const theme = $("#newTheme").value;
        const { data, error } = await sb.from("communities").insert({
          owner_id: me.id, name, slug, description, visibility: "public", join_policy: "open", cover_url, avatar_url,
          settings: { theme, cover_style: "cosmic", ...THEMES[theme] },
        }).select("id").single();
        if (error) throw error;
        location.href = "comunidade-detalhe.html?id=" + encodeURIComponent(data.id);
      } catch (ex) { err.textContent = ex.message || "Não foi possível criar a comunidade."; btn.disabled = false; }
    });
  }

  async function init() {
    await LUMI.ready; sb = LUMI.sb; me = LUMI.user;
    bindModal();
    $("#communitySearch").addEventListener("input", render);
    document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
      filter = b.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      render();
    }));
    try { await load(); render(); limits(); }
    catch (e) { console.error(e); $("#communityGrid").innerHTML = `<div class="ln-panel ln-empty">Não foi possível carregar as comunidades: ${esc(e.message || "erro")}.</div>`; }
  }
  document.addEventListener("DOMContentLoaded", () => init());
})();
