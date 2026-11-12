/* LUMINOVA — ações sociais compartilhadas: denunciar, bloquear/desbloquear e diálogos de confirmação.
 * Depende de luminova-sidebar.js (window.LUMI). Tudo grava direto no Supabase e respeita as regras RLS. */
(() => {
  "use strict";
  const L = window.LUMI;
  if (!L) return;
  const esc = L.esc;

  const REASONS = [
    ["spam", "Spam ou propaganda enganosa"],
    ["harassment", "Assédio ou bullying"],
    ["hate", "Discurso de ódio ou discriminação"],
    ["inappropriate", "Conteúdo impróprio ou sexual"],
    ["misinformation", "Informação falsa que pode causar dano"],
    ["impersonation", "Se passa por outra pessoa"],
    ["other", "Outro motivo"],
  ];
  const TARGET = { post: "publicação", comment: "comentário", profile: "perfil", community: "comunidade", message: "mensagem", community_message: "mensagem do chat" };

  /** Diálogo genérico. Retorna a <section> criada; `onSubmit(form)` pode lançar erro para mostrar ao usuário. */
  function dialog({ title, body, confirm = "Confirmar", danger = false, onSubmit }) {
    const wrap = document.createElement("div");
    wrap.className = "l3-modal open";
    wrap.innerHTML = `<form class="l3-win" role="dialog" aria-modal="true" aria-labelledby="dlgT">
      <div class="l3-win-h"><span id="dlgT">${esc(title)}</span><button type="button" class="l3-modal-x" data-x aria-label="Fechar">×</button></div>
      <div class="l3-win-b">${body}<div class="l3-alert err" data-err hidden></div>
        <div class="l3-row" style="justify-content:flex-end;margin-top:6px">
          <button type="button" class="l3-btn ghost" data-x>Cancelar</button>
          <button type="submit" class="l3-btn${danger ? " danger" : ""}">${esc(confirm)}</button></div></div></form>`;
    const prev = document.activeElement;
    const close = () => { wrap.remove(); prev?.focus?.(); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-x]")) close(); });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    const form = wrap.querySelector("form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]'), err = form.querySelector("[data-err]");
      btn.disabled = true; err.hidden = true;
      try { await onSubmit?.(form); close(); }
      catch (x) { err.textContent = x.message || String(x); err.hidden = false; btn.disabled = false; }
    });
    document.body.append(wrap);
    (form.querySelector("textarea,select,input") || form.querySelector('[type="submit"]')).focus();
    return wrap;
  }

  function friendlyDb(error) {
    const m = String(error?.message || error || "");
    if (/duplicate key|reports_one_open/.test(m)) return "Você já denunciou este conteúdo; a denúncia está em análise.";
    if (/Muitas ações/.test(m)) return m;
    if (/row-level security|permission denied|não pode/.test(m)) return "Você não tem permissão para fazer isso.";
    if (/Failed to fetch|NetworkError/.test(m)) return "Sem conexão. Tente de novo.";
    return m.replace(/^.*?:\s*/, "") || "Não foi possível concluir. Tente de novo.";
  }

  L.report = (targetType, targetId) => {
    if (!L.user) return L.toast("Entre na sua conta para denunciar.");
    dialog({
      title: `Denunciar ${TARGET[targetType] || "conteúdo"}`,
      confirm: "Enviar denúncia",
      body: `<p class="l3-muted" style="margin:0 0 12px;line-height:1.5">A equipe de moderação vai analisar. Quem você denunciou não sabe quem fez a denúncia.</p>
        <fieldset style="border:0;padding:0;margin:0 0 12px"><legend class="l3-label" style="margin-bottom:6px">Motivo</legend>
        ${REASONS.map(([v, l], i) => `<label class="l3-check"><input type="radio" name="reason" value="${v}"${i === 0 ? " checked" : ""}> ${l}</label>`).join("")}</fieldset>
        <div class="l3-field"><label for="rpDet">Detalhes (opcional)</label><textarea id="rpDet" name="details" rows="3" maxlength="1000"></textarea></div>`,
      onSubmit: async (f) => {
        const { error } = await L.sb.from("reports").insert({ reporter_id: L.user.id, target_type: targetType, target_id: targetId, reason: f.reason.value, details: f.details.value.trim() });
        if (error) throw new Error(friendlyDb(error));
        L.toast("Denúncia enviada. Obrigado por ajudar a cuidar da comunidade.");
      },
    });
  };

  L.isBlocked = async (userId) => {
    if (!L.user) return false;
    const { data } = await L.sb.from("blocks").select("blocked_id").eq("blocker_id", L.user.id).eq("blocked_id", userId).maybeSingle();
    return !!data;
  };
  L.block = (userId, name, after) => {
    if (!L.user) return L.toast("Entre na sua conta para bloquear.");
    dialog({
      title: `Bloquear ${name || "perfil"}`, confirm: "Bloquear", danger: true,
      body: `<p style="margin:0 0 8px;line-height:1.55">Ao bloquear:</p><ul style="margin:0 0 12px;padding-left:20px;line-height:1.6" class="l3-muted">
        <li>vocês deixam de ver as publicações um do outro;</li><li>ninguém consegue iniciar conversa ou enviar mensagem;</li>
        <li>vocês deixam de se seguir;</li><li>a pessoa não é avisada.</li></ul><p class="l3-small">Você pode desbloquear em Configurações › Bloqueios.</p>`,
      onSubmit: async () => {
        const { error } = await L.sb.from("blocks").insert({ blocker_id: L.user.id, blocked_id: userId });
        if (error && error.code !== "23505") throw new Error(friendlyDb(error));
        await L.sb.from("follows").delete().eq("follower_id", L.user.id).eq("followed_id", userId);
        L.toast("Perfil bloqueado.");
        after?.(true);
      },
    });
  };
  L.unblock = async (userId) => {
    const { error } = await L.sb.from("blocks").delete().eq("blocker_id", L.user.id).eq("blocked_id", userId);
    if (error) throw new Error(friendlyDb(error));
    L.toast("Perfil desbloqueado.");
  };
  L.dialog = dialog;
  L.friendlyDb = friendlyDb;
})();
