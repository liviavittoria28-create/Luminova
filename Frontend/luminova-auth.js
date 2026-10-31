/* LUMINOVA 3.x — utilidades de autenticação compartilhadas (index.html e redefinir-senha.html).
 * Traduz erros do Supabase para mensagens claras, valida campos e expõe as versões dos documentos legais. */
(() => {
  "use strict";
  const TERMS_VERSION = "2026-10-30";
  const PRIVACY_VERSION = "2026-10-30";

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const USER_RE = /^[a-z0-9_.-]{3,30}$/;

  function normalizeUsername(v) { return String(v || "").trim().replace(/^@+/, "").toLowerCase(); }
  function usernameProblem(u) {
    if (!u) return "Escolha um nome de usuário.";
    if (u.length < 3) return "Use pelo menos 3 caracteres.";
    if (u.length > 30) return "Use no máximo 30 caracteres.";
    if (!USER_RE.test(u)) return "Use só letras sem acento, números, ponto, hífen ou _.";
    if (/^[._-]|[._-]$/.test(u)) return "Não comece nem termine com ponto, hífen ou _.";
    if (/^ia\./.test(u)) return "O prefixo ia. é reservado aos agentes da NOVA BRAIN.";
    return "";
  }
  function passwordScore(p) {
    let s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (/[a-z]/i.test(p) && /\d/.test(p)) s++;
    if (/[^a-z0-9]/i.test(p) || /[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
    return s; // 0..4
  }
  function passwordProblem(p) {
    if (!p) return "Crie uma senha.";
    if (p.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
    if (!/[a-z]/i.test(p) || !/\d/.test(p)) return "Misture letras e números.";
    if (/^(.)\1+$/.test(p) || /^(12345678|password|senha123|qwerty12)/i.test(p)) return "Essa senha é fácil demais de adivinhar.";
    return "";
  }

  /** Mensagem amigável a partir de um erro do Supabase Auth (nunca mostra texto técnico cru). */
  function friendly(err, context = "") {
    if (!err) return "";
    const m = String(err.message || err.error_description || err).toLowerCase();
    const code = String(err.code || err.error_code || "");
    if (!navigator.onLine || /failed to fetch|networkerror|network request failed|load failed/.test(m)) return "Sem conexão com o servidor. Verifique sua internet e tente de novo.";
    if (code === "invalid_credentials" || /invalid login credentials/.test(m)) return "E-mail ou senha incorretos. Confira e tente de novo.";
    if (code === "email_not_confirmed" || /email not confirmed/.test(m)) return "Sua conta ainda não foi confirmada. Abra o link que enviamos para o seu e-mail (veja também o spam).";
    if (code === "over_email_send_rate_limit" || /rate limit|too many|security purposes/.test(m)) return "Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.";
    if (code === "weak_password" || /weak|password should/.test(m)) return "Essa senha é fraca demais. Use pelo menos 8 caracteres com letras e números.";
    if (code === "same_password" || /different from the old/.test(m)) return "A nova senha precisa ser diferente da anterior.";
    if (code === "user_already_exists" || /already registered|already exists/.test(m)) return "Este e-mail já tem uma conta. Entre ou recupere a senha.";
    if (/otp_expired|expired|invalid.*(token|link)|token has expired/.test(m + code)) return "Este link expirou ou já foi usado. Peça um novo link de recuperação.";
    if (/session.*(missing|expired)|jwt expired|refresh token/.test(m)) return "Sua sessão expirou. Entre novamente.";
    if (/invalid.*email|unable to validate email/.test(m)) return "Esse e-mail não parece válido.";
    if (/signups not allowed|signup.*disabled/.test(m)) return "Novos cadastros estão temporariamente fechados.";
    if (/database error saving new user/.test(m)) return "Não foi possível criar a conta agora. Tente de novo em instantes.";
    return context ? `Não foi possível ${context}. Tente novamente em instantes.` : "Algo deu errado. Tente novamente em instantes.";
  }

  /** Lê erros que o Supabase devolve na URL (#error=...&error_description=...). */
  function urlError() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    const q = new URLSearchParams(location.search);
    const code = h.get("error_code") || q.get("error_code") || h.get("error") || q.get("error");
    if (!code) return null;
    return { code, message: h.get("error_description") || q.get("error_description") || code };
  }

  function safeRedirect(target, fallback) {
    // só caminhos internos (evita redirecionamento aberto para outro site)
    if (target && /^[a-z0-9-]+\.html(\?[\w=&%.-]*)?$/i.test(target)) return target;
    return fallback;
  }

  window.LUMI_AUTH = { TERMS_VERSION, PRIVACY_VERSION, EMAIL_RE, normalizeUsername, usernameProblem, passwordScore, passwordProblem, friendly, urlError, safeRedirect };
})();
