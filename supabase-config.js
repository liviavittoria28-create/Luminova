/* LUMINOVA — configuração PÚBLICA do Supabase.
 * A chave abaixo é a "publishable/anon key": feita para o navegador, protegida pelas políticas RLS do banco.
 * NUNCA coloque aqui (nem em nenhum arquivo do Frontend) a service_role key.
 */
window.LUMINOVA_SUPABASE_CONFIG = {
  url: "https://eanncrvtpsxcjpnfbixb.supabase.co",
  anonKey: "sb_publishable_28jfVcSBZhj6fS569Feecw_iXrgGrxI",
};
window.LUMINOVA_VERSION = "3.0.0";

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
