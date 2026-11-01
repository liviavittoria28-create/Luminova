/* LUMINOVA 3.x — landing: entrar, criar conta (com verificação de nome de usuário) e recuperar senha. */
(() => {
  "use strict";
  const A = window.LUMI_AUTH;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const sb = window.luminovaCreateClient();
  const params = new URLSearchParams(location.search);
  const redirectTo = A.safeRedirect(params.get("redirect"), "geral.html");

  // ---------------------------------------------------------------- visual
  if (window.LUMI_THEME) {
    $("#lpLogo").outerHTML = LUMI_THEME.logo(28, "lp");
    $("#themeSlot").replaceWith(LUMI_THEME.makeToggle("lumi-theme-fab lp-theme", false));
  }

  // ---------------------------------------------------------------- alertas e campos
  const alertBox = $("#authAlert");
  function alertMsg(text, kind = "err", html = false) {
    if (!text) { alertBox.hidden = true; return; }
    alertBox.className = "l3-alert " + kind;
    alertBox[html ? "innerHTML" : "textContent"] = text;
    alertBox.hidden = false;
    alertBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function hint(id, text, kind = "err") {
    const el = document.getElementById(id + "Hint");
    const input = document.getElementById(id);
    if (el) { el.textContent = text || ""; el.className = "l3-hint" + (text ? " " + kind : ""); }
    if (input) input.setAttribute("aria-invalid", text && kind === "err" ? "true" : "false");
  }
  function busy(form, on, label) {
    const b = form.querySelector('[type="submit"]');
    if (!b) return;
    if (on) { b.dataset.t = b.textContent; b.textContent = label; b.disabled = true; }
    else { b.textContent = b.dataset.t || b.textContent; b.disabled = false; }
  }

  // ---------------------------------------------------------------- troca de painel
  const VIEWS = { login: ["#viewLogin", "Entrar"], signup: ["#viewSignup", "Criar conta"], forgot: ["#viewForgot", "Recuperar senha"] };
  function show(view, focus = true) {
    Object.entries(VIEWS).forEach(([k, [sel]]) => ($(sel).hidden = k !== view));
    $("#authTitle").textContent = VIEWS[view][1];
    $("#tabLogin").setAttribute("aria-selected", String(view === "login"));
    $("#tabSignup").setAttribute("aria-selected", String(view === "signup"));
    alertMsg("");
    if (focus) {
      $("#auth").scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => $(VIEWS[view][0] + " input")?.focus({ preventScroll: true }), 250);
    }
  }
  $$("[data-view]").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  $$("[data-toggle-pw]").forEach((b) => b.addEventListener("click", () => {
    const i = document.getElementById(b.dataset.togglePw), vis = i.type === "password";
    i.type = vis ? "text" : "password"; b.textContent = vis ? "Ocultar" : "Mostrar"; b.setAttribute("aria-label", vis ? "Ocultar senha" : "Mostrar senha");
  }));
  try { $("#remember").checked = localStorage.getItem("luminova-remember") === "1"; } catch (_) {}

  if (!sb) { alertMsg("Não foi possível carregar o serviço de contas. Verifique sua conexão e recarregue a página."); return; }

  // estados vindos da URL
  const uerr = A.urlError();
  if (uerr) alertMsg(A.friendly(uerr));
  else if (params.get("sessao") === "expirada") alertMsg("Sua sessão expirou. Entre novamente para continuar.", "");
  else if (params.get("senha") === "redefinida") alertMsg("Senha atualizada. Entre com a nova senha.", "ok");
  else if (params.get("saiu") === "1") alertMsg("Você saiu da sua conta.", "ok");
  else if (params.get("conta") === "excluida") alertMsg("Sua conta foi excluída. Sentiremos sua falta.", "ok");
  if (params.get("modo") === "cadastro" || location.hash === "#cadastro") show("signup", false);
  if (params.get("redirect")) show("login", false);
  if (params.get("modo") === "recuperar") show("forgot", false);

  // já está logado? segue para o destino
  sb.auth.getSession().then(({ data }) => { if (data?.session && !uerr && !params.get("saiu")) location.replace(redirectTo); });

  // ---------------------------------------------------------------- ENTRAR
  $("#viewLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget, email = $("#loginEmail").value.trim().toLowerCase(), pass = $("#loginPass").value;
    hint("loginEmail", ""); hint("loginPass", ""); alertMsg("");
    let bad = false;
    if (!email) { hint("loginEmail", "Informe seu e-mail."); bad = true; }
    else if (!A.EMAIL_RE.test(email)) { hint("loginEmail", "Esse e-mail não parece válido."); bad = true; }
    if (!pass) { hint("loginPass", "Informe sua senha."); bad = true; }
    if (bad) return form.querySelector('[aria-invalid="true"]')?.focus();
    try { localStorage.setItem("luminova-remember", $("#remember").checked ? "1" : "0"); } catch (_) {}
    busy(form, true, "Entrando…");
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      // a sessão foi criada no armazenamento antigo: se "manter conectado" mudou, copia para o novo
      try {
        const [from, to] = $("#remember").checked ? [sessionStorage, localStorage] : [localStorage, sessionStorage];
        Object.keys(from).filter((k) => k.startsWith("sb-")).forEach((k) => { to.setItem(k, from.getItem(k)); from.removeItem(k); });
      } catch (_) {}
      const { data } = await sb.rpc("luminova_pending_documents");
      location.href = data && data.length ? "configuracoes.html?aceitar=1#privacidade" : redirectTo;
    } catch (err) {
      alertMsg(A.friendly(err, "entrar"));
      if (/confirmad/.test(A.friendly(err))) alertBox.insertAdjacentHTML("beforeend", ' <button type="button" class="l3-link" id="resendConf">Reenviar e-mail de confirmação</button>');
      $("#resendConf")?.addEventListener("click", async () => {
        const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: location.origin + "/boas-vindas.html" } });
        alertMsg(error ? A.friendly(error, "reenviar") : "Se houver uma conta pendente com esse e-mail, um novo link de confirmação foi enviado.", error ? "err" : "ok");
      });
    } finally { busy(form, false); }
  });

  // ---------------------------------------------------------------- CADASTRO: nome de usuário ao vivo
  let userTimer = null, userState = { value: "", ok: false };
  const sugBox = $("#suUserSuggest");
  async function checkUsername() {
    const u = A.normalizeUsername($("#suUser").value);
    sugBox.innerHTML = "";
    const problem = A.usernameProblem(u);
    if (problem) { hint("suUser", problem); userState = { value: u, ok: false }; return false; }
    hint("suUser", "Verificando disponibilidade…", "");
    const { data: free, error } = await sb.rpc("luminova_username_available", { candidate: u });
    if (A.normalizeUsername($("#suUser").value) !== u) return false; // a pessoa continuou digitando
    if (error) { hint("suUser", "Não deu para verificar agora; vamos conferir ao criar a conta.", ""); userState = { value: u, ok: true }; return true; }
    if (free) { hint("suUser", `@${u} está disponível.`, "ok"); userState = { value: u, ok: true }; return true; }
    hint("suUser", `O nome @${u} já está em uso.`);
    userState = { value: u, ok: false };
    const { data: sug } = await sb.rpc("luminova_suggest_usernames", { candidate: u, how_many: 3 });
    if (sug?.length) {
      sugBox.innerHTML = '<span class="l3-small">Disponíveis agora:</span>' + sug.map((s) => `<button type="button" data-sug="${s}">@${s}</button>`).join("");
      sugBox.querySelectorAll("[data-sug]").forEach((b) => b.addEventListener("click", () => { $("#suUser").value = b.dataset.sug; checkUsername(); }));
    }
    return false;
  }
  $("#suUser").addEventListener("input", (e) => {
    const clean = e.target.value.replace(/\s+/g, "");
    if (clean !== e.target.value) e.target.value = clean;
    clearTimeout(userTimer); userTimer = setTimeout(checkUsername, 450);
  });
  $("#suName").addEventListener("blur", () => {
    const u = $("#suUser");
    if (!u.value && $("#suName").value.trim()) {
      u.value = $("#suName").value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 24);
      checkUsername();
    }
  });
  $("#suPass").addEventListener("input", (e) => {
    const s = A.passwordScore(e.target.value), m = $("#suMeter");
    m.style.width = (s / 4) * 100 + "%";
    m.style.background = ["#c2264d", "#c2264d", "#d98a00", "#2f8f1f", "#1f9a6e"][s];
    hint("suPass", e.target.value ? ["Muito fraca", "Fraca", "Razoável", "Boa", "Forte"][s] : "Mínimo de 8 caracteres, com letras e números.", s >= 3 ? "ok" : "");
  });

  // ---------------------------------------------------------------- CADASTRO: envio
  $("#viewSignup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = $("#suName").value.trim(), username = A.normalizeUsername($("#suUser").value);
    const email = $("#suEmail").value.trim().toLowerCase(), pass = $("#suPass").value, pass2 = $("#suPass2").value;
    ["suName", "suEmail", "suPass2", "suLegal"].forEach((k) => hint(k, ""));
    alertMsg("");
    let first = null;
    const fail = (id, msg) => { hint(id, msg); first = first || document.getElementById(id); };
    if (name.length < 2) fail("suName", "Informe seu nome (pelo menos 2 letras).");
    const up = A.usernameProblem(username); if (up) fail("suUser", up);
    if (!email) fail("suEmail", "Informe seu e-mail."); else if (!A.EMAIL_RE.test(email)) fail("suEmail", "Esse e-mail não parece válido.");
    const pp = A.passwordProblem(pass); if (pp) fail("suPass", pp);
    if (!pass2) fail("suPass2", "Repita a senha."); else if (pass !== pass2) fail("suPass2", "As senhas não são iguais.");
    if (!$("#suTerms").checked || !$("#suPrivacy").checked) { hint("suLegal", "Para criar a conta, aceite os Termos e confirme que leu a Política de Privacidade."); first = first || $("#suTerms"); }
    if (first) return first.focus();
    busy(form, true, "Verificando…");
    if (!(userState.value === username && userState.ok) && !(await checkUsername())) { busy(form, false); return $("#suUser").focus(); }
    busy(form, false); busy(form, true, "Criando conta…");
    try {
      const { data, error } = await sb.auth.signUp({
        email, password: pass,
        options: {
          emailRedirectTo: location.origin + "/boas-vindas.html",
          data: { name, display_name: name, username, terms_version: A.TERMS_VERSION, privacy_version: A.PRIVACY_VERSION, consent_at: new Date().toISOString() },
        },
      });
      if (error) throw error;
      // Supabase devolve usuário sem identidades quando o e-mail já existe (proteção contra enumeração)
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        alertMsg('Este e-mail já tem uma conta na LUMINOVA. <button type="button" class="l3-link" data-go="login">Entrar</button> ou <button type="button" class="l3-link" data-go="forgot">recuperar a senha</button>.', "err", true);
        alertBox.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => { show(b.dataset.go); $(b.dataset.go === "login" ? "#loginEmail" : "#fgEmail").value = email; }));
        return;
      }
      if (data?.session) { location.href = "boas-vindas.html"; return; }
      form.reset(); $("#suMeter").style.width = "0"; sugBox.innerHTML = ""; hint("suUser", "");
      alertMsg(`Quase lá! Enviamos um link de confirmação para <strong>${email.replace(/[<>&"]/g, "")}</strong>. Abra o e-mail (confira o spam) para ativar a conta.`, "ok", true);
    } catch (err) {
      alertMsg(A.friendly(err, "criar a conta"));
    } finally { busy(form, false); }
  });

  // ---------------------------------------------------------------- RECUPERAR SENHA (mensagem neutra)
  $("#viewForgot").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget, email = $("#fgEmail").value.trim().toLowerCase();
    hint("fgEmail", "");
    if (!A.EMAIL_RE.test(email)) { hint("fgEmail", "Informe um e-mail válido."); return $("#fgEmail").focus(); }
    busy(form, true, "Enviando…");
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/redefinir-senha.html" });
      if (error && !/rate|too many|security purposes/i.test(error.message)) {
        // erros de "e-mail não encontrado" nunca são exibidos: a resposta é sempre a mesma
        if (!/not found|no user/i.test(error.message)) throw error;
      } else if (error) throw error;
      alertMsg("Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha. Ele vale por tempo limitado; confira também o spam.", "ok");
      form.reset();
    } catch (err) { alertMsg(A.friendly(err, "enviar o e-mail")); }
    finally { busy(form, false); }
  });
})();
