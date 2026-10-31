/* NOVA BRAIN — MEMÓRIA.
 *
 * Curto prazo  = o histórico DESTA conversa (quem chama passa em `history`). Daqui saem: pilha de assuntos,
 *                última pergunta sem resposta e fatos ditos agora há pouco.
 * Longo prazo  = itens {kind, content, embedding} que o backend guarda em ai_agent_memories, SOMENTE quando
 *                a pessoa ativou "memória dos agentes" (o banco recusa a gravação sem esse consentimento).
 *                A recuperação usa vetores do próprio modelo (camada oculta do Understander, 64 dimensões)
 *                + sobreposição de palavras. Não há serviço externo de embeddings.
 *
 * Privacidade: dados sensíveis (documentos, senhas, contatos, endereço, saúde, religião, orientação sexual,
 * política, dados financeiros) NUNCA viram memória — nem com consentimento.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NovaMemory = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const strip = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const cap = (x) => x.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

  // ---------------------------------------------------------------- dados sensíveis (nunca guardar)
  const SENSITIVE = [
    /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,                 // CPF
    /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/,         // CNPJ
    /\b(?:\d[ -]?){13,19}\b/,                           // cartão
    /\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/,                 // telefone
    /[\w.+-]+@[\w-]+\.[\w.]+/,                          // e-mail
    /\b(senha|password|pin|token|chave pix|cvv|rg|cpf|cnh|passaporte)\b/,
    /\b(rua|avenida|av\.|travessa|cep)\b.{0,30}\d/,
    /\b(diagnostic|depress|ansiedade|remedio|medicament|doenca|hiv|gravid|terapia|psiquiatr|transtorno|autis|tdah)/,
    /\b(religiao|igreja|evangelic|catolic|umbanda|candomble|ateu|judeu|mulcumano|muculmano)/,
    /\b(gay|lesbica|bissexual|trans|orientacao sexual|nao binari)/,
    /\b(partido|voto em|vou votar|bolsonar|lula|esquerda|direita)\b/,
    /\b(salario|divida|emprestimo|conta bancaria|banco do|nubank|saldo)\b/,
  ];
  function isSensitive(text) {
    const n = strip(text);
    return SENSITIVE.some((re) => re.test(n));
  }

  // ---------------------------------------------------------------- extração de fatos
  // Cada padrão devolve {kind, content}. Conteúdo curto, em minúsculas (exceto nome), sem pontuação final.
  const clean = (s) => s.replace(/\s+/g, " ").replace(/[.,!?;:]+$/, "").trim();
  const BAD_NAME = /^(triste|feliz|cansad[oa]|nov[oa]|bem|mal|eu|um|uma|de|da|do|muito|meio)$/;
  function extractFacts(text) {
    const raw = String(text || "");
    if (!raw.trim() || isSensitive(raw)) return [];
    const n = strip(raw).replace(/\s+/g, " ");
    const out = [];
    let r;
    if ((r = /(?:meu nome e|me chamo|pode me chamar de|todo mundo me chama de)\s+([a-z]{2,20})\b/.exec(n)) && !BAD_NAME.test(r[1])) {
      out.push({ kind: "name", content: cap(r[1]) });
    }
    const likeRe = /(?:^|[\s,.!])(?:eu )?(?:gosto muito de|gosto de|adoro|amo|curto|sou fa de|sou viciad[oa] em|to viciad[oa] em)\s+(?:muito )?(?:o |a |os |as |de |do |da |dos |das )?([a-z0-9 \-]{3,40}?)(?=[.,!?]|$| e | com | quando | todo| toda| mas| porque| pq| tambem| aos | nos fins)/g;
    while ((r = likeRe.exec(n))) { const c = clean(r[1]).split(" ").slice(0, 5).join(" "); if (c.split(" ").length <= 5 && !/^(voce|isso|aquilo|conversar|falar)$/.test(c)) out.push({ kind: "likes", content: c }); }
    const disRe = /(?:nao gosto de|odeio|detesto|nao curto)\s+(?:o |a |os |as |de |do |da )?([a-z0-9 \-]{3,40}?)(?=[.,!?]|$| e | mas| porque)/g;
    while ((r = disRe.exec(n))) { const c = clean(r[1]); if (c.split(" ").length <= 5) out.push({ kind: "dislikes", content: c }); }
    if ((r = /(?:estou aprendendo|to aprendendo|comecei a aprender|estou estudando|to estudando)\s+([a-z0-9 \-]{3,40}?)(?=[.,!?]|$| e | mas| porque)/.exec(n))) {
      out.push({ kind: "fact", content: "está aprendendo " + clean(r[1]) });
    }
    if ((r = /(?:tenho um|tenho uma)\s+(gat[oa]|cachorr[oa]|calopsita|coelh[oa]|hamster|peixe|papagaio|tartaruga)(?:\s+(?:chamad[oa]|que se chama)\s+([a-z]{2,20}))?/.exec(n))) {
      out.push({ kind: "fact", content: "tem " + (r[1].endsWith("a") ? "uma " : "um ") + r[1] + (r[2] ? " chamado " + cap(r[2]) : "") });
    }
    if ((r = /(?:meu|minha) (anime|serie|banda|musica|jogo|livro|filme|personagem|artista|grupo) favorit[oa] (?:e|eh) ([a-z0-9 \-]{2,40}?)(?=[.,!?]|$| e | mas)/.exec(n))) {
      out.push({ kind: "likes", content: clean(r[2]) + " (" + r[1] + " favorito)" });
    }
    if ((r = /(?:eu )?(?:moro|vivo) (?:em|no|na) ([a-z ]{3,25}?)(?=[.,!?]|$| e | mas| faz)/.exec(n))) {
      out.push({ kind: "location", content: cap(clean(r[1])) });
    }
    // remove duplicados
    const seen = new Set();
    return out.filter((f) => { const k = f.kind + "|" + f.content; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---------------------------------------------------------------- vetores (do próprio modelo)
  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let s = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? s / Math.sqrt(na * nb) : 0;
  }
  const wordsOf = (t) => new Set(strip(t).match(/[a-z0-9]{3,}/g) || []);
  function overlap(a, b) {
    const A = wordsOf(a), B = wordsOf(b);
    if (!A.size || !B.size) return 0;
    let i = 0; A.forEach((w) => B.has(w) && i++);
    return i / Math.min(A.size, B.size);
  }

  /** Recupera as memórias mais relevantes para o texto atual. `embed` é brain.embed (opcional). */
  function retrieve(memories, query, { embed, k = 3, now = Date.now() } = {}) {
    if (!memories || !memories.length) return [];
    const qv = embed && query ? embed(query) : null;
    return memories
      .filter((m) => !m.expires_at || new Date(m.expires_at).getTime() > now)
      .map((m) => {
        const sim = qv && m.embedding ? Math.max(0, cosine(qv, m.embedding)) : 0;
        const lex = overlap(query, m.content);
        const age = m.created_at ? (now - new Date(m.created_at).getTime()) / 864e5 : 0;
        const recency = Math.exp(-age / 60);
        const base = m.kind === "name" ? 0.35 : 0;
        return { m, score: 0.45 * sim + 0.4 * lex + 0.1 * recency + 0.1 * (m.salience || 0.5) + base };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.m);
  }

  /** Funde fatos novos na lista (sem duplicar; nome mais recente substitui o antigo). */
  function merge(memories, facts) {
    const list = (memories || []).slice();
    for (const f of facts) {
      if (f.kind === "name" || f.kind === "location") {
        const i = list.findIndex((m) => m.kind === f.kind);
        if (i >= 0) list.splice(i, 1);
      }
      if (!list.some((m) => m.kind === f.kind && strip(m.content) === strip(f.content))) list.push({ ...f, created_at: new Date().toISOString() });
    }
    return list;
  }

  // ---------------------------------------------------------------- curto prazo
  /** Resumo do estado da conversa: assuntos recentes (pilha), pergunta pendente, fatos ditos aqui. */
  function shortTerm(history, understand) {
    const userMsgs = (history || []).filter((h) => h && h.role === "user" && h.text);
    const topics = [];
    if (understand) {
      for (const h of userMsgs.slice(-6)) {
        const u = understand(h.text);
        if (u && u.topicP >= 0.35 && u.topic !== "geral" && topics[topics.length - 1] !== u.topic) topics.push(u.topic);
      }
    }
    const facts = userMsgs.reduce((acc, h) => merge(acc, extractFacts(h.text)), []);
    const lastAi = [...(history || [])].reverse().find((h) => h.role === "ai");
    const pendingQuestion = lastAi && /\?\s*\S{0,3}$/.test(lastAi.text) ? lastAi.text : null;
    return { topics, facts, pendingQuestion, turns: (history || []).length };
  }

  return { extractFacts, isSensitive, retrieve, merge, shortTerm, cosine, overlap };
});
