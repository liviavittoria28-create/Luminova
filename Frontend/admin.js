/* LUMINOVA — Administração (somente role = admin; a permissão real é validada pelo RLS do banco). */
(() => {
  "use strict";
  const { esc } = window.LUMI;
  const $ = (s) => document.querySelector(s);
  let sb;

  async function checks() {
    const list = [
      ["Chats: colunas de resumo", () => sb.from("conversations").select("last_message,updated_at").limit(1)],
      ["Chats: iniciar conversa (RPC)", () => sb.rpc("luminova_start_conversation", { other_user: "00000000-0000-0000-0000-000000000000" }), (r) => !!r.error && /não encontrado|Perfil/i.test(r.error.message)],
      ["Skill Tree: habilidades cadastradas", () => sb.from("skill_nodes").select("node_key", { count: "exact", head: true }), (r) => !r.error && r.count > 0],
      ["Tendências reais (RPC)", () => sb.rpc("luminova_trending", { window_days: 7, result_limit: 1 })],
      ["Tópico do dia (RPC)", () => sb.rpc("luminova_current_topic")],
      ["Limites de comunidades (RPC)", () => sb.rpc("luminova_my_limits")],
    ];
    const ul = $("#adChecks"); ul.innerHTML = "";
    for (const [name, run, okFn] of list) {
      let ok, msg = "";
      try { const r = await run(); ok = okFn ? okFn(r) : !r.error; if (r.error && !ok) msg = r.error.message; } catch (e) { ok = false; msg = e.message; }
      ul.insertAdjacentHTML("beforeend", `<li>${ok ? "✅" : "⚠️"} ${esc(name)}${ok ? "" : ` — <small>${esc(msg || "execute a Migracao-2 / Seed")}</small>`}</li>`);
    }
  }


  // Critérios de certificação (editáveis pela administração) e certificação manual.
  async function certification() {
    const msg = (t, bad) => { const el = $("#certMsg"); el.textContent = t; el.style.color = bad ? "#fca5a5" : ""; };
    const { data, error } = await sb.from("certification_settings").select("min_followers,min_xp").eq("id", 1).maybeSingle();
    if (error) { msg("Não foi possível carregar os critérios: " + error.message, true); return; }
    if (data) { $("#certFollowers").value = data.min_followers; $("#certXp").value = data.min_xp; }

    $("#certSave").addEventListener("click", async () => {
      const f = Math.max(0, Math.floor(Number($("#certFollowers").value) || 0));
      const x = Math.max(0, Math.floor(Number($("#certXp").value) || 0));
      const { error: er } = await sb.from("certification_settings").update({ min_followers: f, min_xp: x, updated_at: new Date().toISOString() }).eq("id", 1);
      if (er) return msg("Não foi possível salvar: " + er.message, true);
      msg(`Critérios salvos: ${f} seguidores e ${x} XP. Todos os perfis foram reavaliados.`);
    });

    const setManual = async (certified) => {
      const u = $("#certUser").value.trim();
      if (!u) return msg("Digite o @usuário.", true);
      const { data: r, error: er } = await sb.rpc("luminova_set_certified", { p_username: u, p_certified: certified });
      if (er) return msg(er.message, true);
      msg(`@${u.replace(/^@/, "")} ${r.certified ? "está certificado" : "não está certificado"}${r.certified_manual ? " (manual)" : " (pelos critérios)"}.`);
    };
    $("#certOn").addEventListener("click", () => setManual(true));
    $("#certOff").addEventListener("click", () => setManual(false));
  }


  async function init() {
    if (!(await LUMI.requireLogin())) return;
    sb = LUMI.sb;
    if (!LUMI.isAdmin) { $("#adGate").textContent = "Esta área é restrita à administração."; return; }
    $("#adGate").hidden = true; $("#adBody").hidden = false;
    await certification();
    checks();
  }
  document.addEventListener("DOMContentLoaded", () => init().catch((e) => { $("#adGate").textContent = "Erro: " + e.message; }));
})();
