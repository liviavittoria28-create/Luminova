/* LUMINOVA — tema claro/escuro + identidade "aero".
 * Carregue ESTE arquivo no <head>, sem defer: ele aplica o tema antes da primeira pintura (sem piscar).
 * A escolha fica em localStorage ("luminova-theme"). Sem escolha salva, segue o sistema; se o sistema
 * não disser nada, usa o claro (a identidade aero nasce no céu azul).
 */
(() => {
  "use strict";
  const KEY = "luminova-theme";
  const root = document.documentElement;

  // Cores "de fábrica" de cada tema. As páginas de perfil/comunidade usam isto quando a pessoa
  // ainda não escolheu cor própria — assim o modo claro/escuro funciona sem apagar personalizações.
  const DEFAULTS = {
    light: { page: "#cfe6f9", accent: "#1f6fc5", card: "#f2f8fe", text: "#12324f" },
    dark: { page: "#071a33", accent: "#4aa8f0", card: "#0d2748", text: "#e4f0fc" },
  };

  const read = () => {
    try { const v = localStorage.getItem(KEY); if (v === "light" || v === "dark") return v; } catch (_) {}
    try { if (matchMedia("(prefers-color-scheme: dark)").matches) return "dark"; } catch (_) {}
    return "light";
  };

  // marca: quadrado de vidro com a estrela de quatro pontas (bordas retas, sem brilho de bolha)
  const LOGO = (size = 28, id = "lg") => `<svg class="lumi-logo-mark" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${id}-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d8fe0"/><stop offset="1" stop-color="#06407f"/></linearGradient>
      <linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity=".08"/></linearGradient>
    </defs>
    <rect x="2" y="2" width="60" height="60" fill="url(#${id}-b)"/>
    <path d="M2 2h60v26L2 40z" fill="url(#${id}-g)"/>
    <rect x="2.75" y="2.75" width="58.5" height="58.5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.5"/>
    <path d="M32 9l3.1 19.9L55 32l-19.9 3.1L32 55l-3.1-19.9L9 32l19.9-3.1z" fill="#fff"/>
  </svg>`;

  const state = { theme: read() };

  // persist: gesto da pessoa (grava o cache local e avisa quem quiser salvar no perfil).
  // fromDb: veio do perfil no Supabase (só atualiza o cache, sem regravar no banco).
  function apply(theme, persist, fromDb) {
    state.theme = theme === "dark" ? "dark" : "light";
    root.setAttribute("data-theme", state.theme);
    root.style.colorScheme = state.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", state.theme === "dark" ? "#071a33" : "#2f7fcf");
    if (persist || fromDb) { try { localStorage.setItem(KEY, state.theme); } catch (_) {} }
    document.querySelectorAll("[data-theme-toggle]").forEach(paintToggle);
    window.dispatchEvent(new CustomEvent("luminova:theme", { detail: { theme: state.theme, defaults: DEFAULTS[state.theme], userAction: !!persist } }));
  }

  function paintToggle(btn) {
    const dark = state.theme === "dark";
    btn.setAttribute("aria-pressed", String(dark));
    btn.setAttribute("aria-label", dark ? "Mudar para o modo claro" : "Mudar para o modo escuro");
    const label = btn.querySelector("[data-theme-label]");
    if (label) label.textContent = dark ? "Modo claro" : "Modo escuro";
  }

  const ICO = (d) => `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true">${d}</svg>`;
  const SUN = ICO('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>');
  const MOON = ICO('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>');
  // Interruptor: trilho retangular com sol e lua.
  function toggleHtml(withLabel) {
    return `<span class="lumi-switch" aria-hidden="true"><span class="lumi-switch-sun">${SUN}</span><span class="lumi-switch-moon">${MOON}</span><span class="lumi-switch-knob"></span></span>${withLabel ? '<span data-theme-label></span>' : ""}`;
  }
  function makeToggle(className, withLabel) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.setAttribute("data-theme-toggle", "");
    b.innerHTML = toggleHtml(withLabel);
    b.addEventListener("click", () => apply(state.theme === "dark" ? "light" : "dark", true));
    paintToggle(b);
    return b;
  }

  // favicon novo (marca de vidro) em todas as páginas
  function setFavicon() {
    document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"],link[rel="shortcut icon"]').forEach((l) => l.remove());
    const l = document.createElement("link");
    l.rel = "icon"; l.type = "image/svg+xml"; l.href = "favicon.svg";
    document.head.append(l);
  }

  apply(state.theme, false);
  window.LUMI_THEME = {
    get theme() { return state.theme; },
    set: (t) => apply(t, true),
    sync: (t) => apply(t, false, true),
    toggle: () => apply(state.theme === "dark" ? "light" : "dark", true),
    defaults: () => ({ ...DEFAULTS[state.theme] }),
    allDefaults: DEFAULTS,
    logo: LOGO,
    makeToggle,
    // cor do texto sobre o destaque (claro/escuro) conforme a luminância da cor escolhida
    onAccent: (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#ffffff";
      const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      const L = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      return L > 0.32 ? "#05283a" : "#ffffff";
    },
  };

  const ready = () => { apply(state.theme, false); setFavicon(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();

  // se a pessoa nunca escolheu, acompanha o sistema
  try {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      let saved = null; try { saved = localStorage.getItem(KEY); } catch (_) {}
      if (!saved) apply(e.matches ? "dark" : "light", false);
    });
  } catch (_) {}
})();
