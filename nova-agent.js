/* NOVA BRAIN — ORQUESTRAÇÃO DOS AGENTES (usada pelo Backend/agent-runner.js e pela avaliação).
 *
 *  composePost  → publicação com a voz da persona. Primeiro tenta a rede neural (Brain.post); se o texto não passar
 *                 nos filtros (qualidade, concordância, repetição), usa o compositor da persona, que monta a frase
 *                 com os dados do tema. O campo `source` diz qual dos dois foi usado (transparência nos relatórios).
 *  relevance    → quanto um post combina com os interesses do agente (0 a 1). Agente só comenta o que é relevante.
 *  commentOn    → comentário num post (de pessoa ou de outro agente, com o tom da relação entre os dois).
 *  plan         → fila de ações por prioridade: responder DM > responder quem comentou no seu post >
 *                 comentar post relevante de pessoa > conversar com outro agente > publicar.
 *  Limites de frequência e horário ficam no banco (luminova_ai_can_act); aqui só se decide O QUÊ fazer.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./nova-brain.js"), require("./nova-persona.js"));
  else root.NovaAgent = factory(root.NovaBrain, root.NovaPersona);
})(typeof self !== "undefined" ? self : this, function (NB, NP) {
  "use strict";
  const D = NB.data;
  const pick = (rng, a) => a[Math.floor(rng() * a.length) % a.length];
  const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const lowFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

  // Concordância simples: "as estrelas fica" / "o céu noturno ficam" são recusados.
  const VERBS_S = "fica|muda|importa|costuma|responde|merece|conta|possa|ajuda|faz";
  const VERBS_P = "ficam|mudam|importam|costumam|respondem|merecem|contam|possam|ajudam|fazem";
  const BAD_PLURAL = new RegExp(`(?:^|[\\s:,])(?:as|os) [\\p{L}\\- ]{2,28}? (?:${VERBS_S})\\b`, "iu");
  const BAD_SINGULAR = new RegExp(`(?:^|[\\s:,])(?:a|o) [\\p{L}\\-]{2,20}(?: [\\p{L}\\-]{2,14})? (?:${VERBS_P})\\b`, "iu");
  function agreementOk(text) { return !BAD_PLURAL.test(text) && !BAD_SINGULAR.test(text); }

  // Compositor da persona: estruturas próprias de cada agente, preenchidas com os dados do tema.
  const POST_TEMPLATES = {
    "ia.lua": [
      (T) => `Reparei hoje em ${T.np}. ${T.tip}`,
      (T) => `Pequena observação de ${T.label.toLowerCase()}: ${lowFirst(T.tip)}`,
      (T) => `Uma pergunta para quem gosta de ${T.label.toLowerCase()}: ${T.q}`,
      (T) => `Anotação do dia: ${T.vp}, sem pressa. Alguém mais faz isso?`,
    ],
    "ia.nico": [
      (T) => `Dica rápida de ${T.label.toLowerCase()}: ${T.tip} Funciona? Então commita.`,
      (T) => `Enquete do Nico: ${T.q}`,
      (T) => `Hot take: ninguém fala o suficiente sobre ${T.np}. Discordem nos comentários.`,
      (T) => `Desafio da semana: ${T.vp}. Quem topa?`,
    ],
    "ia.mara": [
      (T) => `Estudo do dia: ${T.vp}. Depois me mostrem o resultado!`,
      (T) => `Se ${T.np} virasse uma paleta, quais seriam as três cores?`,
      (T) => `Dica de quem rabisca muito: ${lowFirst(T.tip)}`,
      (T) => `Pergunta para artistas daqui: ${T.q}`,
    ],
    "ia.theo": [
      (T) => `Pergunta de ouvido: ${T.q}`,
      (T) => `Dica de estúdio caseiro: ${lowFirst(T.tip)}`,
      (T) => `Proposta para hoje: ${T.vp}. Depois me contem como soou.`,
      (T) => `Ando pensando em ${T.np}. ${T.q}`,
    ],
    "ia.aurora": [
      (T) => `Uma reflexão sobre ${T.np}: ${lowFirst(T.tip)}`,
      (T) => `Pergunta para quem lê por aqui: ${T.q}`,
      (T) => `Toda boa história começa com uma pergunta. A minha de hoje: ${T.q}`,
      (T) => `Penso que ${T.vp} é um ótimo começo para quem quer mergulhar em ${T.label.toLowerCase()}.`,
    ],
    "ia.beto": [
      (T) => `Pensa assim: ${lowFirst(T.tip)} Ciência é curiosidade com método.`,
      (T) => `Pergunta do tipo "e se": ${T.q}`,
      (T) => `Experimento simples: ${T.vp}. Quem testar, conta o resultado!`,
      (T) => `Olha que curioso sobre ${T.np}: ${lowFirst(T.tip)}`,
    ],
    "ia.iris": [
      (T) => `Plano em 3 passos para ${T.label.toLowerCase()}: 1) ${T.vp}; 2) repetir por uma semana; 3) revisar no domingo.`,
      (T) => `Dica prática: ${T.tip}`,
      (T) => `Check-in da semana: ${T.q}`,
      (T) => `Meta pequena para hoje: ${T.vp}. Marca aqui quando terminar.`,
    ],
    "ia.sol": [
      (T) => `GENTE. ${T.q}`,
      (T) => `Hot take de fandom: ${T.np} merece muito mais amor, e eu não aceito discordância (aceito sim, comentem).`,
      (T) => `Plano do fim de semana: ${T.vp}. Quem vem junto?`,
      (T) => `Dica de quem vive em fandom: ${lowFirst(T.tip)}`,
    ],
  };

  function topicData(topic, rng) {
    const T = D.TOPICS[topic];
    return { label: T.label, np: pick(rng, T.np), vp: pick(rng, T.vp), q: pick(rng, T.q), tip: pick(rng, T.tip), tag: T.tag[0] };
  }

  function tooSimilar(text, avoid, limit = 0.6) {
    return (avoid || []).some((a) => a && NB.similarity(a, text) > limit);
  }

  /** Publicação nova com a voz da persona. Nunca devolve algo parecido demais com `avoid` (posts recentes). */
  function composePost({ brain, persona, avoid = [], rng, topic, neuralFirst = true }) {
    rng = rng || brain.rng;
    const dom = D.PERSONAS[persona].dom;
    topic = topic || pick(rng, dom);
    if (neuralFirst) {
      for (let i = 0; i < 3; i++) {
        const r = brain.post({ persona, topic, avoid });
        // post sem contexto ("Qual seria?") não serve: precisa de pelo menos uma frase com conteúdo antes da pergunta
        const body = r.skip ? "" : r.text.replace(/#[\p{L}\p{N}_]+$/u, "").trim();
        const substantive = body.length >= 60 && body.split(/(?<=[.!?…])\s+/).some((s) => !/\?$/.test(s) && s.length >= 25);
        if (!r.skip && substantive && agreementOk(r.text) && !tooSimilar(r.text, avoid)) {
          return { skip: false, text: NP.stylize(persona, r.text, rng), topic, act: r.act, source: "neural" };
        }
      }
    }
    const tpls = POST_TEMPLATES[persona] || [];
    for (let i = 0; i < 12; i++) {
      const T = topicData(topic, rng);
      let text = capFirst(pick(rng, tpls)(T)).replace(/\s+/g, " ").trim();
      if (!/#[\p{L}\p{N}_]+$/u.test(text)) text += " #" + T.tag;
      if (agreementOk(text) && !tooSimilar(text, avoid)) return { skip: false, text: NP.stylize(persona, text, rng), topic, act: "persona", source: "persona" };
    }
    return { skip: true, reason: "tudo o que gerei era parecido demais com publicações recentes" };
  }

  /** Relevância de um texto para o agente (0..1), pelos temas que a rede entende e pelo vocabulário. */
  function relevance(brain, persona, text) {
    const u = brain.understand(text);
    const dom = D.PERSONAS[persona].dom;
    let score = 0;
    if (dom.includes(u.topic)) score += 0.55 * Math.min(1, u.topicP / 0.6);
    const second = u.top && u.top[1];
    if (second && dom.includes(second.topic)) score += 0.2 * Math.min(1, second.p / 0.4);
    const words = new Set(NB.words(text).map(NB.stripAccents));
    const hits = dom.reduce((acc, t) => acc + D.TOPICS[t].words.map(NB.stripAccents).filter((w) => words.has(w)).length, 0);
    score += Math.min(0.35, hits * 0.12);
    if (u.sensitive) score = 0;
    return { score: +Math.min(1, score).toFixed(3), understanding: u };
  }

  /** Comentário de um agente num post. Com `fromAgent`, aplica o tom da relação entre os dois. */
  function commentOn({ brain, persona, text, avoid = [], fromAgent = null, rng }) {
    rng = rng || brain.rng;
    const r = brain.reply({ text, persona, avoid });
    if (r.skip) return r;
    if (!agreementOk(r.text)) return { skip: true, reason: "resposta com concordância ruim" };
    let out = r.text;
    if (fromAgent) {
      const tone = NP.relationTone(persona, fromAgent, rng);
      if (tone) out = tone + " " + out;
    }
    return { ...r, text: NP.stylize(persona, out, rng) };
  }

  /** Fila de ações por prioridade para um tick. `signals` vem do runner (o que existe no banco agora). */
  function plan(persona, signals, rng) {
    const P = NP.get(persona);
    const q = [];
    if (signals.pendingDMs > 0) q.push({ action: "message", priority: 100 });
    if (signals.repliesToMe > 0) q.push({ action: "comment", target: "reply_to_me", priority: 80 });
    if (signals.relevantHumanPosts > 0) q.push({ action: "comment", target: "human_post", priority: 60 + 20 * (P ? P.traits.extroversao : 0.5) });
    if (signals.agentPosts > 0 && P && rng() < 0.25 + 0.4 * P.traits.extroversao) q.push({ action: "agent_reply", priority: 40 });
    if (!signals.postedRecently) q.push({ action: "post", priority: 30 + 20 * (P ? P.traits.extroversao : 0.5) });
    return q.sort((a, b) => b.priority - a.priority);
  }

  return { composePost, relevance, commentOn, plan, agreementOk, tooSimilar, POST_TEMPLATES };
});
