/* LUMINOVA — rodas de cor para personalizar perfil e comunidade.
 * Substitui o seletor nativo e as paletas prontas: sobra só a roda (matiz + saturação) e um controle
 * de brilho. O <input type="color"> original continua no DOM, escondido, porque é nele que o resto do
 * código lê e grava o valor; cada mudança dispara "input", então contraste, prévia e salvar seguem iguais.
 */
(() => {
  "use strict";
  const SIZE = 352, R = SIZE / 2; // canvas em 2x para ficar nítido; o CSS mostra em ~176px
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  const toHex = ([r, g, b]) => "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");

  function hexToHsv(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return { h: 0, s: 0, v: 1 };
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  }

  function attach(input) {
    if (!input || input.dataset.wheel) return;
    input.dataset.wheel = "1";
    input.setAttribute("tabindex", "-1");
    input.setAttribute("aria-hidden", "true");

    const label = input.closest("label");
    const name = (label?.firstChild?.textContent || input.id || "cor").trim();

    const box = document.createElement("div");
    box.className = "lumi-wheel";
    box.innerHTML = `
      <canvas width="${SIZE}" height="${SIZE}" tabindex="0" role="slider" aria-label="Roda de cores — ${name}. Setas mudam a cor"
        aria-valuemin="0" aria-valuemax="360"></canvas>
      <div class="lumi-wheel-side">
        <label>Brilho
          <input type="range" min="8" max="100" value="100" aria-label="Brilho — ${name}"></label>
        <div class="lumi-wheel-chip">
          <span class="ln-wheel-prev" aria-hidden="true"></span>
          <code class="ln-wheel-hex"></code>
        </div>
      </div>`;
    // A roda fica logo depois do rótulo (fora dele, para o clique não abrir o seletor nativo).
    (label || input).insertAdjacentElement("afterend", box);

    const canvas = box.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const slider = box.querySelector('input[type="range"]');
    const hexLabel = box.querySelector(".ln-wheel-hex");
    const preview = box.querySelector(".ln-wheel-prev");
    let st = hexToHsv(input.value);
    let emitting = false, dragging = false;

    function drawWheel() {
      const img = ctx.createImageData(SIZE, SIZE);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const dx = x + 0.5 - R, dy = y + 0.5 - R, d = Math.hypot(dx, dy), i = (y * SIZE + x) * 4;
          if (d > R) { img.data[i + 3] = 0; continue; }
          const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
          const [r, g, b] = hsvToRgb(h, clamp(d / R, 0, 1), st.v);
          img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
          img.data[i + 3] = d > R - 1 ? Math.round(255 * (R - d)) : 255; // borda suave
        }
      }
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.putImageData(img, 0, 0);
      // brilho de vidro por cima da roda
      const gl = ctx.createLinearGradient(0, 0, 0, SIZE);
      gl.addColorStop(0, "rgba(255,255,255,.38)"); gl.addColorStop(0.5, "rgba(255,255,255,0)");
      ctx.save(); ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = gl; ctx.fillRect(0, 0, SIZE, SIZE); ctx.restore();
      // marcador
      const rad = (st.h * Math.PI) / 180, mx = R + Math.cos(rad) * st.s * R, my = R + Math.sin(rad) * st.s * R;
      ctx.beginPath(); ctx.arc(mx, my, 15, 0, Math.PI * 2);
      ctx.fillStyle = toHex(hsvToRgb(st.h, st.s, st.v)); ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(0,40,90,.55)"; ctx.stroke();
    }

    function paintLabels() {
      const hex = toHex(hsvToRgb(st.h, st.s, st.v));
      hexLabel.textContent = hex;
      preview.style.background = hex;
      slider.value = Math.round(st.v * 100);
      canvas.setAttribute("aria-valuenow", String(Math.round(st.h)));
      canvas.setAttribute("aria-valuetext", hex);
    }

    function emit() {
      const hex = toHex(hsvToRgb(st.h, st.s, st.v));
      paintLabels();
      if (input.value.toLowerCase() === hex) return;
      emitting = true;
      input.value = hex;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      emitting = false;
    }

    function sync() { st = hexToHsv(input.value); drawWheel(); paintLabels(); }

    function pick(e) {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) * SIZE) / rect.width - R;
      const y = ((e.clientY - rect.top) * SIZE) / rect.height - R;
      const d = Math.min(Math.hypot(x, y), R);
      st = { ...st, h: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360, s: d / R };
      drawWheel(); emit();
    }

    canvas.addEventListener("pointerdown", (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); pick(e); });
    canvas.addEventListener("pointermove", (e) => { if (dragging) pick(e); });
    canvas.addEventListener("pointerup", () => { dragging = false; });
    canvas.addEventListener("pointercancel", () => { dragging = false; });
    // teclado: ←/→ matiz, ↑/↓ saturação
    canvas.addEventListener("keydown", (e) => {
      const k = e.key; let used = true;
      if (k === "ArrowLeft") st = { ...st, h: (st.h + 354) % 360 };
      else if (k === "ArrowRight") st = { ...st, h: (st.h + 6) % 360 };
      else if (k === "ArrowUp") st = { ...st, s: clamp(st.s + 0.05, 0, 1) };
      else if (k === "ArrowDown") st = { ...st, s: clamp(st.s - 0.05, 0, 1) };
      else used = false;
      if (used) { e.preventDefault(); drawWheel(); emit(); }
    });
    slider.addEventListener("input", () => { st = { ...st, v: Number(slider.value) / 100 }; drawWheel(); emit(); });

    // mudanças vindas de fora (carregar perfil, trocar tema) atualizam a roda
    input.addEventListener("input", () => { if (!emitting) sync(); });
    const mo = new MutationObserver(() => { if (!emitting) sync(); });
    mo.observe(input, { attributes: true, attributeFilter: ["value"] });
    // quando o valor é gravado por código (input.value = ...), nenhum evento dispara: confere ao abrir
    const modal = input.closest(".modal-backdrop, .modal, [role=dialog]");
    if (modal) new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ["class", "aria-hidden"] });
    sync();
  }

  function attachAll() {
    ["#pageBgInput", "#accentInput", "#cardBgInput", "#textColorInput"].forEach((sel) => attach(document.querySelector(sel)));
  }

  window.LUMI_WHEEL = { attach, hexToHsv, hsvToRgb, toHex };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachAll);
  else attachAll();
})();
