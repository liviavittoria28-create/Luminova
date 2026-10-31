(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  let sb,
    user,
    profile,
    communities = [],
    activeCommunity = null,
    feedSort = "recent",
    activeChatChannel = null;
  function toast(msg) {
    let el = $("#socialToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "socialToast";
      el.className = "ln-toast";
      el.setAttribute("role", "status");
      document.body.append(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3600);
  }
  async function initClient() {
    const c = window.LUMINOVA_SUPABASE_CONFIG;
    if (!c?.url || !c?.anonKey || !window.supabase?.createClient)
      throw Error("Configuração Supabase ausente.");
    sb =
      window.luminovaSupabase ||
      window.supabase.createClient(c.url, c.anonKey, {
        auth: {
          storage: window.sessionStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    window.luminovaSupabase = sb;
    const { data, error } = await sb.auth.getUser();
    if (error) throw error;
    user = data.user;
    if (user) {
      const r = await sb
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (!r.error) profile = r.data;
    }
  }
  function currentName() {
    return (
      profile?.display_name ||
      user?.user_metadata?.display_name ||
      user?.email?.split("@")[0] ||
      "Pessoa da LUMINOVA"
    );
  }
  function needAuth() {
    if (!user) {
      toast("Entre na sua conta para continuar.");
      setTimeout(() => (location.href = "index.html"), 900);
      return false;
    }
    return true;
  }
  function constructionLinks() {
    $$("[data-construction]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        toast(`${a.dataset.construction}: área em construção.`);
      }),
    );
  }
  function navMobile() {
    const sidebar = $(".sidebar");
    if (!sidebar || $("#mobileNavToggle")) return;
    const b = document.createElement("button");
    b.id = "mobileNavToggle";
    b.className = "ln-mobile-toggle";
    b.type = "button";
    b.textContent = "☰ Menu";
    b.setAttribute("aria-expanded", "false");
    const top = $(".ln-top,.topbar");
    top?.prepend(b);
    b.addEventListener("click", () => {
      const open = sidebar.classList.toggle("ln-sidebar-open");
      b.setAttribute("aria-expanded", String(open));
      b.textContent = open ? "× Fechar" : "☰ Menu";
    });
    document.addEventListener("click", (e) => {
      if (
        innerWidth <= 820 &&
        !sidebar.contains(e.target) &&
        !b.contains(e.target)
      )
        sidebar.classList.remove("ln-sidebar-open");
    });
  }
  function applyMiniProfile() {
    if (!profile) return;
    $$("#sideName").forEach((e) => (e.textContent = currentName()));
    if (profile.avatar_url)
      $$("#sideAvatar").forEach((e) => (e.src = profile.avatar_url));
    const theme = profile.profile_settings?.theme;
    if (theme === "light") document.body.classList.add("light-mode");
    else if (theme === "dark") document.body.classList.remove("light-mode");
    const b = $("#lnThemeToggle");
    if (b && !b.dataset.dbBound) {
      b.dataset.dbBound = "1";
      b.addEventListener("click", async () => {
        const next = document.body.classList.contains("light-mode")
          ? "light"
          : "dark";
        try {
          const patch = { ...(profile.profile_settings || {}), theme: next };
          const { data, error } = await sb
            .from("profiles")
            .update({ profile_settings: patch })
            .eq("id", user.id)
            .select("*")
            .single();
          if (error) throw error;
          profile = data;
        } catch (e) {
          toast("Não foi possível salvar o tema: " + e.message);
        }
      });
    }
  }
  async function listCommunities() {
    const { data, error } = await sb
      .from("communities")
      .select(
        "id,owner_id,name,slug,description,category_id,avatar_url,cover_url,visibility,join_policy,rules,created_at",
      )
      .eq("visibility", "public")
      .order("created_at", { ascending: false });
    if (error) throw error;
    communities = data || [];
  }
  function communityCard(c) {
    const cover = c.cover_url
      ? `background-image:linear-gradient(0deg,rgba(5,8,18,.72),rgba(5,8,18,.04)),url('${esc(c.cover_url)}')`
      : "";
    return `<article class="ln-community-card ln-real-card" tabindex="0" data-community="${esc(c.id)}"><div class="ln-card-art" style="${cover}"><span class="ln-card-symbol">${c.avatar_url ? `<img src="${esc(c.avatar_url)}" alt="" loading="lazy">` : "✦"}</span><span class="ln-card-tag">LUMINOVA / ESPAÇO</span></div><div class="ln-card-body"><div class="ln-card-title"><h3>${esc(c.name)}</h3></div><p>${esc(c.description || "Um espaço para aprender e compartilhar.")}</p><div class="ln-card-foot"><span>◈ Comunidade</span><strong>Conhecer espaço ↗</strong></div></div></article>`;
  }
  function renderCommunityList() {
    const grid = $("#communityGrid");
    if (!grid) return;
    const q = (
      $("#communitySearch")?.value ||
      new URLSearchParams(location.search).get("q") ||
      ""
    ).toLowerCase();
    const list = communities.filter((c) =>
      `${c.name} ${c.description}`.toLowerCase().includes(q),
    );
    grid.innerHTML = list.length
      ? list.map(communityCard).join("")
      : '<div class="ln-panel ln-empty">Ainda não há comunidades públicas com esse nome. Você pode criar a primeira.</div>';
    const count = $("#communityCount");
    if (count)
      count.textContent = `${list.length} ${list.length === 1 ? "comunidade" : "comunidades"}`;
    $$("[data-community]", grid).forEach((el) => {
      const go = () =>
        (location.href = `comunidade-detalhe.html?id=${encodeURIComponent(el.dataset.community)}`);
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    });
  }
  async function upload(file, bucket, path) {
    if (!file) throw Error("Escolha um arquivo.");
    if (file.size > 100 * 1024 * 1024)
      throw Error("O arquivo deve ter até 100 MB.");
    const safe = file.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `${path}/${Date.now()}-${safe}`;
    const { error } = await sb.storage.from(bucket).upload(key, file, {
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });
    if (error) throw error;
    const { data } = sb.storage.from(bucket).getPublicUrl(key);
    return data.publicUrl;
  }
  function createCommunityModal() {
    const modal = $("#createModal"),
      form = $("#createForm");
    if (!modal || !form) return;
    $("#createCommunity")?.addEventListener("click", () =>
      modal.classList.add("open"),
    );
    $$("[data-close]", modal).forEach((b) =>
      b.addEventListener("click", () => modal.classList.remove("open")),
    );
    $("#newPrivacy")?.closest(".ln-field")?.remove();
    $("#newPasswordWrap")?.remove();
    const file = document.createElement("div");
    file.className = "ln-field";
    file.innerHTML =
      '<label for="newCover">Imagem de capa (opcional)</label><input class="ln-input" id="newCover" type="file" accept="image/*"><label for="newAvatar">Imagem do espaço (opcional)</label><input class="ln-input" id="newAvatar" type="file" accept="image/*">';
    form.querySelector(".ln-modal-actions")?.before(file);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!needAuth()) return;
      const submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      try {
        const { count: joinedCount, error: countError } = await sb
          .from("community_members")
          .select("community_id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "active");
        if (countError) throw countError;
        if ((joinedCount || 0) >= 4)
          throw Error(
            "Você já participa de 4 comunidades. Saia de uma delas antes de criar outra.",
          );
        const name = $("#newName").value.trim(),
          description = $("#newDesc").value.trim();
        if (name.length < 3)
          throw Error("O nome precisa ter pelo menos 3 caracteres.");
        const slug =
          name
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") +
          "-" +
          crypto.randomUUID().slice(0, 6);
        let cover_url = null,
          avatar_url = null;
        const coverFile = $("#newCover")?.files?.[0],
          avatarFile = $("#newAvatar")?.files?.[0];
        if (coverFile)
          cover_url = await upload(coverFile, "community-media", user.id);
        if (avatarFile)
          avatar_url = await upload(avatarFile, "community-media", user.id);
        const { data, error } = await sb
          .from("communities")
          .insert({
            owner_id: user.id,
            name,
            slug,
            description,
            visibility: "public",
            join_policy: "open",
            cover_url,
            avatar_url,
            settings: {
              theme: $("#newTheme")?.value || "purple",
              accent: $("#newColor")?.value || "#8b5cf6",
            },
          })
          .select()
          .single();
        if (error) throw error;
        await sb.from("community_members").upsert({
          community_id: data.id,
          user_id: user.id,
          role: "owner",
          status: "active",
        });
        modal.classList.remove("open");
        form.reset();
        await listCommunities();
        renderCommunityList();
        toast("Comunidade criada!");
      } catch (err) {
        console.error(err);
        toast(
          err.message ||
            "Não foi possível criar a comunidade. Confira as políticas do Supabase.",
        );
      } finally {
        submit.disabled = false;
      }
    });
  }
  async function initList() {
    if (!$("#communityGrid")) return;
    createCommunityModal();
    $("#communitySearch")?.addEventListener("input", renderCommunityList);
    try {
      await listCommunities();
      renderCommunityList();
    } catch (e) {
      console.error(e);
      $("#communityGrid").innerHTML =
        `<div class="ln-panel ln-empty">Não foi possível carregar as comunidades. ${esc(e.message || "Verifique a conexão e as permissões do Supabase.")}<br><small>Se o erro mencionar RLS ou permission denied, execute o arquivo <b>fix-comunidades-rls.sql</b> no SQL Editor do Supabase.</small></div>`;
    }
  }
  async function initFeed() {
    const holder = $("#generalFeed");
    if (!holder) return;
    const compose = $("#generalCompose");
    if (compose && !$("#generalMedia")) {
      const media = document.createElement("label");
      media.className = "ln-media-pick";
      media.innerHTML =
        '＋ Foto ou vídeo <input id="generalMedia" type="file" accept="image/*,video/mp4,video/webm" hidden>';
      compose.querySelector(".ln-compose-row")?.prepend(media);
    }
    compose?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!needAuth()) return;
      const text = $("#generalText")?.value.trim();
      const mediaFile = $("#generalMedia")?.files?.[0];
      if (!text && !mediaFile) return;
      const btn = compose.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        let media_urls = [];
        if (mediaFile)
          media_urls = [
            await upload(mediaFile, "community-media", `${user.id}/feed`),
          ];
        const { error } = await sb.from("posts").insert({
          author_id: user.id,
          content: text || "Compartilhou uma mídia.",
          post_type: mediaFile
            ? mediaFile.type.startsWith("video/")
              ? "discovery"
              : "text"
            : "text",
          visibility: "public",
          media_urls,
        });
        if (error) throw error;
        $("#generalText").value = "";
        if ($("#generalMedia")) $("#generalMedia").value = "";
        await renderFeed();
        toast("Publicação enviada.");
      } catch (err) {
        toast(
          "Não foi possível publicar: " +
            (err.message || "verifique o banco e as permissões."),
        );
      } finally {
        btn.disabled = false;
      }
    });
    $("#feedSearch")?.addEventListener("input", renderFeed);
    $$("[data-sort]").forEach((b) =>
      b.addEventListener("click", () => {
        feedSort = b.dataset.sort;
        $$("[data-sort]").forEach((x) => x.classList.toggle("active", x === b));
        renderFeed();
      }),
    );
    await renderFeed();
  }
  async function renderFeed() {
    const holder = $("#generalFeed");
    if (!holder) return;
    try {
      let q = sb
        .from("v_feed_posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      const { data, error } = await q;
      if (error) throw error;
      let posts = data || [];
      if (feedSort === "popular")
        posts.sort((a, b) => (b.reaction_count || 0) - (a.reaction_count || 0));
      const search = ($("#feedSearch")?.value || "").trim().toLowerCase();
      if (search)
        posts = posts.filter((p) =>
          `${p.content} ${p.display_name} ${p.username}`
            .toLowerCase()
            .includes(search),
        );
      holder.innerHTML = posts.length
        ? posts
            .map(
              (p) =>
                `<article class="ln-post" data-post="${esc(p.post_id)}"><div class="ln-post-head"><img class="ln-avatar-img" src="${esc(p.avatar_url || "")}" alt="" onerror="this.style.display='none'"><div><div class="ln-author">${esc(p.display_name || p.username || "Pessoa")}</div><div class="ln-handle">${esc(p.username ? "@" + p.username : "")} · ${new Date(p.created_at).toLocaleString("pt-BR")}</div></div></div><p>${esc(p.content).replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, '$1<span class="ln-hashtag">#$2</span>')}</p>${(p.media_urls || []).map((u) => (/\.(mp4|webm)(\?|$)/i.test(u) ? `<video controls playsinline preload="metadata" src="${esc(u)}" style="max-width:100%;border-radius:12px"></video>` : `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Imagem da publicação" loading="lazy" style="max-width:100%;max-height:480px;object-fit:contain;border-radius:12px"></a>`)).join(" ")}<div class="ln-post-actions"><button class="ln-action" data-react="${esc(p.post_id)}">♡ ${p.reaction_count || 0} reações</button><button class="ln-action" data-comment="${esc(p.post_id)}">◷ ${p.comment_count || 0} comentários</button><button class="ln-action" data-share="${esc(p.post_id)}">↗ Compartilhar</button></div><div class="ln-comments" id="comments-${esc(p.post_id)}" hidden data-open="false"></div></article>`,
            )
            .join("")
        : '<div class="ln-empty">Ainda não há publicações. Seja a primeira pessoa a compartilhar algo.</div>';
      $$("[data-react]", holder).forEach((b) =>
        b.addEventListener("click", async () => {
          if (!needAuth()) return;
          try {
            const { error } = await sb.from("post_reactions").insert({
              post_id: b.dataset.react,
              user_id: user.id,
              reaction: "like",
            });
            if (error && error.code !== "23505") throw error;
            await renderFeed();
          } catch (e) {
            toast("Não foi possível reagir: " + e.message);
          }
        }),
      );
      $$('[data-comment]', holder).forEach((b) =>
        b.addEventListener('click', async () => {
          const postId = b.dataset.comment;
          const target = $(`#comments-${CSS.escape(postId)}`);
          if (!target) return;
          const isOpen = target.dataset.open === 'true';
          if (isOpen) {
            target.hidden = true;
            target.dataset.open = 'false';
            return;
          }
          target.hidden = false;
          target.dataset.open = 'true';
          await loadComments(postId);
        }),
      );
      $$("[data-share]", holder).forEach((b) =>
        b.addEventListener("click", async () => {
          const url = new URL(location.href);
          url.hash = "post-" + b.dataset.share;
          try {
            await navigator.clipboard.writeText(url.toString());
            toast("Link copiado.");
          } catch {
            prompt("Copie o link:", url.toString());
          }
        }),
      );
    } catch (e) {
      console.error(e);
      holder.innerHTML =
        '<div class="ln-empty">Não foi possível carregar o feed. Confirme se executou o SQL de migração.</div>';
    }
  }
  async function loadComments(postId) {
    const target = $(`#comments-${CSS.escape(postId)}`);
    if (!target) return;
    target.hidden = false;
    target.innerHTML = '<p class="ln-muted">Carregando comentários…</p>';
    try {
      const { data, error } = await sb
        .from('comments')
        .select('id,content,created_at,author_id,parent_comment_id')
        .eq('post_id', postId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const comments = data || [];
      const authorIds = [...new Set(comments.map((c) => c.author_id).filter(Boolean))];
      let profilesById = {};
      if (authorIds.length) {
        const { data: authors, error: profileError } = await sb
          .from('profiles')
          .select('id,username,display_name,avatar_url')
          .in('id', authorIds);
        if (!profileError) profilesById = Object.fromEntries((authors || []).map((a) => [a.id, a]));
      }
      const commentMarkup = comments.map((c) => {
        const author = profilesById[c.author_id] || {};
        const authorName = c.author_id === user?.id ? 'Você' : (author.display_name || (author.username ? '@' + author.username : 'Membro'));
        const avatar = author.avatar_url
          ? `<img class="ln-avatar-img" src="${esc(author.avatar_url)}" alt="" loading="lazy">`
          : '<span class="ln-avatar-fallback">✦</span>';
        return `<div class="ln-comment" data-comment-id="${esc(c.id)}"><div class="ln-post-head">${avatar}<div><strong>${esc(authorName)}</strong><div class="ln-handle">${new Date(c.created_at).toLocaleString('pt-BR')}</div></div></div><p>${esc(c.content)}</p></div>`;
      }).join('');
      target.innerHTML = `${commentMarkup || '<p class="ln-muted">Ainda sem comentários. Comece a conversa.</p>'}${user ? `<form class="ln-inline-reply" data-comment-form="${esc(postId)}"><input class="ln-input" name="comment" maxlength="5000" placeholder="Escreva um comentário…" required aria-label="Escreva um comentário"><button class="ln-btn" type="submit">Enviar</button></form>` : '<p class="ln-muted">Entre na sua conta para comentar.</p>'}`;
      const form = $('[data-comment-form]', target);
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!needAuth()) return;
        const input = form.elements.comment;
        const content = input.value.trim();
        if (!content) return;
        const submit = $('button[type="submit"]', form);
        submit.disabled = true;
        try {
          const { error: insertError } = await sb.from('comments').insert({ post_id: postId, author_id: user.id, content });
          if (insertError) throw insertError;
          toast('Comentário publicado.');
          await loadComments(postId);
          const countButton = $(`[data-comment="${CSS.escape(postId)}"]`);
          if (countButton) {
            const current = Number((countButton.textContent.match(/\d+/) || ['0'])[0]);
            countButton.textContent = `◷ ${current + 1} comentários`;
          }
        } catch (error) {
          toast('Não foi possível publicar o comentário: ' + (error.message || 'erro de banco/permissão'));
          submit.disabled = false;
        }
      });
    } catch (error) {
      console.error('Falha ao carregar comentários', error);
      target.innerHTML = `<p class="ln-muted">Não foi possível carregar os comentários. ${esc(error.message || '')}</p>`;
    }
  }
  async function initDetail() {
    const root = $("#detailRoot");
    if (!root) return;
    let detailStage = "validando o endereço da comunidade";
    const id = new URLSearchParams(location.search).get("id");
    if (!id) {
      root.innerHTML =
        '<div class="ln-empty">Escolha uma comunidade. <a href="comunidades.html">Voltar</a></div>';
      return;
    }
    try {
      detailStage = "buscando a comunidade no banco";
      const { data: c, error } = await sb
        .from("communities")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      activeCommunity = c;
      detailStage = "verificando sua participação";
      const { data: member, error: memberError } = user
        ? await sb
            .from("community_members")
            .select("role,status")
            .eq("community_id", id)
            .eq("user_id", user.id)
            .maybeSingle()
        : { data: null, error: null };
      if (memberError) throw memberError;
      const isOwner = c.owner_id === user?.id,
        role = member?.role || "",
        canManage =
          isOwner ||
          role === "owner" ||
          role === "moderator" ||
          profile?.role === "admin",
        isMember = member?.status === "active";
      let settings = c.settings || {};
      root.innerHTML = `<section class="ln-community-hero ln-community-hero-modern"><div class="ln-community-banner ln-community-banner-modern" style="--community-accent:${esc(settings.accent || "#8b5cf6")};${c.cover_url ? `background-image:linear-gradient(0deg,rgba(5,8,18,.82),rgba(5,8,18,.08)),url('${esc(c.cover_url)}');background-size:cover;background-position:center` : ""}"><span class="ln-kicker">LUMINOVA / COMUNIDADE</span><div class="ln-cover-title"><div class="ln-cover-avatar">${c.avatar_url ? `<img src="${esc(c.avatar_url)}" alt="Ícone de ${esc(c.name)}">` : "✦"}</div><div><h1>${esc(c.name)}</h1><p>${esc(c.description || "Um espaço para compartilhar o que você ama.")}</p></div></div><div class="ln-cover-bottom"><span>✦ ${esc(c.visibility === "public" ? "Comunidade pública" : "Comunidade privada")}</span><span>Conecte-se por interesses em comum</span></div></div><div class="ln-community-meta"><span class="ln-muted">${isMember ? "Você faz parte desta comunidade" : "Conheça as conversas e pessoas deste espaço"}</span><button class="ln-btn" id="joinCommunity">${isMember ? "✓ Você participa" : "＋ Participar"}</button></div></section><nav class="ln-community-tabs ln-community-tabs-modern"><button class="ln-chip active" data-section="feed">✦ Conversas</button><button class="ln-chip" data-section="chat">◉ Chat geral</button><button class="ln-chip" data-section="subcommunities">▦ Subcomunidades</button><button class="ln-chip" data-section="materials">▤ Materiais</button>${canManage ? '<button class="ln-chip" data-section="settings">⚙ Personalizar</button>' : ""}</nav><section id="communitySection" class="ln-panel ln-community-content" style="margin-top:18px"></section>`;
      const section = $("#communitySection");
      const mediaMarkup = (urls) =>
        (urls || [])
          .map((u) =>
            /\.(mp4|webm|mov)(\?|$)/i.test(u)
              ? `<video controls playsinline preload="metadata" src="${esc(u)}" class="ln-community-media"></video>`
              : `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Mídia da publicação" loading="lazy" class="ln-community-media"></a>`,
          )
          .join("");
      const renderPosts = async () => {
        detailStage = "carregando conversas/publicações";
        const { data, error } = await sb
          .from("community_posts")
          .select(
            "id,post_id,created_at,posts(id,content,post_type,media_urls,created_at,author_id,author:profiles!posts_author_id_fkey(display_name,username,avatar_url))",
          )
          .eq("community_id", id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        section.innerHTML = `<div class="ln-section-heading"><div><span class="ln-kicker">O QUE ESTÁ ACONTECENDO</span><h2>Conversas da comunidade</h2><p class="ln-muted">Compartilhe novidades, fotos, vídeos e responda às outras pessoas.</p></div><span class="ln-live-pill">● Espaço social</span></div>${isMember ? `<form id="communityCompose" class="ln-compose ln-social-compose"><textarea id="communityText" maxlength="10000" placeholder="O que você quer compartilhar com a comunidade?" aria-label="Texto da publicação"></textarea><div class="ln-compose-tools"><label class="ln-media-pick">＋ Foto ou vídeo<input id="communityMedia" type="file" accept="image/*,video/mp4,video/webm,video/quicktime" hidden></label><span id="communityMediaName" class="ln-muted">Até 100 MB</span><button class="ln-btn" type="submit">Publicar ↗</button></div></form>` : '<p class="ln-muted">Entre na comunidade para publicar, enviar fotos e vídeos e responder às conversas.</p>'}<div id="communityPosts" class="ln-community-post-list">${
          (data || []).filter((x) => x.posts).length
            ? (data || [])
                .filter((x) => x.posts)
                .map((x) => {
                  const p = x.posts;
                  return `<article class="ln-post ln-community-post" data-community-post="${esc(p.id)}"><div class="ln-post-head">${p.author?.avatar_url ? `<img class="ln-avatar-img" src="${esc(p.author.avatar_url)}" alt="">` : '<span class="ln-avatar-fallback">✦</span>'}<div><div class="ln-author">${esc(p.author?.display_name || p.author?.username || "Membro da comunidade")}</div><div class="ln-handle">${new Date(p.created_at || x.created_at).toLocaleString("pt-BR")}</div></div></div><p class="ln-community-post-text">${esc(p.content || "")}</p>${mediaMarkup(p.media_urls)}<div class="ln-post-actions"><button class="ln-action" data-comments="${esc(p.id)}">↩ Responder / comentários</button><span class="ln-muted">Conversa da comunidade</span></div><div class="ln-comments" id="community-comments-${esc(p.id)}"></div></article>`;
                })
                .join("")
            : '<div class="ln-empty ln-empty-social"><span>✦</span><h3>Comece a conversa</h3><p>Esta comunidade ainda não tem publicações. Compartilhe a primeira ideia, foto ou vídeo.</p></div>'
        }</div>`;
        const form = $("#communityCompose");
        form?.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (!needAuth()) return;
          const text = $("#communityText").value.trim(),
            file = $("#communityMedia")?.files?.[0];
          if (!text && !file) {
            toast("Escreva algo ou escolha uma foto/vídeo.");
            return;
          }
          const btn = form.querySelector("[type=submit]");
          btn.disabled = true;
          try {
            let media_urls = [];
            if (file)
              media_urls = [
                await upload(file, "community-media", `${user.id}/${id}/posts`),
              ];
            const { data: p, error: pe } = await sb
              .from("posts")
              .insert({
                author_id: user.id,
                content:
                  text ||
                  (file?.type.startsWith("video/")
                    ? "Compartilhou um vídeo."
                    : "Compartilhou uma foto."),
                post_type: file?.type.startsWith("video/")
                  ? "discovery"
                  : "text",
                visibility: "public",
                media_urls,
              })
              .select("id")
              .single();
            if (pe) throw pe;
            const { error: ce } = await sb
              .from("community_posts")
              .insert({ community_id: id, post_id: p.id });
            if (ce) throw ce;
            toast("Publicado na comunidade!");
            await renderPosts();
          } catch (e) {
            console.error(e);
            toast("Não foi possível publicar: " + e.message);
          } finally {
            btn.disabled = false;
          }
        });
        const mediaInput = $("#communityMedia");
        mediaInput?.addEventListener("change", () => {
          $("#communityMediaName").textContent =
            mediaInput.files?.[0]?.name || "Até 100 MB";
        });
        $$("[data-comments]", section).forEach((b) =>
          b.addEventListener("click", () =>
            loadCommunityComments(b.dataset.comments),
          ),
        );
      };
      async function loadCommunityComments(postId) {
        const target = $(`#community-comments-${CSS.escape(postId)}`);
        if (!target) return;
        if (target.dataset.loaded !== "1") {
          const { data, error } = await sb
            .from("comments")
            .select("id,content,author_id,parent_comment_id,created_at")
            .eq("post_id", postId)
            .is("deleted_at", null)
            .order("created_at", { ascending: true });
          if (error) {
            toast("Não foi possível carregar as respostas: " + error.message);
            return;
          }
          target.dataset.loaded = "1";
          target.innerHTML = `<div class="ln-comment-list">${(data || []).map((cm) => `<div class="ln-comment"><div><strong>${cm.author_id === user?.id ? "Você" : "Membro"}</strong><span class="ln-muted"> · ${new Date(cm.created_at).toLocaleString("pt-BR")}</span></div><p>${esc(cm.content)}</p>${isMember ? `<button class="ln-action" data-reply-comment="${esc(cm.id)}" data-post-id="${esc(postId)}">Responder</button>` : ""}</div>`).join("") || '<p class="ln-muted">Ainda não há respostas.</p>'}</div>`;
          $$("[data-reply-comment]", target).forEach((btn) =>
            btn.addEventListener("click", () => {
              const content = prompt("Escreva sua resposta:");
              if (content?.trim())
                sendCommunityComment(
                  postId,
                  content.trim(),
                  btn.dataset.replyComment,
                );
            }),
          );
        }
        if (isMember && !target.querySelector("form"))
          target.insertAdjacentHTML(
            "beforeend",
            `<form class="ln-inline-reply" data-comment-form="${esc(postId)}"><input class="ln-input" name="comment" maxlength="5000" placeholder="Escreva uma resposta…" required><button class="ln-btn" type="submit">Enviar</button></form>`,
          );
        target.querySelector("form")?.addEventListener(
          "submit",
          async (e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.comment;
            await sendCommunityComment(postId, input.value.trim(), null);
            input.value = "";
          },
          { once: true },
        );
      }
      async function sendCommunityComment(postId, content, parentId) {
        if (!needAuth()) return;
        try {
          const payload = { post_id: postId, author_id: user.id, content };
          if (parentId) payload.parent_comment_id = parentId;
          const { error } = await sb.from("comments").insert(payload);
          if (error) throw error;
          toast("Resposta enviada!");
          const target = $(`#community-comments-${CSS.escape(postId)}`);
          if (target) {
            target.dataset.loaded = "";
            target.innerHTML = "";
            await loadCommunityComments(postId);
          }
        } catch (e) {
          toast("Não foi possível responder: " + e.message);
        }
      }
      const renderChat = async (
        subcommunityId = null,
        subcommunityName = "Chat geral",
      ) => {
        detailStage = "carregando chat";
        if (activeChatChannel) {
          try {
            await sb.removeChannel(activeChatChannel);
          } catch {}
          activeChatChannel = null;
        }
        const filter = sb
          .from("community_chat_messages")
          .select("id,user_id,content,media_url,media_type,created_at")
          .eq("community_id", id);
        const q = subcommunityId
          ? filter.eq("subcommunity_id", subcommunityId)
          : filter.is("subcommunity_id", null);
        const { data, error } = await q
          .order("created_at", { ascending: true })
          .limit(100);
        if (error) throw error;
        section.innerHTML = `<div class="ln-section-heading"><div><span class="ln-kicker">CONVERSA EM TEMPO REAL*</span><h2>${esc(subcommunityName)}</h2><p class="ln-muted">Um chat para trocar ideias com quem está aqui.</p></div><button class="ln-btn ghost" id="refreshChat">↻ Atualizar</button></div><div class="ln-chat-shell"><div id="communityChatMessages" class="ln-chat-messages">${(data || []).map((m) => `<article class="ln-chat-message ${m.user_id === user?.id ? "mine" : ""}"><div class="ln-chat-message-meta"><strong>${m.user_id === user?.id ? "Você" : "Membro"}</strong><time>${new Date(m.created_at).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</time></div>${m.content ? `<p>${esc(m.content)}</p>` : ""}${m.media_url ? mediaMarkup([m.media_url]) : ""}</article>`).join("") || '<div class="ln-empty">O chat está quietinho por enquanto. Mande a primeira mensagem!</div>'}</div>${isMember ? `<form id="communityChatForm" class="ln-chat-compose"><textarea name="content" maxlength="5000" placeholder="Escreva uma mensagem…" aria-label="Mensagem do chat"></textarea><label class="ln-media-pick">＋ Mídia<input name="media" type="file" accept="image/*,video/mp4,video/webm,video/quicktime" hidden></label><button class="ln-btn" type="submit">Enviar ↗</button></form>` : '<p class="ln-muted">Participe da comunidade para conversar no chat e enviar mídias.</p>'}</div><p class="ln-muted ln-chat-note">*Atualize o chat para ver novas mensagens. O envio de mídia depende do bucket community-media.</p>`;
        $("#refreshChat")?.addEventListener("click", () =>
          renderChat(subcommunityId, subcommunityName),
        );
        $("#communityChatForm")?.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (!needAuth()) return;
          const form = e.currentTarget,
            content = form.elements.content.value.trim(),
            file = form.elements.media.files?.[0];
          if (!content && !file) return;
          const btn = form.querySelector("[type=submit]");
          btn.disabled = true;
          try {
            let media_url = null,
              media_type = null;
            if (file) {
              media_url = await upload(
                file,
                "community-media",
                `${user.id}/${id}/chat`,
              );
              media_type = file.type.startsWith("video/") ? "video" : "image";
            }
            const { error } = await sb.from("community_chat_messages").insert({
              community_id: id,
              subcommunity_id: subcommunityId,
              user_id: user.id,
              content,
              media_url,
              media_type,
            });
            if (error) throw error;
            await renderChat(subcommunityId, subcommunityName);
          } catch (e) {
            toast("Não foi possível enviar a mensagem: " + e.message);
          } finally {
            btn.disabled = false;
          }
        });
        activeChatChannel = sb
          .channel(`community-chat-${id}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "community_chat_messages",
              filter: `community_id=eq.${id}`,
            },
            () => {
              renderChat(subcommunityId, subcommunityName);
            },
          )
          .subscribe();
      };
      const renderSubcommunities = async () => {
        detailStage = "carregando subcomunidades";
        const { data, error } = await sb
          .from("community_subcommunities")
          .select("id,name,description,cover_url,created_at")
          .eq("community_id", id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        section.innerHTML = `<div class="ln-section-heading"><div><span class="ln-kicker">ENCONTRE SUA TURMA</span><h2>Subcomunidades</h2><p class="ln-muted">Pequenos grupos dentro deste espaço, cada um com seu próprio chat.</p></div></div>${canManage ? '<form id="subcommunityForm" class="ln-compose ln-subcommunity-form"><h3>＋ Criar subcomunidade</h3><input class="ln-input" name="name" placeholder="Nome do grupo" maxlength="80" required><textarea name="description" placeholder="Sobre o que este grupo conversa?" maxlength="500"></textarea><button class="ln-btn" type="submit">Criar grupo</button></form>' : ""}<div class="ln-subcommunity-grid">${(data || []).map((s) => `<article class="ln-subcommunity-card"><div class="ln-subcommunity-cover" style="${s.cover_url ? `background-image:linear-gradient(0deg,#0b0c19aa,#0b0c1910),url('${esc(s.cover_url)}')` : ""}">✧</div><div class="ln-subcommunity-body"><h3>${esc(s.name)}</h3><p>${esc(s.description || "Um grupo para conversar sobre este interesse.")}</p><button class="ln-btn" data-open-subchat="${esc(s.id)}" data-subname="${esc(s.name)}">Abrir chat ↗</button></div></article>`).join("") || '<div class="ln-empty">Ainda não há subcomunidades. Crie um grupo para organizar interesses e conversas.</div>'}</div>`;
        $("#subcommunityForm")?.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (!needAuth()) return;
          const form = e.currentTarget;
          try {
            const { error } = await sb.from("community_subcommunities").insert({
              community_id: id,
              name: form.elements.name.value.trim(),
              description: form.elements.description.value.trim(),
              created_by: user.id,
            });
            if (error) throw error;
            toast("Subcomunidade criada!");
            await renderSubcommunities();
          } catch (e) {
            toast("Não foi possível criar subcomunidade: " + e.message);
          }
        });
        $$("[data-open-subchat]", section).forEach((b) =>
          b.addEventListener("click", () =>
            renderChat(b.dataset.openSubchat, b.dataset.subname),
          ),
        );
      };
      const renderMaterials = async () => {
        detailStage = "carregando materiais";
        const { data, error } = await sb
          .from("community_resources")
          .select("*")
          .eq("community_id", id)
          .order("position")
          .order("created_at", { ascending: false });
        if (error) throw error;
        section.innerHTML = `<div class="ln-section-heading"><div><span class="ln-kicker">GUARDE E COMPARTILHE</span><h2>Materiais da comunidade</h2></div>${canManage || profile?.role === "mentor" ? '<button class="ln-btn" id="addResource">＋ Adicionar material</button>' : ""}</div><p class="ln-muted">Vídeos, apostilas, imagens e links organizados pela comunidade.</p><div class="ln-resource-grid">${(data || []).map((r) => `<article class="ln-resource"><span class="ln-kicker">${esc(r.resource_type)}</span><h3>${esc(r.title)}</h3><p>${esc(r.description || "")}</p><a href="${esc(r.file_url)}" target="_blank" rel="noopener">Abrir material ↗</a></article>`).join("") || '<p class="ln-empty">Nenhum material publicado ainda.</p>'}</div>`;
        if (canManage || profile?.role === "mentor")
          $("#addResource")?.addEventListener("click", () => resourceForm());
      };
      const renderSettings = () => {
        section.innerHTML = `<h2>Personalizar a comunidade</h2><form id="communitySettings" class="ln-compose"><label>Nome<input class="ln-input" id="settingName" value="${esc(c.name)}" required maxlength="80"></label><label>Descrição<textarea id="settingDescription" maxlength="2000">${esc(c.description || "")}</textarea></label><label>Cor de destaque<input id="settingAccent" type="color" value="${esc(settings.accent || "#8b5cf6")}"></label><label>Capa (imagem)<input class="ln-input" id="settingCover" type="file" accept="image/*"></label><label>Ícone/avatar (imagem)<input class="ln-input" id="settingAvatar" type="file" accept="image/*"></label><button class="ln-btn" type="submit">Salvar personalização</button></form>`;
        $("#communitySettings").addEventListener("submit", async (e) => {
          e.preventDefault();
          if (!needAuth()) return;
          const btn = e.currentTarget.querySelector("button");
          btn.disabled = true;
          try {
            let cover_url = c.cover_url,
              avatar_url = c.avatar_url;
            const cover = $("#settingCover").files[0],
              avatar = $("#settingAvatar").files[0];
            if (cover)
              cover_url = await upload(
                cover,
                "community-media",
                `${user.id}/${id}/cover`,
              );
            if (avatar)
              avatar_url = await upload(
                avatar,
                "community-media",
                `${user.id}/${id}/avatar`,
              );
            settings = { ...settings, accent: $("#settingAccent").value };
            const { error } = await sb
              .from("communities")
              .update({
                name: $("#settingName").value.trim(),
                description: $("#settingDescription").value.trim(),
                cover_url,
                avatar_url,
                settings,
              })
              .eq("id", id);
            if (error) throw error;
            toast("Comunidade atualizada.");
            initDetail();
          } catch (err) {
            toast("Falha ao salvar: " + err.message);
          } finally {
            btn.disabled = false;
          }
        });
      };
      $$("[data-section]").forEach((b) =>
        b.addEventListener("click", async () => {
          $$("[data-section]").forEach((x) =>
            x.classList.toggle("active", x === b),
          );
          try {
            if (b.dataset.section === "feed") await renderPosts();
            if (b.dataset.section === "chat") await renderChat();
            if (b.dataset.section === "subcommunities")
              await renderSubcommunities();
            if (b.dataset.section === "materials") await renderMaterials();
            if (b.dataset.section === "settings") renderSettings();
          } catch (e) {
            console.error(e);
            section.innerHTML = `<div class="ln-empty"><strong>Não foi possível carregar esta área.</strong><p>${esc(e.message || "Confira se executou a migração de comunidades sociais no Supabase.")}</p></div>`;
          }
        }),
      );
      $("#joinCommunity")?.addEventListener("click", async () => {
        if (!needAuth()) return;
        try {
          if (isMember) {
            toast("Você já participa desta comunidade.");
            return;
          }
          const { count, error: countError } = await sb
            .from("community_members")
            .select("community_id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .eq("status", "active");
          if (countError) throw countError;
          if ((count || 0) >= 4)
            throw Error(
              "Você pode participar de até 4 comunidades. Saia de uma delas para entrar nesta.",
            );
          const { error } = await sb.from("community_members").upsert({
            community_id: id,
            user_id: user.id,
            role: "member",
            status: c.join_policy === "approval" ? "pending" : "active",
          });
          if (error) throw error;
          toast(
            c.join_policy === "approval"
              ? "Solicitação enviada para aprovação."
              : "Você entrou na comunidade!",
          );
          initDetail();
        } catch (e) {
          toast("Não foi possível participar: " + e.message);
        }
      });
      await renderPosts();
    } catch (e) {
      console.error("Erro ao abrir comunidade:", {
        stage: detailStage,
        message: e?.message,
        details: e?.details,
        hint: e?.hint,
        code: e?.code,
        error: e,
      });
      const msg =
        [e?.message, e?.details, e?.hint, e?.code ? `Código: ${e.code}` : null]
          .filter(Boolean)
          .join(" — ") || "Erro sem detalhes retornados pelo Supabase.";
      root.innerHTML = `<div class="ln-panel ln-empty"><strong>Não foi possível abrir esta comunidade.</strong><p>Etapa: ${esc(detailStage)}</p><p>Erro técnico: ${esc(msg)}</p><p>Envie esta mensagem para corrigirmos a causa exata.</p><a href="comunidades.html">Voltar às comunidades</a></div>`;
    }
  }
  function addStyles() {
    const css = `.ln-toast{position:fixed;z-index:9999;right:20px;bottom:20px;max-width:min(420px,calc(100vw - 32px));padding:13px 17px;border:1px solid #ffffff24;border-radius:12px;background:#171827;color:#fff;box-shadow:0 15px 40px #0005;opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s}.ln-toast.show{opacity:1;transform:none}.ln-mobile-toggle{display:none;border:1px solid #ffffff24;border-radius:10px;padding:9px 12px;background:#171827;color:inherit}.ln-real-card{cursor:pointer}.ln-real-card .ln-card-art[style*="background-image"]{background-size:cover;background-position:center}.ln-card-symbol img{width:42px;height:42px;object-fit:cover;border-radius:50%}.ln-community-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.ln-community-banner{background-color:#171827;background-image:radial-gradient(ellipse at 80% 20%,#8b5cf633,transparent 45%);background-size:cover;background-position:center}.ln-resource-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.ln-resource{padding:18px;border:1px solid #ffffff1b;border-radius:14px;background:#ffffff05}.ln-resource h3{margin:10px 0}.ln-resource p{color:var(--muted,#aab0c5)}.ln-avatar-img{width:38px;height:38px;object-fit:cover;border-radius:50%;background:#26263a}.ln-comment{padding:8px 12px;border-left:2px solid #8b5cf6;margin:8px 0}.ln-compose label{display:grid;gap:6px;margin:10px 0}.ln-media-pick{display:inline-flex!important;align-items:center;cursor:pointer;border:1px solid #ffffff22;border-radius:10px;padding:9px 12px;margin:0!important;color:inherit}.ln-compose .ln-input{width:100%}@media(max-width:820px){.ln-mobile-toggle{display:inline-block;margin-right:8px}.ln-layout,.app-shell{display:block!important}.sidebar{position:fixed!important;z-index:1000;left:0;top:0;bottom:0;width:min(300px,86vw)!important;transform:translateX(-110%);transition:transform .22s;box-shadow:0 0 0 100vmax transparent;overflow-y:auto}.sidebar.ln-sidebar-open{transform:translateX(0);box-shadow:0 0 0 100vmax #0008}.ln-content,.main-content{width:100%!important;min-width:0!important;padding:16px!important}.ln-top,.topbar{gap:8px;flex-wrap:wrap}.ln-search,.search-box{min-width:0;flex:1}.ln-columns{grid-template-columns:1fr!important}.ln-community-grid{grid-template-columns:1fr!important}.ln-hero{padding-top:28px!important}.ln-title{font-size:clamp(32px,8vw,48px)!important}.ln-modal{max-width:calc(100vw - 24px);max-height:90dvh;overflow:auto}.ln-community-meta{gap:10px;flex-wrap:wrap}}
.ln-community-hero-modern{overflow:hidden;border-radius:22px}.ln-community-banner-modern{position:relative;min-height:270px;padding:26px 28px;display:flex;flex-direction:column;justify-content:space-between;background-color:#171827;border:1px solid #ffffff17;border-radius:22px;isolation:isolate}.ln-community-banner-modern:before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 75% 10%,var(--community-accent,#8b5cf6)55,transparent 55%);opacity:.16;z-index:-1}.ln-cover-title{display:flex;align-items:center;gap:18px;margin:24px 0}.ln-cover-title h1{font-size:clamp(30px,5vw,48px);line-height:1.08;margin:0 0 8px}.ln-cover-title p{max-width:680px;margin:0;color:#eef0ff}.ln-cover-avatar{width:78px;height:78px;flex:0 0 78px;display:grid;place-items:center;border-radius:22px;background:#111322b8;border:1px solid #ffffff55;box-shadow:0 12px 36px #0004;font-size:30px;overflow:hidden}.ln-cover-avatar img{width:100%;height:100%;object-fit:cover}.ln-cover-bottom{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:#f3f1ffcc}.ln-community-meta{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 4px}.ln-community-tabs-modern{position:sticky;top:8px;z-index:5;padding:8px;border-radius:15px;background:#101221ed;border:1px solid #ffffff13;backdrop-filter:blur(18px)}.ln-community-tabs-modern .ln-chip{padding:10px 15px}.ln-community-content{padding:clamp(16px,3vw,28px);border-radius:20px}.ln-section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:20px}.ln-section-heading h2{margin:5px 0 8px}.ln-live-pill{white-space:nowrap;font-size:12px;border:1px solid #6ee7b755;border-radius:999px;padding:7px 10px;color:#a7f3d0}.ln-social-compose{padding:16px;border:1px solid #ffffff1c;border-radius:17px;background:#ffffff06;margin:0 0 22px}.ln-social-compose textarea{width:100%;min-height:95px;resize:vertical;background:transparent;color:inherit;border:0;outline:0;font:inherit}.ln-compose-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid #ffffff12;padding-top:12px}.ln-compose-tools .ln-btn{margin-left:auto}.ln-community-post-list{display:grid;gap:15px}.ln-community-post{padding:20px;border:1px solid #ffffff16;border-radius:18px;background:linear-gradient(135deg,#ffffff07,#ffffff02)}.ln-community-post .ln-post-head{display:flex;align-items:center;gap:11px}.ln-avatar-fallback{width:38px;height:38px;display:grid;place-items:center;border-radius:50%;background:#8b5cf633;color:#c4b5fd}.ln-community-post-text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}.ln-community-media{display:block;max-width:100%;max-height:520px;object-fit:contain;border-radius:14px;margin:12px 0;background:#05060b}.ln-empty-social{text-align:center;padding:40px 20px}.ln-empty-social>span{font-size:28px;color:#c4b5fd}.ln-empty-social h3{margin:8px}.ln-comment-list{display:grid;gap:10px;margin:12px 0}.ln-comment{padding:12px;border-radius:12px;background:#ffffff06;border-left:2px solid var(--community-accent,#8b5cf6)}.ln-comment p{margin:6px 0}.ln-inline-reply{display:flex;gap:8px;margin-top:12px}.ln-inline-reply .ln-input{flex:1;min-width:0}.ln-chat-shell{border:1px solid #ffffff17;border-radius:18px;overflow:hidden;background:#090b16}.ln-chat-messages{min-height:300px;max-height:56vh;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:12px}.ln-chat-message{max-width:min(82%,620px);align-self:flex-start;padding:12px 14px;border-radius:15px 15px 15px 4px;background:#ffffff0b;border:1px solid #ffffff12}.ln-chat-message.mine{align-self:flex-end;background:#8b5cf626;border-color:#a78bfa55;border-radius:15px 15px 4px 15px}.ln-chat-message-meta{display:flex;align-items:center;gap:12px;font-size:12px;color:#c4b5fd}.ln-chat-message-meta time{color:#a1a1b8}.ln-chat-message p{margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.ln-chat-message .ln-community-media{max-width:min(100%,380px);max-height:320px}.ln-chat-compose{display:flex;align-items:flex-end;gap:9px;padding:12px;border-top:1px solid #ffffff15;flex-wrap:wrap}.ln-chat-compose textarea{flex:1;min-width:180px;min-height:42px;max-height:120px;resize:vertical;background:#ffffff08;color:inherit;border:1px solid #ffffff17;border-radius:12px;padding:11px;font:inherit}.ln-chat-note{font-size:12px;margin-top:10px}.ln-subcommunity-form{padding:16px;border:1px solid #ffffff19;border-radius:16px;margin-bottom:20px}.ln-subcommunity-form h3{margin-top:0}.ln-subcommunity-form .ln-input,.ln-subcommunity-form textarea{width:100%;margin:5px 0 10px}.ln-subcommunity-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:15px}.ln-subcommunity-card{border:1px solid #ffffff19;border-radius:16px;overflow:hidden;background:#ffffff05}.ln-subcommunity-cover{height:90px;display:grid;place-items:center;font-size:25px;background:radial-gradient(ellipse at 70% 30%,#8b5cf644,transparent 60%),#151628;background-size:cover;background-position:center}.ln-subcommunity-body{padding:16px}.ln-subcommunity-body h3{margin:0 0 8px}.ln-subcommunity-body p{min-height:42px;color:var(--muted,#aab0c5)}.ln-subcommunity-body .ln-btn{width:100%}
`;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.append(st);
  }
  document.addEventListener("DOMContentLoaded", async () => {
    addStyles();
    constructionLinks();
    navMobile();
    try {
      await initClient();
      applyMiniProfile();
      if ($("#communityGrid")) await initList();
      if ($("#detailRoot")) await initDetail();
      if ($("#generalFeed")) await initFeed();
    } catch (e) {
      console.warn("LUMINOVA social:", e);
      if ($("#communityGrid"))
        $("#communityGrid").innerHTML =
          `<div class="ln-panel ln-empty">Não foi possível iniciar o Supabase: ${esc(e.message || "erro desconhecido")}. Confira a configuração e as políticas RLS.</div>`;
      if ($("#generalFeed"))
        $("#generalFeed").innerHTML =
          '<div class="ln-empty">Entre na sua conta para acessar o feed.</div>';
    }
  });
})();
