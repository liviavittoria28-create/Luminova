/* LUMINOVA — núcleo compartilhado: cliente Supabase, sessão, helpers e a SIDEBAR ÚNICA.
   Não altera login/autenticação: só reutiliza a mesma sessão (sessionStorage) das demais páginas. */
(() => {
  "use strict";
  if (window.LUMI) return;

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LUMI = { esc, user: null, profile: null, isAdmin: false, sb: null };
  window.LUMI = LUMI;

  // ---------- cliente Supabase (um só por página) ----------
  const cfg = window.LUMINOVA_SUPABASE_CONFIG;
  if (cfg?.url && cfg?.anonKey && window.supabase?.createClient) {
    LUMI.sb = window.luminovaSupabase || window.supabaseClient || window.luminovaCreateClient();
    window.luminovaSupabase = LUMI.sb;
  }

  // ---------- helpers ----------
  LUMI.toast = (msg) => {
    let el = document.getElementById("lumiToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "lumiToast";
      el.setAttribute("role", "status");
      el.style.cssText = "position:fixed;z-index:3000;right:16px;bottom:16px;max-width:min(420px,calc(100vw - 32px));padding:13px 17px;border:1px solid var(--a-edge);background:var(--a-glass-2);backdrop-filter:blur(16px);border-radius:2px;color:var(--a-ink);box-shadow:var(--a-shadow);opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s;font:700 14px/1.4 Nunito,system-ui,sans-serif";
      document.body.append(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    el.style.transform = "none";
    clearTimeout(LUMI.toast.t);
    LUMI.toast.t = setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(8px)"; }, 3400);
  };
  LUMI.initials = (n) => {
    const p = String(n || "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "?";
    return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
  };
  LUMI.avatar = (p, cls = "lumi-av", size = 40) => {
    const name = p?.display_name || p?.username || "";
    const base = `width:${size}px;height:${size}px;flex:0 0 ${size}px;border-radius:2px;overflow:hidden;display:inline-grid;place-items:center;background:linear-gradient(180deg,#8fd0f8,#3a8fdc 50%,#2a72c4 52%,#4a98e0);color:#fff;border:1px solid #17539a;box-shadow:inset 0 1px 0 rgba(255,255,255,.55);font-size:${Math.round(size / 3)}px;font-weight:800`;
    return p?.avatar_url
      ? `<span class="${cls}" style="${base}"><img src="${esc(p.avatar_url)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.remove()"></span>`
      : `<span class="${cls}" style="${base}">${esc(LUMI.initials(name))}</span>`;
  };
  LUMI.time = (iso) => {
    try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
  };
  LUMI.hhmm = (iso) => {
    try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
  };
  LUMI.aiBadge = (p) => (p?.is_ai ? ' <span title="Perfil de IA da LUMINOVA" style="font:800 10px/1 Nunito,sans-serif;letter-spacing:.08em;border:1px solid var(--a-aqua);color:var(--a-aqua);background:color-mix(in srgb,var(--a-aqua) 12%,transparent);border-radius:2px;padding:3px 6px;vertical-align:middle">IA</span>' : "");
  // Selo de perfil certificado (certified vem de profile_progress.certified).
  LUMI.certBadge = (certified) => (certified ? ' <span class="ln-cert" title="Perfil certificado LUMINOVA" aria-label="Perfil certificado" style="display:inline-block;font-size:12px;line-height:1;color:#fff;background:linear-gradient(180deg,#6fc2f5,#2a72c4);box-shadow:inset 0 1px 0 #fff8;border-radius:2px;padding:3px 5px;vertical-align:middle;margin-left:4px"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg></span>' : "");
  LUMI.profileUrl = (id) => (LUMI.user && LUMI.user.id === id ? "perfil.html" : `perfil-publico.html?id=${encodeURIComponent(id)}`);

  // Contraste (WCAG) para a cor de texto do perfil.
  LUMI.lum = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return 0;
    const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  LUMI.contrast = (a, b) => {
    const [x, y] = [LUMI.lum(a), LUMI.lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  // Sessão + perfil (promessa compartilhada).
  LUMI.ready = (async () => {
    if (!LUMI.sb) return LUMI;
    try {
      const { data } = await LUMI.sb.auth.getSession();
      LUMI.user = data?.session?.user || null;
      if (!LUMI.user) {
        const r = await LUMI.sb.auth.getUser();
        LUMI.user = r?.data?.user || null;
      }
      if (LUMI.user) {
        const { data: p } = await LUMI.sb.from("profiles").select("*").eq("id", LUMI.user.id).maybeSingle();
        LUMI.profile = p || null;
        LUMI.isAdmin = p?.role === "admin";
      }
    } catch (e) { console.warn("LUMI sessão:", e); }
    return LUMI;
  })();
  // Páginas que exigem login chamam: LUMI.requireLogin()
  LUMI.requireLogin = async () => {
    await LUMI.ready;
    if (!LUMI.user) {
      const here = location.pathname.split("/").pop() || "perfil.html";
      location.replace("index.html?redirect=" + encodeURIComponent(here + location.search));
      return false;
    }
    return true;
  };

  // ---------- SIDEBAR ÚNICA ----------
  const ic = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    geral: ic('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    comunidades: ic('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>'),
    chats: ic('<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>'),
    explorar: ic('<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>'),
    atividades: ic('<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>'),
    conquistas: ic('<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>'),
    admin: ic('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
    notificacoes: ic('<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>'),
    novabrain: ic('<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>'),
    salvos: ic('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>'),
    configuracoes: ic('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>'),
    sair: ic('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
    cog: ic('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  };
  const logo = (n, id) => (window.LUMI_THEME ? window.LUMI_THEME.logo(n, id) : "");
  const BURGER = ic('<path d="M4 6h16M4 12h16M4 18h16"/>');
  const CLOSE = ic('<path d="M6 6l12 12M18 6L6 18"/>');
  const star = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5 L13.6 10.4 L22.5 12 L13.6 13.6 L12 22.5 L10.4 13.6 L1.5 12 L10.4 10.4 Z"/></svg>';

  const page = (location.pathname.split("/").pop() || "perfil.html").toLowerCase();
  const tab = new URLSearchParams(location.search).get("tab");
  const activeKey =
    page === "geral.html" && new URLSearchParams(location.search).has("salvos") ? "salvos"
    : page === "geral.html" ? "geral"
    : page === "comunidades.html" || page === "comunidade-detalhe.html" ? "comunidades"
    : page === "chats.html" ? "chats"
    : page === "explorar.html" ? "explorar"
    : page === "admin.html" ? "admin"
    : page === "notificacoes.html" ? "notificacoes"
    : page === "nova-brain.html" ? "novabrain"
    : page === "configuracoes.html" ? "configuracoes"
    : page === "perfil.html" && tab === "atividade" ? "atividades"
    : page === "perfil.html" && tab === "conquistas" ? "conquistas"
    : "";
  const ITEMS = [
    ["geral", "geral.html", "Geral"],
    ["comunidades", "comunidades.html", "Comunidades"],
    ["chats", "chats.html", "Chats"],
    ["notificacoes", "notificacoes.html", "Notificações"],
    ["explorar", "explorar.html", "Explorar"],
    ["novabrain", "nova-brain.html", "NOVA BRAIN"],
    ["salvos", "geral.html?salvos=1", "Salvos"],
    ["atividades", "perfil.html?tab=atividade", "Atividades"],
    ["conquistas", "perfil.html?tab=conquistas", "Conquistas"],
  ];
  const linkHtml = ([k, href, label]) =>
    `<a class="lsb-link" href="${href}" data-nav="${k}"${k === activeKey ? ' aria-current="page"' : ""}>${ICON[k]}<span>${label}</span>${k === "chats" || k === "notificacoes" ? `<i class="l3-badge" data-badge="${k}" hidden></i>` : ""}</a>`;

  function buildSidebar() {
    // Remove qualquer sidebar antiga (perfil, comunidade, páginas públicas…).
    document.querySelectorAll('aside[data-testid="app-sidebar"], aside.sidebar, aside.ln-profile-sidebar, .lumi-mobile-menu-toggle, .lumi-chat-mobile-nav').forEach((el) => el.remove());
    document.querySelectorAll(".ln-mobile-toggle, #mobileNavToggle").forEach((el) => el.remove());

    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "luminova-sidebar.css?v=3.1.0";
    document.head.append(css);

    const aside = document.createElement("aside");
    aside.className = "lsb";
    aside.id = "lumiSidebar";
    aside.setAttribute("data-testid", "app-sidebar");
    aside.setAttribute("aria-label", "Navegação principal");
    aside.innerHTML = `
      <a class="lsb-brand" href="geral.html" aria-label="LumiNova início">${logo(22, "sb")}<span>LumiNova</span></a>
      <p class="lsb-label">Espaço</p>
      <nav class="lsb-nav" id="lsbNav">${ITEMS.map(linkHtml).join("")}</nav>
      <div class="lsb-bottom">
        <span id="lsbThemeSlot"></span>
        <a class="lsb-me" href="perfil.html" data-testid="sidebar-mini-profile" aria-label="Abrir meu perfil">
          <span class="lsb-avatar" id="sidebar-avatar"></span>
          <span class="lsb-me-txt"><strong id="sidebar-name">—</strong><small>Seu espaço</small></span>
        </a>
        <div class="lsb-pair">
          <a class="lsb-btn" href="configuracoes.html" data-nav="configuracoes"${activeKey === "configuracoes" ? ' aria-current="page"' : ""}>${ICON.configuracoes}Configurações</a>
          <button type="button" class="lsb-btn" id="lsbLogout" aria-label="Sair da conta">${ICON.sair}Sair</button>
        </div>
        <button type="button" class="lsb-btn" id="openSettings" data-testid="sidebar-customize-button">${ICON.cog}Personalizar perfil</button>
        <p class="lsb-legal"><a href="termos.html">Termos</a> · <a href="privacidade.html">Privacidade</a> · <span>v${window.LUMINOVA_VERSION || "3"}</span></p>
      </div>`;
    const back = document.createElement("button");
    back.type = "button";
    back.className = "lsb-backdrop";
    back.setAttribute("aria-label", "Fechar menu");
    // Barra mobile: só o botão do menu (sem estrela nem marca), para manter a navegação no celular.
    const top = document.createElement("div");
    top.className = "lsb-topbar";
    top.innerHTML = `<button type="button" class="lsb-burger" id="lsbBurger" aria-label="Abrir menu de navegação" aria-expanded="false" aria-controls="lumiSidebar">${BURGER}</button>`
      + `<a class="lsb-top-brand" href="geral.html" aria-label="LumiNova início">${logo(22, "tb")}<span>LumiNova</span></a><span id="lsbThemeMini"></span>`;
    document.body.prepend(aside);
    document.body.prepend(back);
    document.body.prepend(top);
    document.body.classList.add("lsb-on");
    // Páginas Tailwind (perfil/comunidade) já reservam 260px no <main>; as demais recebem o deslocamento.
    if (!document.querySelector('main[class*="pl-[260px]"]')) document.body.classList.add("lsb-shift");

    if (window.LUMI_THEME) {
      aside.querySelector("#lsbThemeSlot").replaceWith(window.LUMI_THEME.makeToggle("lsb-theme", true));
      top.querySelector("#lsbThemeMini").replaceWith(window.LUMI_THEME.makeToggle("lumi-theme-mini", false));
    }
    const burger = top.querySelector("#lsbBurger");
    const set = (open) => {
      aside.classList.toggle("lsb-open", open);
      back.classList.toggle("show", open);
      document.body.classList.toggle("lsb-lock", open && innerWidth < 1024);
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Fechar menu de navegação" : "Abrir menu de navegação");
      burger.innerHTML = open ? CLOSE : BURGER;
    };
    burger.addEventListener("click", () => set(!aside.classList.contains("lsb-open")));
    back.addEventListener("click", () => set(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
    aside.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => set(false)));
    addEventListener("resize", () => { if (innerWidth >= 1024) set(false); });

    // "Personalizar perfil": na própria página do perfil abre o modal; nas outras leva até ele.
    aside.querySelector("#openSettings").addEventListener("click", (e) => {
      if (page === "perfil.html") return; // o script do perfil já abre o modal
      e.preventDefault();
      location.href = "perfil.html?edit=1";
    });
    return aside;
  }

  // Tema salvo no perfil (profiles.profile_settings.theme, jsonb que já existe). O localStorage é só cache
  // para evitar o "piscar" antes do login ser conhecido. Só grava quando a pessoa clica no interruptor.
  function syncThemeWithProfile() {
    if (!LUMI.user || !window.LUMI_THEME) return;
    const saved = LUMI.profile?.profile_settings?.theme;
    if (saved === "light" || saved === "dark") { if (saved !== LUMI_THEME.theme) LUMI_THEME.sync(saved); }
    addEventListener("luminova:theme", async (e) => {
      if (!e.detail?.userAction || !LUMI.sb) return;
      try {
        const { data } = await LUMI.sb.from("profiles").select("profile_settings").eq("id", LUMI.user.id).maybeSingle();
        const next = { ...(data?.profile_settings || {}), theme: e.detail.theme };
        const { error } = await LUMI.sb.from("profiles").update({ profile_settings: next }).eq("id", LUMI.user.id);
        if (error) throw error;
        if (LUMI.profile) LUMI.profile.profile_settings = next;
      } catch (err) { console.warn("Não foi possível salvar o tema no perfil:", err?.message || err); }
    });
  }

  // Presença REAL: Supabase Realtime Presence (efêmera, nada é gravado no banco). Quem está com o
  // LumiNova aberto aparece como online; ao fechar a aba a presença some sozinha. Perfis de IA nunca entram.
  LUMI.presence = { online: new Set(), ready: false, listeners: new Set(), onChange(fn) { this.listeners.add(fn); } };
  function startPresence() {
    if (!LUMI.user || !LUMI.sb || LUMI.profile?.is_ai) return;
    try {
      const ch = LUMI.sb.channel("luminova-presence", { config: { presence: { key: LUMI.user.id } } });
      ch.on("presence", { event: "sync" }, () => {
        LUMI.presence.online = new Set(Object.keys(ch.presenceState()));
        LUMI.presence.ready = true;
        LUMI.presence.listeners.forEach((fn) => { try { fn(); } catch (_) {} });
      }).subscribe(async (status) => {
        if (status === "SUBSCRIBED") await ch.track({ at: new Date().toISOString() });
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          LUMI.presence.ready = false;
          LUMI.presence.listeners.forEach((fn) => { try { fn(); } catch (_) {} });
        }
      });
    } catch (e) { console.warn("Presença indisponível:", e?.message || e); }
  }

  // Contadores reais (mensagens não lidas e notificações) + atualização em tempo real.
  async function refreshBadges() {
    if (!LUMI.user || !LUMI.sb) return;
    const { data, error } = await LUMI.sb.rpc("luminova_unread_counts");
    if (error || !data?.[0]) return;
    const set = (k, n) => document.querySelectorAll(`[data-badge="${k}"]`).forEach((b) => { b.hidden = !n; b.textContent = n > 99 ? "99+" : String(n); b.setAttribute("aria-label", `${n} não lida(s)`); });
    set("chats", data[0].messages); set("notificacoes", data[0].notifications);
  }
  LUMI.refreshBadges = refreshBadges;
  function watchBadges() {
    if (!LUMI.user || !LUMI.sb) return;
    refreshBadges();
    try {
      LUMI.sb.channel("lumi-badges-" + LUMI.user.id)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${LUMI.user.id}` }, refreshBadges)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => setTimeout(refreshBadges, 400))
        .subscribe();
    } catch (_) {}
    addEventListener("focus", refreshBadges);
  }
  // Documentos legais com versão nova ainda não aceita: aviso discreto no topo.
  async function pendingDocs() {
    if (!LUMI.user || !LUMI.sb || page === "configuracoes.html") return;
    const { data } = await LUMI.sb.rpc("luminova_pending_documents");
    if (!data?.length) return;
    const bar = document.createElement("div");
    bar.className = "l3-alert lsb-docs";
    bar.setAttribute("role", "status");
    bar.innerHTML = `Atualizamos ${data.map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>`).join(" e ")}. <a href="configuracoes.html?aceitar=1#privacidade">Revisar e aceitar</a>`;
    (document.querySelector("main") || document.body).prepend(bar);
  }

  async function fillSidebar() {
    await LUMI.ready;
    document.getElementById("lsbLogout")?.addEventListener("click", async () => {
      LUMI.loggingOut = true;
      try { await LUMI.sb?.auth.signOut(); } catch (_) {}
      try { localStorage.removeItem("luminova-remember"); Object.keys(localStorage).filter((k) => k.startsWith("sb-")).forEach((k) => localStorage.removeItem(k)); } catch (_) {}
      location.replace("index.html?saiu=1");
    });
    LUMI.sb?.auth.onAuthStateChange((ev) => {
      if (ev === "SIGNED_OUT" && LUMI.user && !LUMI.loggingOut) location.replace("index.html?sessao=expirada&redirect=" + encodeURIComponent(page));
    });
    const p = LUMI.profile;
    const name = p?.display_name || LUMI.user?.user_metadata?.display_name || LUMI.user?.email?.split("@")[0] || "Visitante";
    const n = document.getElementById("sidebar-name");
    if (n) n.textContent = name;
    const a = document.getElementById("sidebar-avatar");
    if (a) {
      if (p?.avatar_url) a.innerHTML = `<img src="${esc(p.avatar_url)}" alt="">`;
      else a.textContent = LUMI.initials(name);
    }
    syncThemeWithProfile();
    startPresence();
    watchBadges();
    pendingDocs();
    if (LUMI.isAdmin && !document.querySelector('[data-nav="admin"]')) {
      document.getElementById("lsbNav")?.insertAdjacentHTML("beforeend", linkHtml(["admin", "admin.html", "Administração"]));
    }
    if (!LUMI.user) {
      document.querySelector(".lsb-pair")?.remove();
      document.querySelectorAll('[data-nav="notificacoes"],[data-nav="salvos"],[data-nav="atividades"],[data-nav="conquistas"]').forEach((a) => a.remove());
      const btn = document.getElementById("openSettings");
      if (btn) { btn.textContent = "Entrar ou criar conta"; btn.onclick = () => (location.href = "index.html"); }
      const me = document.querySelector(".lsb-me");
      if (me) me.setAttribute("href", "index.html");
    }
  }

  const start = () => { buildSidebar(); fillSidebar(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
