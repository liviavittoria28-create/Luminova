const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

console.log("script.js carregado ✔");

const toast = (msg) => {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2600);
};

(function initScreens() {
  const sWelcome = $("#screenWelcome");
  const sLogin = $("#screenLogin");
  const goLogin = $("#goLogin");
  const backHome = $("#backHome");
  if (!sWelcome || !sLogin || !goLogin || !backHome) return;

  goLogin.addEventListener("click", () => {
    sWelcome.classList.remove("is-active");
    sLogin.classList.add("is-active");
  });

  backHome.addEventListener("click", () => {
    sLogin.classList.remove("is-active");
    sWelcome.classList.add("is-active");
  });
})();

(function initTogglePw() {
  const pw = $("#pass");
  const tog = $("#togglePw");
  if (!pw || !tog) return;

  tog.addEventListener("click", () => {
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    tog.textContent = show ? "Ocultar" : "Mostrar";
  });
})();

(function initSignupModal() {
  const modal = $("#signup");
  const openBtn = $("#openSignup");
  const closeBtn = $("#closeSignup");
  if (!modal || !openBtn) return;

  const open = () => {
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("open");
    $("#n1")?.focus();
  };
  const close = () => {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("open");
  };

  openBtn.addEventListener("click", (e) => {
    e.preventDefault();
    open();
  });
  closeBtn?.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
})();

async function getSupabaseClient() {
  if (window.luminovaSupabase) return window.luminovaSupabase;
  const config = window.LUMINOVA_SUPABASE_CONFIG;
  if (
    !config ||
    !config.url ||
    !config.anonKey ||
    config.url.includes("COLOQUE_") ||
    config.anonKey.includes("COLOQUE_")
  ) {
    throw new Error(
      "Configure a URL e a chave pública do Supabase no arquivo supabase-config.js antes de usar o cadastro.",
    );
  }
  if (!window.supabase?.createClient)
    throw new Error(
      "Não foi possível carregar a biblioteca do Supabase. Verifique sua conexão.",
    );
  window.luminovaSupabase = window.supabase.createClient(
    config.url,
    config.anonKey,
    {
      auth: {
        storage: window.sessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );
  return window.luminovaSupabase;
}

function saveLuminovaUser(user, fallback = {}) {
  const metadata = user?.user_metadata || {};
  const profile = {
    id: user.id,
    name:
      metadata.name ||
      metadata.full_name ||
      fallback.name ||
      user.email ||
      "Pessoa usuária",
    nickname: metadata.nickname || fallback.nickname || "",
    email: user.email || fallback.email || "",
  };
  return profile;
}

(function initLoginSubmit() {
  const form = $("#loginForm");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userInput = $("#user");
    const pass = $("#pass");
    const email = userInput?.value.trim();
    if (!email || !pass?.value) {
      alert("Informe seu e-mail e sua senha para continuar.");
      return;
    }
    if (!email.includes("@")) {
      alert(
        "Entre usando o e-mail cadastrado. O login por apelido precisa de uma consulta específica à tabela de perfis.",
      );
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.dataset.originalText = submit.textContent;
      submit.textContent = "Entrando…";
    }
    try {
      const client = await getSupabaseClient();
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password: pass.value,
      });
      if (error) throw error;
      saveLuminovaUser(data.user);
      window.location.href = "perfil.html";
    } catch (error) {
      console.error("Erro no login Supabase:", error);
      alert(
        error.message ||
          "Não foi possível entrar. Confira seus dados e tente novamente.",
      );
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = submit.dataset.originalText || "Entrar";
      }
    }
  });
})();

(function initSignupSubmit() {
  const form = $("#signupForm");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#n1")?.value.trim();
    const nickname = $("#n2")?.value.trim().replace(/^@/, "");
    const email = $("#n3")?.value.trim().toLowerCase();
    const password = $("#n4")?.value;
    if (!name || !nickname || !email || !password) {
      alert("Preencha todos os campos para criar sua conta.");
      return;
    }
    if (nickname.length < 3) {
      alert("Seu apelido precisa ter pelo menos 3 caracteres.");
      $("#n2")?.focus();
      return;
    }
    if (password.length < 8) {
      alert("Use uma senha com pelo menos 8 caracteres.");
      $("#n4")?.focus();
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.dataset.originalText = submit.textContent;
      submit.textContent = "Criando conta…";
    }
    try {
      const client = await getSupabaseClient();
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { name, full_name: name, first_name: name, nickname, username: nickname },
        },
      });
      if (error) throw error;
      if (data.session && data.user) {
        saveLuminovaUser(data.user, { name, nickname, email });
        alert("Conta criada com sucesso! Bem-vinda ao LumiNova.");
        window.location.href = "perfil.html";
      } else {
        alert(
          "Cadastro iniciado! Confira seu e-mail e confirme a conta para poder entrar no LumiNova.",
        );
        const modal = $("#signup");
        if (modal) {
          modal.classList.remove("open");
          modal.style.display = "none";
          modal.setAttribute("aria-hidden", "true");
        }
        form.reset();
      }
    } catch (error) {
      console.error("Erro no cadastro Supabase:", error);
      const msg = /already registered|already exists|user already/i.test(
        error.message || "",
      )
        ? "Este e-mail já está cadastrado. Entre na sua conta ou use outro e-mail."
        : error.message || "Não foi possível criar sua conta. Tente novamente.";
      alert(msg);
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = submit.dataset.originalText || "Criar conta";
      }
    }
  });
})();

(function initPasswordRecovery() {
  const link = $(".forgot");
  if (!link) return;
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    const email = $("#user")?.value.trim();
    if (!email || !email.includes("@")) {
      alert("Digite seu e-mail no campo de login primeiro.");
      $("#user")?.focus();
      return;
    }
    try {
      const client = await getSupabaseClient();
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/index.html`,
      });
      if (error) throw error;
      alert(
        "Se esse e-mail estiver cadastrado, você receberá as instruções para redefinir a senha.",
      );
    } catch (error) {
      alert(
        error.message || "Não foi possível solicitar a recuperação da senha.",
      );
    }
  });
})();

(function initPerfilModais() {
  const modal = $("#settingsModal");
  if (!modal) return; // não está no perfil

  const openSettings = () => {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  };
  const closeSettings = () => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  };

  ["#openSettings", "#openSettings2", "#editProfile"].forEach((sel) => {
    const btn = $(sel);
    if (btn) btn.addEventListener("click", openSettings);
  });

  $$("[data-close]").forEach((b) => b.addEventListener("click", closeSettings));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettings();
  });

  const constructionModal = $("#constructionModal");
  if (!constructionModal) return;

  const openConstruction = (area = "Esta área") => {
    const title = $("#constructionTitle");
    if (title) title.textContent = `${area} está em construção`;
    constructionModal.classList.add("open");
    constructionModal.setAttribute("aria-hidden", "false");
  };
  const closeConstruction = () => {
    constructionModal.classList.remove("open");
    constructionModal.setAttribute("aria-hidden", "true");
  };

  $$("[data-construction]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openConstruction(link.dataset.construction || "Esta área");
    });
  });

  const closeC = $("#closeConstruction");
  const okC = $("#constructionOk");
  if (closeC) closeC.addEventListener("click", closeConstruction);
  if (okC) okC.addEventListener("click", closeConstruction);

  constructionModal.addEventListener("click", (e) => {
    if (e.target === constructionModal) closeConstruction();
  });
})();
