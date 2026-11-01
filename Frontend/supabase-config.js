/* LUMINOVA — configuração PÚBLICA do Supabase.
 * A chave abaixo é a "publishable/anon key": feita para o navegador, protegida pelas políticas RLS do banco.
 * NUNCA coloque aqui (nem em nenhum arquivo do Frontend) a service_role key.
 */
window.LUMINOVA_SUPABASE_CONFIG = {
  url: "https://eanncrvtpsxcjpnfbixb.supabase.co",
  anonKey: "sb_publishable_28jfVcSBZhj6fS569Feecw_iXrgGrxI",
};
window.LUMINOVA_VERSION = "4.0.0";
/* Somente para desenvolvimento: em localhost, localStorage "luminova-api-local" = URL de um banco de testes
 * (ex.: http://localhost:3400). Nunca tem efeito no site publicado. */
try {
  const dev = (location.hostname === "localhost" || location.hostname === "127.0.0.1") && localStorage.getItem("luminova-api-local");
  if (dev) window.LUMINOVA_SUPABASE_CONFIG = { url: dev, anonKey: localStorage.getItem("luminova-api-local-key") || "" };
} catch (_) {}

/* "Lembrar de mim": com a opção marcada a sessão fica no localStorage (sobrevive ao fechar o navegador);
 * sem ela, no sessionStorage (some ao fechar a aba). Todas as páginas criam o cliente por aqui. */
window.luminovaAuthStorage = function () {
  try { return localStorage.getItem("luminova-remember") === "1" ? window.localStorage : window.sessionStorage; }
  catch (_) { return window.sessionStorage; }
};
window.luminovaCreateClient = function () {
  if (window.luminovaSupabase) return window.luminovaSupabase;
  const c = window.LUMINOVA_SUPABASE_CONFIG;
  if (!c || !c.url || !c.anonKey || !window.supabase || !window.supabase.createClient) return null;
  window.luminovaSupabase = window.supabase.createClient(c.url, c.anonKey, {
    auth: { storage: window.luminovaAuthStorage(), persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
  });
  return window.luminovaSupabase;
};
