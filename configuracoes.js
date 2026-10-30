/* LUMINOVA 3.x — central de configurações e privacidade. Tudo lido e gravado no Supabase com RLS. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  let sb, me, prefs = null;
  const esc = (v) => LUMI.esc(v);
  const flash = (t, k = "ok") => { const a = $("#cfgAlert"); a.className = "l3-alert " + k; a.textContent = t; a.hidden = !t; if (t) a.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
  const KIND = { name: "Nome", likes: "Gosta de", dislikes: "Não curte", location: "Mora em", fact: "Fato", topic: "Assunto", summary: "Resumo" };
  const REQ = { access: "Acesso", correction: "Correção", information: "Informação", revoke_consent: "Revogação", portability: "Portabilidade", deletion: "Exclusão", export: "Exportação", other: "Outro" };
  const STATUS = { open: "Aberta", in_progress: "Em andamento", done: "Concluída", rejected: "Recusada" };

  // ---------------------------------------------------------------- conta
  function fillAccount() {
    $("#cfgEmail").textContent = me.email || "—";
    $("#cfgUser").textContent = LUMI.profile?.username ? "@" + LUMI.profile.username : "ainda não definido";
    $("#cfgSince").textContent = me.created_at ? new Date(me.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "—";
    $("#pwForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const A = window.LUMI_AUTH, p1 = $("#pwNew").value, p2 = $("#pwNew2").value;
      const prob = A.passwordProblem(p1), mism = p1 !== p2 ? "As senhas não são iguais." : "";
      $("#pwNewHint").textContent = prob; $("#pwNewHint").className = "l3-hint" + (prob ? " err" : "");
      $("#pwNew2Hint").textContent = mism; $("#pwNew2Hint").className = "l3-hint" + (mism ? " err" : "");
      if (prob || mism) return;
      const { error } = await sb.auth.updateUser({ password: p1 });
      if (error) return flash(A.friendly(error, "trocar a senha"), "err");
      e.target.reset(); flash("Senha atualizada.");
    });
  }

  // ---------------------------------------------------------------- preferências
  async function loadPrefs() {
    let { data } = await sb.from("user_preferences").select("*").eq("user_id", me.id).maybeSingle();
    if (!data) {
      const ins = await sb.from("user_preferences").insert({ user_id: me.id }).select("*").single();
      data = ins.data;
    }
    prefs = data || { dm_policy: "everyone", discoverable: true, allow_ai_memory: false, allow_ai_dm: true, show_ai_content: true, personalization: true };
    document.querySelectorAll("[data-pref]").forEach((i) => (i.checked = !!prefs[i.dataset.pref]));
    $("#pDm").value = prefs.dm_policy || "everyone";
    $("#pPrivate").checked = LUMI.profile?.account_visibility === "private";
  }
  async function savePref(patch, el) {
    if (el) el.disabled = true;
    const { error } = await sb.from("user_preferences").update(patch).eq("user_id", me.id);
    if (el) el.disabled = false;
    if (error) { flash("Não foi possível salvar. Tente de novo.", "err"); return false; }
    Object.assign(prefs, patch);
    try { if ("show_ai_content" in patch) localStorage.setItem("luminova-hide-ai", patch.show_ai_content ? "0" : "1"); } catch (_) {}
    flash("Preferência salva.");
    return true;
  }
  function bindPrefs() {
    document.querySelectorAll("[data-pref]").forEach((i) => i.addEventListener("change", async () => {
      const key = i.dataset.pref;
      if (key === "allow_ai_memory" && !i.checked && !confirm("Desligar a memória apaga tudo o que os agentes lembram sobre você. Continuar?")) { i.checked = true; return; }
      if (!(await savePref({ [key]: i.checked }, i))) i.checked = !i.checked;
      if (key === "allow_ai_memory") loadMemories();
    }));
    $("#pDm").addEventListener("change", (e) => savePref({ dm_policy: e.target.value }, e.target));
    $("#pPrivate").addEventListener("change", async (e) => {
      const v = e.target.checked ? "private" : "public";
      const { error } = await sb.from("profiles").update({ account_visibility: v }).eq("id", me.id);
      if (error) { e.target.checked = !e.target.checked; return flash("Não foi possível alterar a visibilidade.", "err"); }
      if (LUMI.profile) LUMI.profile.account_visibility = v;
      flash(v === "private" ? "Conta privada: só seguidores veem suas publicações." : "Conta pública.");
    });
  }

  // ---------------------------------------------------------------- memórias da NOVA BRAIN
  async function loadMemories() {
    const host = $("#memList");
    const { data, error } = await sb.from("ai_agent_memories").select("id,agent_id,kind,content,created_at,expires_at").order("created_at", { ascending: false });
    if (error) { host.innerHTML = '<p class="l3-small">Não foi possível carregar as memórias.</p>'; return; }
    const ids = [...new Set((data || []).map((m) => m.agent_id))];
    if (ids.length) {
      const { data: ag } = await sb.from("profiles").select("id,display_name").in("id", ids);
      const byId = Object.fromEntries((ag || []).map((a) => [a.id, a]));
      data.forEach((m) => (m.agent = byId[m.agent_id]));
    }
    if (!data?.length) { host.innerHTML = `<p class="l3-small">${prefs?.allow_ai_memory ? "Nenhum agente guardou nada sobre você ainda." : "Memória desligada: nenhum agente guarda nada sobre você entre conversas."}</p>`; return; }
    host.innerHTML = `<ul class="l3-list">${data.map((m) => `<li><span><strong>${esc(m.agent?.display_name || "Agente")}</strong> · ${esc(KIND[m.kind] || m.kind)}: ${esc(m.content)}<br><span class="l3-small">Guardado em ${esc(LUMI.time(m.created_at))} · expira em ${esc(new Date(m.expires_at).toLocaleDateString("pt-BR"))}</span></span><button class="l3-btn ghost sm" data-forget="${esc(m.id)}">Apagar</button></li>`).join("")}</ul>
      <button class="l3-btn ghost sm" id="forgetAll" style="margin-top:10px">Apagar todas</button>`;
    host.querySelectorAll("[data-forget]").forEach((b) => b.addEventListener("click", async () => { await sb.from("ai_agent_memories").delete().eq("id", b.dataset.forget); loadMemories(); }));
    $("#forgetAll")?.addEventListener("click", async () => { await sb.from("ai_agent_memories").delete().eq("user_id", me.id); flash("Memórias apagadas."); loadMemories(); });
  }

  // ---------------------------------------------------------------- interesses
  async function loadInterests() {
    const host = $("#intList");
    const [all, mine] = await Promise.all([
      sb.from("interests").select("id,name,category").order("name"),
      sb.from("profile_interests").select("interest_id").eq("profile_id", me.id),
    ]);
    if (all.error) { host.innerHTML = '<p class="l3-small">Não foi possível carregar os interesses.</p>'; return; }
    const chosen = new Set((mine.data || []).map((r) => r.interest_id));
    host.innerHTML = all.data.map((i) => `<button type="button" class="l3-chip" data-int="${esc(i.id)}" aria-pressed="${chosen.has(i.id)}">${esc(i.name)}</button>`).join("");
    host.querySelectorAll("[data-int]").forEach((b) => b.addEventListener("click", async () => {
      const on = b.getAttribute("aria-pressed") === "true", id = b.dataset.int;
      b.disabled = true;
      const { error } = on ? await sb.from("profile_interests").delete().eq("profile_id", me.id).eq("interest_id", id)
                           : await sb.from("profile_interests").insert({ profile_id: me.id, interest_id: id });
      b.disabled = false;
      if (error && error.code !== "23505") return flash("Não foi possível salvar o interesse.", "err");
      b.setAttribute("aria-pressed", String(!on));
    }));
  }

  // ---------------------------------------------------------------- bloqueios
  async function loadBlocks() {
    const host = $("#blkList");
    const { data, error } = await sb.from("blocks").select("blocked_id,created_at,who:profiles!blocks_blocked_id_fkey(id,display_name,username,avatar_url,is_ai)").eq("blocker_id", me.id).order("created_at", { ascending: false });
    if (error) { host.innerHTML = '<p class="l3-small">Não foi possível carregar.</p>'; return; }
    if (!data.length) { host.innerHTML = '<p class="l3-small">Você não bloqueou ninguém.</p>'; return; }
    host.innerHTML = `<ul class="l3-list">${data.map((b) => `<li><span class="l3-row">${LUMI.avatar(b.who || {}, "blk-av", 34)}<span><strong>${esc(b.who?.display_name || "Perfil")}</strong><br><span class="l3-small">${b.who?.username ? "@" + esc(b.who.username) : ""} · desde ${esc(LUMI.time(b.created_at))}</span></span></span><button class="l3-btn ghost sm" data-unblock="${esc(b.blocked_id)}">Desbloquear</button></li>`).join("")}</ul>`;
    host.querySelectorAll("[data-unblock]").forEach((b) => b.addEventListener("click", async () => { try { await LUMI.unblock(b.dataset.unblock); loadBlocks(); } catch (x) { flash(x.message, "err"); } }));
  }

  // ---------------------------------------------------------------- documentos
  async function loadDocs() {
    const [mine, pend] = await Promise.all([
      sb.from("user_consents").select("doc_key,version,accepted_at,source").eq("user_id", me.id).order("accepted_at", { ascending: false }),
      sb.rpc("luminova_pending_documents"),
    ]);
    const title = { terms: "Termos de Uso", privacy: "Política de Privacidade" };
    $("#docList").innerHTML = mine.data?.length
      ? `<ul class="l3-list">${mine.data.map((c) => `<li><span><strong>${title[c.doc_key] || c.doc_key}</strong> · versão ${esc(c.version)}<br><span class="l3-small">Aceito em ${esc(LUMI.time(c.accepted_at))} (${c.source === "signup" ? "no cadastro" : "atualização"})</span></span></li>`).join("")}</ul>`
      : '<p class="l3-small">Nenhum aceite registrado (contas criadas antes da LUMINOVA 3.x). Aceite a versão atual abaixo.</p>';
    const p = pend.data || [];
    $("#docPending").innerHTML = p.length ? `<div class="l3-alert">Há ${p.length === 1 ? "um documento atualizado" : "documentos atualizados"}: ${p.map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)} (${esc(d.version)})</a>`).join(" e ")}.
      <div class="l3-row" style="margin-top:10px"><button class="l3-btn sm" id="acceptDocs">Li e aceito</button></div></div>` : "";
    $("#acceptDocs")?.addEventListener("click", async () => {
      const { error } = await sb.rpc("luminova_accept_current_documents", { p_source: "update" });
      if (error) return flash("Não foi possível registrar o aceite.", "err");
      flash("Aceite registrado."); loadDocs();
      document.querySelector(".lsb-docs")?.remove();
    });
  }

  // ---------------------------------------------------------------- dados: exportação e solicitações
  async function exportData() {
    const btn = $("#btnExport"); btn.disabled = true; btn.textContent = "Preparando…";
    try {
      const { data, error } = await sb.rpc("luminova_export_my_data");
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `luminova-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      flash("Arquivo gerado. Ele contém dados pessoais: guarde em local seguro.");
    } catch (e) { flash("Não foi possível gerar a exportação agora.", "err"); }
    finally { btn.disabled = false; btn.textContent = "Baixar meus dados (JSON)"; }
  }
  async function loadRequests() {
    const { data } = await sb.from("privacy_requests").select("*").eq("user_id", me.id).order("created_at", { ascending: false });
    $("#reqList").innerHTML = data?.length ? `<ul class="l3-list">${data.map((r) => `<li><span><strong>${esc(REQ[r.request_type] || r.request_type)}</strong> · ${esc(STATUS[r.status] || r.status)}<br><span class="l3-small">${esc(LUMI.time(r.created_at))}${r.response ? " · Resposta: " + esc(r.response) : ""}</span></span></li>`).join("")}</ul>` : '<p class="l3-small">Nenhuma solicitação feita.</p>';
  }
  function bindRequests() {
    $("#btnExport").addEventListener("click", exportData);
    $("#reqForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const det = $("#reqDet").value.trim();
      if (det.length < 10) { $("#reqDetHint").textContent = "Descreva o pedido com pelo menos 10 caracteres."; $("#reqDetHint").className = "l3-hint err"; return; }
      $("#reqDetHint").textContent = "";
      const { error } = await sb.from("privacy_requests").insert({ user_id: me.id, request_type: $("#reqType").value, details: det });
      if (error) return flash("Não foi possível enviar a solicitação.", "err");
      e.target.reset(); flash("Solicitação registrada. A resposta aparece aqui em até 15 dias."); loadRequests();
    });
  }

  // ---------------------------------------------------------------- exclusão de conta
  async function removeMyFiles() {
    // apaga os arquivos da pasta da pessoa nos dois buckets (a API de Storage não apaga pasta inteira de uma vez)
    let removed = 0;
    for (const bucket of ["profile-media", "community-media"]) {
      const stack = [me.id];
      while (stack.length) {
        const dir = stack.pop();
        const { data, error } = await sb.storage.from(bucket).list(dir, { limit: 1000 });
        if (error || !data) continue;
        const files = data.filter((x) => x.id).map((x) => `${dir}/${x.name}`);
        data.filter((x) => !x.id).forEach((x) => stack.push(`${dir}/${x.name}`));
        if (files.length) { const r = await sb.storage.from(bucket).remove(files); if (!r.error) removed += files.length; }
      }
    }
    return removed;
  }
  function bindDelete() {
    $("#btnDelete").addEventListener("click", () => {
      const uname = LUMI.profile?.username || "";
      LUMI.dialog({
        title: "Excluir conta definitivamente", confirm: "Excluir para sempre", danger: true,
        body: `<p style="margin:0 0 10px;line-height:1.55">Isso apaga sua conta e todo o seu conteúdo. Antes, se quiser, <button type="button" class="l3-link" id="dlExport">baixe seus dados</button>.</p>
          <div class="l3-field"><label for="delUser">Digite seu nome de usuário (<strong>${esc(uname)}</strong>) para confirmar</label><input id="delUser" name="user" autocomplete="off" spellcheck="false" /></div>
          <div class="l3-field"><label for="delWhy">Quer contar por que está saindo? (opcional, anônimo)</label><textarea id="delWhy" name="why" rows="2" maxlength="500"></textarea></div>`,
        onSubmit: async (f) => {
          if (!uname || f.user.value.trim().replace(/^@/, "").toLowerCase() !== uname.toLowerCase()) throw new Error("O nome de usuário não confere.");
          await removeMyFiles();
          const { error } = await sb.rpc("luminova_delete_my_account", { confirm_username: uname, p_reason: f.why.value.trim() });
          if (error) throw new Error("Não foi possível excluir a conta: " + (error.message || "tente de novo."));
          LUMI.loggingOut = true;
          try { await sb.auth.signOut(); } catch (_) {}
          try { localStorage.removeItem("luminova-remember"); } catch (_) {}
          location.replace("index.html?conta=excluida");
        },
      });
      $("#dlExport")?.addEventListener("click", exportData);
    });
  }

  // ---------------------------------------------------------------- navegação entre seções
  function bindTabs() {
    const links = [...document.querySelectorAll(".l3-tabs a")];
    const mark = () => { const h = location.hash || "#conta"; links.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === h))); };
    addEventListener("hashchange", mark); mark();
  }

  async function init() {
    if (!(await LUMI.requireLogin())) return;
    sb = LUMI.sb; me = LUMI.user;
    bindTabs(); fillAccount(); bindRequests(); bindDelete();
    await loadPrefs(); bindPrefs();
    await Promise.all([loadMemories(), loadInterests(), loadBlocks(), loadDocs(), loadRequests()]);
    if (new URLSearchParams(location.search).get("aceitar")) document.getElementById("documentos").scrollIntoView({ behavior: "smooth" });
    else if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }
  document.addEventListener("DOMContentLoaded", () => init().catch((e) => { console.error(e); flash("Erro ao carregar as configurações. Recarregue a página.", "err"); }));
})();
