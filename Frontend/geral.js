/* LUMINOVA — Geral: feed real (paginado), "Para você", salvos, edição/exclusão, denúncias, tópico do dia,
   assuntos do momento e recomendações por interesses. Tudo vem do Supabase; nada é inventado. */
(() => {
  "use strict";
  const { esc } = window.LUMI;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const PAGE = 20;
  const qs = new URLSearchParams(location.search);
  const focusPost = qs.get("post");
  const savedMode = qs.has("salvos");
  let sb, me;
  let sort = "recent", activeTag = null, offset = 0;
  let posts = [];
  let myLikes = new Set(), mySaved = new Set();

  const hashtagify = (txt) =>
    esc(txt).replace(/(^|\s)#([\p{L}\p{N}_]{2,40})/gu, (_, sp, t) => `${sp}<a href="#" class="ln-hashtag" data-tag="${t.toLowerCase()}">#${t}</a>`);

  const MEDIA = { image: { types: /^image\/(jpeg|png|webp|gif)$/, max: 10 }, video: { types: /^video\/(mp4|webm)$/, max: 100 } };
  async function upload(file, folder) {
    const kind = file.type.startsWith("video/") ? "video" : "image";
    if (!MEDIA[kind].types.test(file.type)) throw Error("Formato não suportado. Use JPG, PNG, WEBP, GIF, MP4 ou WEBM.");
    if (file.size > MEDIA[kind].max * 1024 * 1024) throw Error(`O arquivo deve ter até ${MEDIA[kind].max} MB.`);
    const safe = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80);
    const path = `${me.id}/${folder}/${Date.now()}-${safe}`;
    const { error } = await sb.storage.from("community-media").upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    return sb.storage.from("community-media").getPublicUrl(path).data.publicUrl;
  }

  // ---------------- carregar publicações ----------------
  async function fetchPage() {
    if (focusPost) {
      const r = await sb.from("v_feed_posts").select("*").eq("post_id", focusPost);
      if (r.error) throw r.error;
      // publicação de comunidade abre dentro da comunidade, nunca no feed geral
      const cid = r.data?.[0]?.community_id;
      if (cid) { location.replace(`comunidade-detalhe.html?id=${encodeURIComponent(cid)}&post=${encodeURIComponent(focusPost)}`); return { rows: [], more: false }; }
      return { rows: r.data || [], more: false };
    }
    if (savedMode) {
      const s = await sb.from("saved_posts").select("post_id,created_at").eq("user_id", me.id).order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
      if (s.error) throw s.error;
      const ids = (s.data || []).map((x) => x.post_id);
      if (!ids.length) return { rows: [], more: false };
      const r = await sb.from("v_feed_posts").select("*").in("post_id", ids);
      if (r.error) throw r.error;
      const by = Object.fromEntries((r.data || []).map((p) => [p.post_id, p]));
      return { rows: ids.map((i) => by[i]).filter(Boolean), more: ids.length === PAGE };
    }
    if (activeTag) {
      const r = await sb.rpc("luminova_posts_by_tag", { tag_text: activeTag, result_limit: 100 });
      if (r.error) throw r.error;
      return { rows: r.data || [], more: false };
    }
    if (sort === "foryou" && me) {
      const r = await sb.rpc("luminova_recommend_posts", { result_limit: PAGE, result_offset: offset });
      if (!r.error) return { rows: r.data || [], more: (r.data || []).length === PAGE };
      sort = "recent";
    }
    if (sort === "popular") {
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      const r = await sb.from("v_feed_posts").select("*").is("community_id", null).gte("created_at", since).order("created_at", { ascending: false }).limit(150);
      if (r.error) throw r.error;
      const rows = (r.data || []).sort((a, b) => (b.reaction_count + b.comment_count) - (a.reaction_count + a.comment_count) || new Date(b.created_at) - new Date(a.created_at));
      return { rows: rows.slice(offset, offset + PAGE), more: rows.length > offset + PAGE };
    }
    // feed geral: nunca mostra publicações feitas dentro de comunidades
    const q = sb.from("v_feed_posts").select("*").is("community_id", null).order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
    const r = await q;
    if (r.error) throw r.error;
    return { rows: r.data || [], more: (r.data || []).length === PAGE };
  }

  function postMenu(p) {
    const mine = me && p.author_id === me.id;
    const saved = mySaved.has(p.post_id);
    return `<div class="l3-menu"><button type="button" aria-haspopup="true" aria-expanded="false" aria-label="Mais opções da publicação" data-menu>⋯</button>
      <div class="l3-menu-list" role="menu" hidden>
        ${me ? `<button role="menuitem" data-save="${esc(p.post_id)}">${saved ? "Remover dos salvos" : "Salvar publicação"}</button>` : ""}
        <button role="menuitem" data-share="${esc(p.post_id)}">Copiar link</button>
        ${mine ? `<button role="menuitem" data-edit="${esc(p.post_id)}">Editar</button><button role="menuitem" class="danger" data-del="${esc(p.post_id)}">Excluir</button>` : ""}
        ${me && !mine ? `<button role="menuitem" data-report="post" data-id="${esc(p.post_id)}">Denunciar</button><button role="menuitem" class="danger" data-block="${esc(p.author_id)}" data-name="${esc(p.display_name || p.username || "")}">Bloquear ${esc(p.display_name || "autor")}</button>` : ""}
      </div></div>`;
  }

  function postHtml(p) {
    const media = (p.media_urls || [])
      .map((u) => (/\.(mp4|webm|mov)(\?|$)/i.test(u)
        ? `<video controls playsinline preload="metadata" src="${esc(u)}" class="g-media"></video>`
        : `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Imagem enviada por ${esc(p.display_name || "autor")}" loading="lazy" class="g-media"></a>`))
      .join("");
    const liked = myLikes.has(p.post_id);
    const prof = { display_name: p.display_name, username: p.username, avatar_url: p.avatar_url };
    const name = esc(p.display_name || p.username || "Pessoa");
    const edited = p.updated_at && p.created_at && new Date(p.updated_at) - new Date(p.created_at) > 60e3 && p._edited !== false;
    return `<article class="ln-post" data-post="${esc(p.post_id)}">
      <a class="tw-av" href="${LUMI.profileUrl(p.author_id)}" aria-label="Abrir perfil de ${name}">${LUMI.avatar(prof, "ln-avatar-img", 44)}</a>
      <div class="tw-meta" style="display:flex;gap:6px;align-items:flex-start"><div style="min-width:0"><a class="ln-author" href="${LUMI.profileUrl(p.author_id)}">${name}</a>
        <span class="ln-handle">${p.username ? "@" + esc(p.username) + " · " : ""}<time datetime="${esc(p.created_at)}">${esc(LUMI.time(p.created_at))}</time>${edited ? ' · <span class="l3-edited">editado</span>' : ""}</span></div>${postMenu(p)}</div>
      <p class="g-text">${hashtagify(p.content)}</p>${media}
      <div class="ln-post-actions">
        <button class="ln-action" data-comment="${esc(p.post_id)}" aria-expanded="false" aria-label="Comentários"><svg class="ln-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H9l-5 4z"/></svg> <span class="g-ccount">${p.comment_count || 0}</span></button>
        <button class="ln-action g-like${liked ? " is-on" : ""}" data-like="${esc(p.post_id)}" aria-pressed="${liked}" aria-label="Curtir"><svg class="ln-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/></svg> <span>${p.reaction_count || 0}</span></button>
        <button class="ln-action" data-share="${esc(p.post_id)}" aria-label="Compartilhar"><svg class="ln-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7h16v-7M12 3v12M7 8l5-5 5 5"/></svg></button>
        ${me ? `<button class="ln-action${mySaved.has(p.post_id) ? " is-on" : ""}" data-save="${esc(p.post_id)}" aria-pressed="${mySaved.has(p.post_id)}" aria-label="Salvar"><svg class="ln-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg></button>` : ""}
      </div>
      <div class="ln-comments" id="comments-${esc(p.post_id)}" hidden></div>
    </article>`;
  }

  function emptyState() {
    if (savedMode) return `<div class="l3-empty"><strong>Nada salvo ainda</strong><span>Use o marcador nas publicações para guardar o que quiser rever.</span><a class="l3-btn sm" href="geral.html">Voltar ao feed</a></div>`;
    if (activeTag) return `<div class="l3-empty"><strong>Nenhuma publicação com #${esc(activeTag)}</strong><span>Que tal ser a primeira pessoa a usar essa hashtag?</span></div>`;
    if (sort === "foryou") return `<div class="l3-empty"><strong>Ainda não temos sugestões</strong><span>Escolha interesses e siga pessoas para o “Para você” ganhar forma.</span><a class="l3-btn sm" href="configuracoes.html#interesses">Escolher interesses</a></div>`;
    return `<div class="l3-empty"><strong>O feed ainda está quieto</strong><span>Compartilhe algo que você ama: um desenho, uma música, uma teoria, uma dúvida.</span></div>`;
  }

  async function marks(ids) {
    if (!me || !ids.length) return;
    const [l, s] = await Promise.all([
      sb.from("post_reactions").select("post_id").eq("user_id", me.id).eq("reaction", "like").in("post_id", ids),
      sb.from("saved_posts").select("post_id").eq("user_id", me.id).in("post_id", ids),
    ]);
    (l.data || []).forEach((x) => myLikes.add(x.post_id));
    (s.data || []).forEach((x) => mySaved.add(x.post_id));
  }

  async function renderFeed(append = false) {
    const host = $("#generalFeed");
    host.setAttribute("aria-busy", "true");
    if (!append) { offset = 0; posts = []; }
    try {
      const { rows, more } = await fetchPage();
      offset += rows.length;
      await marks(rows.map((r) => r.post_id));
      posts = posts.concat(rows);
      const bar = $("#tagFilterBar");
      bar.hidden = !activeTag && !focusPost && !savedMode;
      if (focusPost) bar.innerHTML = `Publicação compartilhada <a class="ln-chip" href="geral.html">Ver o feed completo</a>`;
      else if (savedMode) bar.innerHTML = `<strong>Seus salvos</strong> <a class="ln-chip" href="geral.html">Voltar ao feed</a>`;
      else if (activeTag) bar.innerHTML = `Mostrando <strong>#${esc(activeTag)}</strong> <button type="button" class="ln-chip" id="clearTag">Limpar filtro ✕</button>`;
      if (append) host.insertAdjacentHTML("beforeend", rows.map(postHtml).join(""));
      else host.innerHTML = posts.length ? posts.map(postHtml).join("") : emptyState();
      $("#feedMore").hidden = !more;
      if (focusPost && posts.length) $(`[data-comment="${CSS.escape(focusPost)}"]`)?.click();
    } catch (e) {
      console.error(e);
      host.innerHTML = `<div class="l3-alert err">Não foi possível carregar o feed agora. Verifique sua conexão e tente de novo.</div>`;
    } finally { host.removeAttribute("aria-busy"); }
  }

  // ---------------- comentários ----------------
  async function loadComments(postId) {
    const box = document.getElementById(`comments-${postId}`);
    box.hidden = false;
    box.innerHTML = '<p class="ln-muted">Carregando comentários…</p>';
    const { data, error } = await sb
      .from("comments")
      .select("id,content,created_at,parent_comment_id,author_id,author:profiles!comments_author_id_fkey(id,username,display_name,avatar_url)")
      .eq("post_id", postId).is("deleted_at", null).order("created_at", { ascending: true });
    if (error) { box.innerHTML = `<p class="ln-muted">Não foi possível carregar os comentários.</p>`; return; }
    const byParent = {};
    (data || []).forEach((c) => (byParent[c.parent_comment_id || "root"] ||= []).push(c));
    const one = (c, depth) => `<div class="ln-comment" style="margin-left:${Math.min(depth, 3) * 18}px">
      <div class="ln-post-head">${LUMI.avatar(c.author, "ln-avatar-img", 30)}<div><a class="ln-author" href="${LUMI.profileUrl(c.author_id)}">${esc(c.author?.display_name || c.author?.username || "Membro")}</a><div class="ln-handle">${esc(LUMI.time(c.created_at))}</div></div></div>
      <p>${esc(c.content)}</p>
      ${me ? `<div class="l3-row" style="gap:4px"><button class="ln-action" data-reply="${esc(c.id)}" data-post="${esc(postId)}">Responder</button>
        ${c.author_id === me.id ? `<button class="ln-action" data-cdel="${esc(c.id)}" data-post="${esc(postId)}">Apagar</button>` : `<button class="ln-action" data-report="comment" data-id="${esc(c.id)}">Denunciar</button>`}</div>` : ""}</div>
      ${(byParent[c.id] || []).map((r) => one(r, depth + 1)).join("")}`;
    const list = (byParent.root || []).map((c) => one(c, 0)).join("") || '<p class="ln-muted">Ainda sem comentários. Comece a conversa.</p>';
    box.innerHTML = `${list}${me
      ? `<form class="ln-inline-reply" data-cform="${esc(postId)}"><input class="ln-input" name="comment" maxlength="5000" placeholder="Escreva um comentário…" required aria-label="Escreva um comentário"><button class="ln-btn" type="submit">Enviar</button></form>`
      : '<p class="ln-muted"><a href="index.html?redirect=geral.html">Entre na sua conta</a> para comentar.</p>'}`;
    const cc = box.closest("article")?.querySelector(".g-ccount");
    if (cc) cc.textContent = String((data || []).length);
  }
  async function sendComment(postId, content, parent) {
    const payload = { post_id: postId, author_id: me.id, content };
    if (parent) payload.parent_comment_id = parent;
    const { error } = await sb.from("comments").insert(payload);
    if (error) throw error;
    await loadComments(postId);
  }

  // ---------------- ações ----------------
  async function toggleSave(id, btns) {
    const on = mySaved.has(id);
    const { error } = on ? await sb.from("saved_posts").delete().eq("user_id", me.id).eq("post_id", id)
                         : await sb.from("saved_posts").insert({ user_id: me.id, post_id: id });
    if (error && error.code !== "23505") return LUMI.toast("Não foi possível salvar.");
    on ? mySaved.delete(id) : mySaved.add(id);
    $$(`[data-save="${CSS.escape(id)}"]`).forEach((b) => {
      if (b.getAttribute("role") === "menuitem") b.textContent = on ? "Salvar publicação" : "Remover dos salvos";
      else { b.classList.toggle("is-on", !on); b.setAttribute("aria-pressed", String(!on)); }
    });
    LUMI.toast(on ? "Removido dos salvos." : "Salvo. Veja em Salvos, no menu.");
    if (savedMode && on) $(`[data-post="${CSS.escape(id)}"]`)?.remove();
  }
  function editPost(id) {
    const p = posts.find((x) => x.post_id === id);
    if (!p) return;
    LUMI.dialog({
      title: "Editar publicação", confirm: "Salvar",
      body: `<div class="l3-field"><label for="edTxt">Texto</label><textarea id="edTxt" name="t" rows="5" maxlength="10000">${esc(p.content)}</textarea></div><p class="l3-small">A publicação mostrará “editado”.</p>`,
      onSubmit: async (f) => {
        const t = f.t.value.trim();
        if (!t) throw new Error("O texto não pode ficar vazio.");
        const { error } = await sb.from("posts").update({ content: t }).eq("id", id).eq("author_id", me.id);
        if (error) throw new Error(LUMI.friendlyDb(error));
        p.content = t; p.updated_at = new Date().toISOString();
        const el = $(`article[data-post="${CSS.escape(id)}"]`); if (el) el.outerHTML = postHtml(p);
        LUMI.toast("Publicação atualizada.");
      },
    });
  }
  function deletePost(id) {
    LUMI.dialog({
      title: "Excluir publicação", confirm: "Excluir", danger: true,
      body: '<p style="margin:0;line-height:1.5">A publicação some do feed, dos perfis e das comunidades. Comentários nela também deixam de aparecer.</p>',
      onSubmit: async () => {
        const { error } = await sb.from("posts").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("author_id", me.id);
        if (error) throw new Error(LUMI.friendlyDb(error));
        $(`article[data-post="${CSS.escape(id)}"]`)?.remove();
        posts = posts.filter((x) => x.post_id !== id);
        LUMI.toast("Publicação excluída.");
      },
    });
  }

  function closeMenus(except) { $$(".l3-menu-list").forEach((m) => { if (m !== except) { m.hidden = true; m.previousElementSibling?.setAttribute("aria-expanded", "false"); } }); }

  function bindFeed() {
    document.addEventListener("click", (e) => { if (!e.target.closest(".l3-menu")) closeMenus(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });
    $("#feedMore").addEventListener("click", () => renderFeed(true));
    $("#generalFeed").addEventListener("click", async (e) => {
      const t = (sel) => e.target.closest(sel);
      if (t("[data-menu]")) { const list = t("[data-menu]").nextElementSibling; closeMenus(list); list.hidden = !list.hidden; t("[data-menu]").setAttribute("aria-expanded", String(!list.hidden)); if (!list.hidden) list.querySelector("button")?.focus(); return; }
      if (t("[role=menuitem]")) closeMenus();
      if (t("[data-tag]")) { e.preventDefault(); setTag(t("[data-tag]").dataset.tag); return; }
      if (t("[data-save]")) return me ? toggleSave(t("[data-save]").dataset.save) : LUMI.toast("Entre para salvar.");
      if (t("[data-edit]")) return editPost(t("[data-edit]").dataset.edit);
      if (t("[data-del]")) return deletePost(t("[data-del]").dataset.del);
      if (t("[data-report]")) return LUMI.report(t("[data-report]").dataset.report, t("[data-report]").dataset.id);
      if (t("[data-block]")) return LUMI.block(t("[data-block]").dataset.block, t("[data-block]").dataset.name, () => renderFeed());
      if (t("[data-cdel]")) {
        const b = t("[data-cdel]");
        if (!confirm("Apagar este comentário?")) return;
        const { error } = await sb.from("comments").update({ deleted_at: new Date().toISOString() }).eq("id", b.dataset.cdel).eq("author_id", me.id);
        if (error) return LUMI.toast("Não foi possível apagar.");
        return loadComments(b.dataset.post);
      }
      const like = t("[data-like]");
      if (like) {
        if (!me) return LUMI.toast("Entre na sua conta para curtir.");
        const id = like.dataset.like, on = myLikes.has(id), num = like.querySelector("span");
        like.disabled = true;
        try {
          if (on) {
            const { error } = await sb.from("post_reactions").delete().eq("post_id", id).eq("user_id", me.id).eq("reaction", "like");
            if (error) throw error;
            myLikes.delete(id); num.textContent = Math.max(0, +num.textContent - 1);
          } else {
            const { error } = await sb.from("post_reactions").insert({ post_id: id, user_id: me.id, reaction: "like" });
            if (error && error.code !== "23505") throw error;
            myLikes.add(id); num.textContent = +num.textContent + 1;
          }
          const now = myLikes.has(id);
          like.classList.toggle("is-on", now); like.setAttribute("aria-pressed", String(now));
        } catch (err) { LUMI.toast("Não foi possível reagir agora."); }
        finally { like.disabled = false; }
        return;
      }
      const cm = t("[data-comment]");
      if (cm) {
        const box = document.getElementById(`comments-${cm.dataset.comment}`);
        const open = !box.hidden;
        cm.setAttribute("aria-expanded", String(!open));
        if (open) box.hidden = true; else await loadComments(cm.dataset.comment);
        return;
      }
      const reply = t("[data-reply]");
      if (reply) {
        LUMI.dialog({ title: "Responder comentário", confirm: "Responder", body: '<div class="l3-field"><label for="rpTxt">Sua resposta</label><textarea id="rpTxt" name="t" rows="3" maxlength="5000"></textarea></div>',
          onSubmit: async (f) => { const v = f.t.value.trim(); if (!v) throw new Error("Escreva algo."); try { await sendComment(reply.dataset.post, v, reply.dataset.reply); } catch (x) { throw new Error(LUMI.friendlyDb(x)); } } });
        return;
      }
      const share = t("[data-share]");
      if (share) {
        const url = new URL(location.href); url.search = "?post=" + encodeURIComponent(share.dataset.share); url.hash = "";
        try { await navigator.clipboard.writeText(url.toString()); LUMI.toast("Link copiado."); } catch { prompt("Copie o link:", url.toString()); }
      }
    });
    $("#generalFeed").addEventListener("submit", async (e) => {
      const f = e.target.closest("[data-cform]");
      if (!f) return;
      e.preventDefault();
      const btn = $("button", f), input = f.elements.comment, text = input.value.trim();
      if (!text) return;
      btn.disabled = true;
      try { await sendComment(f.dataset.cform, text, null); LUMI.toast("Comentário publicado."); }
      catch (err) { LUMI.toast("Não foi possível comentar: " + LUMI.friendlyDb(err)); btn.disabled = false; }
    });
    document.addEventListener("click", (e) => { if (e.target.id === "clearTag") setTag(null); });
  }

  function setTag(t) { activeTag = t; renderFeed(); $("#generalFeed").scrollIntoView({ behavior: "smooth", block: "start" }); }

  function bindCompose() {
    const form = $("#generalCompose"), media = $("#generalMedia");
    media?.addEventListener("change", () => { $("#generalMediaName").textContent = media.files?.[0]?.name || ""; });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!me) return LUMI.toast("Entre na sua conta para publicar.");
      const text = $("#generalText").value.trim(), file = media?.files?.[0];
      if (!text && !file) return LUMI.toast("Escreva algo ou escolha uma imagem.");
      const btn = $("[type=submit]", form);
      btn.disabled = true;
      try {
        const media_urls = file ? [await upload(file, "feed")] : [];
        const { error } = await sb.from("posts").insert({
          author_id: me.id, content: text || (file.type.startsWith("video/") ? "Compartilhou um vídeo." : "Compartilhou uma foto."),
          post_type: "text", visibility: "public", media_urls,
        });
        if (error) throw error;
        form.reset(); $("#generalMediaName").textContent = "";
        LUMI.toast("Publicação enviada.");
        sort = sort === "popular" ? "recent" : sort;
        await Promise.all([renderFeed(), renderTrends()]);
      } catch (err) { LUMI.toast("Não foi possível publicar: " + LUMI.friendlyDb(err)); }
      finally { btn.disabled = false; }
    });
    $$("[data-sort]").forEach((b) => b.addEventListener("click", () => {
      sort = b.dataset.sort;
      $$("[data-sort]").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      renderFeed();
    }));
    $("#feedSearch")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); const q = e.target.value.trim(); if (q) location.href = "explorar.html?q=" + encodeURIComponent(q); }
    });
  }

  // ---------------- assuntos do momento ----------------
  async function renderTrends() {
    const host = $("#trendsList");
    const { data, error } = await sb.rpc("luminova_trending", { window_days: 7, result_limit: 8 });
    if (error) { host.innerHTML = `<p class="ln-muted g-pad">Não foi possível calcular os assuntos agora.</p>`; return; }
    if (!data?.length) { host.innerHTML = '<p class="ln-muted g-pad">Ainda não há hashtags suficientes nos últimos 7 dias. Use #hashtags nas suas publicações.</p>'; return; }
    host.innerHTML = data.map((t, i) => `<button type="button" class="g-trend" data-trend="${esc(t.tag)}"><span class="g-trend-n">${i + 1}</span><span class="g-trend-t">#${esc(t.tag)}</span><span class="ln-muted">${t.post_count} pub. · ${t.interaction_count} interações</span></button>`).join("");
    $$("[data-trend]", host).forEach((b) => b.addEventListener("click", () => setTag(b.dataset.trend)));
  }

  // ---------------- recomendações ----------------
  async function renderReco() {
    if (!me) return;
    const [people, comms] = await Promise.all([
      sb.rpc("luminova_recommend_people", { result_limit: 4, include_ai: false }),
      sb.rpc("luminova_recommend_communities", { result_limit: 3 }),
    ]);
    if (people.error && comms.error) return;
    const pp = people.data || [], cc = comms.data || [];
    if (!pp.length && !cc.length) return;
    $("#recoPanel").hidden = false;
    $("#recoPeople").innerHTML = pp.map((p) => `<a class="g-reco" href="perfil-publico.html?id=${encodeURIComponent(p.user_id)}">${LUMI.avatar(p, "g-reco-av", 34)}<span><strong>${esc(p.display_name)}</strong><small>${p.shared_interests?.length ? "Curte " + esc(p.shared_interests.slice(0, 2).join(", ")) : p.mutuals ? `${p.mutuals} conexão(ões) em comum` : ""}</small></span></a>`).join("");
    $("#recoComms").innerHTML = cc.map((c) => `<a class="g-reco" href="comunidade-detalhe.html?id=${encodeURIComponent(c.community_id)}"><span class="g-reco-av g-reco-c" aria-hidden="true">◈</span><span><strong>${esc(c.name)}</strong><small>${esc(c.reason)} · ${c.members} membro${c.members == 1 ? "" : "s"}</small></span></a>`).join("");
  }

  // ---------------- tópico do dia ----------------
  let currentTopic = null;
  async function renderTopic() {
    const host = $("#topicCard");
    const { data, error } = await sb.rpc("luminova_current_topic");
    if (error) { host.innerHTML = `<p class="ln-muted">Não foi possível carregar o tópico.</p>`; return; }
    currentTopic = data?.[0] || null;
    const admin = LUMI.isAdmin ? `<div class="g-topic-admin"><button type="button" class="ln-btn ghost" id="editTopic">${currentTopic ? "Alterar tópico" : "Definir tópico"}</button>${currentTopic ? '<button type="button" class="ln-btn ghost" id="endTopic">Encerrar</button>' : ""}</div>` : "";
    if (!currentTopic) host.innerHTML = `<p class="ln-muted">Nenhum tópico configurado para hoje.</p>${admin}`;
    else {
      const until = currentTopic.ends_at ? `<small class="ln-muted">Até ${esc(LUMI.time(currentTopic.ends_at))}</small>` : "";
      host.innerHTML = `<h4 class="g-topic-title">${esc(currentTopic.title)}</h4><p class="g-topic-desc">${esc(currentTopic.description || "")}</p>${until}
        <div class="g-topic-actions">${currentTopic.hashtag ? `<button type="button" class="ln-btn" id="topicSee">Ver publicações</button>` : ""}${me ? '<button type="button" class="ln-btn ghost" id="topicJoin">Participar</button>' : ""}</div>${admin}`;
    }
    $("#topicSee")?.addEventListener("click", () => setTag(currentTopic.hashtag.replace(/^#/, "").toLowerCase()));
    $("#topicJoin")?.addEventListener("click", () => {
      const t = $("#generalText");
      t.value = (t.value ? t.value + " " : "") + (currentTopic.hashtag ? "#" + currentTopic.hashtag.replace(/^#/, "") + " " : "");
      t.focus(); t.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    $("#editTopic")?.addEventListener("click", openTopicModal);
    $("#endTopic")?.addEventListener("click", async () => {
      const { error: er } = await sb.from("daily_topics").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", currentTopic.id);
      if (er) return LUMI.toast("Não foi possível encerrar.");
      LUMI.toast("Tópico encerrado."); renderTopic();
    });
  }
  const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  function openTopicModal() {
    const m = $("#topicModal"), f = $("#topicForm");
    f.elements.title.value = currentTopic?.title || "";
    f.elements.description.value = currentTopic?.description || "";
    f.elements.hashtag.value = currentTopic?.hashtag || "";
    f.elements.starts.value = toLocalInput(currentTopic?.starts_at) || toLocalInput(new Date().toISOString());
    f.elements.ends.value = toLocalInput(currentTopic?.ends_at) || toLocalInput(new Date(Date.now() + 864e5).toISOString());
    m.classList.add("open"); f.elements.title.focus();
  }
  function bindTopicModal() {
    const m = $("#topicModal"), f = $("#topicForm");
    $$("[data-close]", m).forEach((b) => b.addEventListener("click", () => m.classList.remove("open")));
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!LUMI.isAdmin) return LUMI.toast("Somente a administração pode definir o tópico.");
      const starts = new Date(f.elements.starts.value), ends = new Date(f.elements.ends.value);
      if (isNaN(starts) || isNaN(ends) || ends <= starts) return LUMI.toast("O término precisa ser depois do início.");
      const tag = f.elements.hashtag.value.trim().replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "");
      const topic_date = new Date(starts.getTime() - starts.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
      const row = { title: f.elements.title.value.trim(), description: f.elements.description.value.trim(), hashtag: tag || null,
        starts_at: starts.toISOString(), ends_at: ends.toISOString(), topic_date, is_active: true, created_by: me.id, updated_at: new Date().toISOString() };
      const { error } = await sb.from("daily_topics").upsert(row, { onConflict: "topic_date" });
      if (error) return LUMI.toast("Não foi possível salvar o tópico.");
      m.classList.remove("open"); LUMI.toast("Tópico salvo."); renderTopic();
    });
  }

  async function init() {
    await LUMI.ready;
    sb = LUMI.sb; me = LUMI.user;
    if (!sb) { $("#generalFeed").innerHTML = '<div class="l3-alert err">Não foi possível conectar ao servidor.</div>'; return; }
    if (savedMode && !(await LUMI.requireLogin())) return;
    if (me) {
      const { data } = await sb.from("user_preferences").select("personalization").eq("user_id", me.id).maybeSingle();
      if (!data || data.personalization !== false) { const fy = $('[data-sort="foryou"]'); fy.hidden = false; }
    }
    bindCompose();
    const ca = $("#composeAvatar"); if (ca && me) ca.innerHTML = LUMI.avatar(LUMI.profile || { display_name: me.email }, "ln-avatar-img", 44);
    if (!me || savedMode) $("#generalCompose").hidden = true;
    if (!me) $("#guestNote").hidden = false;
    if (savedMode) document.querySelector(".tw-head h1").textContent = "Salvos";
    bindFeed(); bindTopicModal();
    await Promise.all([renderFeed(), renderTrends(), renderTopic(), renderReco()]);
  }
  document.addEventListener("DOMContentLoaded", () => init().catch((e) => { console.error(e); $("#generalFeed").innerHTML = '<div class="l3-alert err">Erro ao carregar o feed. Recarregue a página.</div>'; }));
})();
