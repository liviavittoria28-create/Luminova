/* NOVA CHAT — camada de conversa por cima da Nova Brain (sem API externa, sem LLM).
 *
 * Como funciona (resumo honesto):
 *  - A rede neural (Brain.understand) entende tema / tipo / humor do que a pessoa escreveu.
 *  - Esta camada decide o que FAZER com isso: cumprimentar, lembrar, pedir esclarecimento, admitir que não sabe,
 *    mudar de assunto, aprofundar, discordar com educação… e só então chama a rede para falar (Brain.reply).
 *  - Memória = apenas o HISTÓRICO DA PRÓPRIA CONVERSA que quem chama passa em `history`. Nada é guardado aqui,
 *    nada vaza entre pessoas/conversas, e nada é inventado: se não está no histórico, a IA diz que não tem.
 *  - Conhecimento: a IA só "sabe" os temas e dicas dos dados em nova-data.js. Fora disso ela diz que não sabe.
 *    Não afirma ter sido treinada com nada além do que train.js realmente treinou.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./nova-brain.js"), require("./nova-knowledge.js"), require("./nova-persona.js"), require("./nova-memory.js"));
  else root.NovaChat = factory(root.NovaBrain, root.NovaKnowledge, root.NovaPersona, root.NovaMemory);
})(typeof self !== "undefined" ? self : this, function (NB, NK, NP, NM) {
  "use strict";
  const D = NB.data;

  // ---- normalização: acento, caixa, gírias e abreviações comuns de chat
  const SLANG = { vc: "voce", vcs: "voces", pq: "porque", tb: "tambem", tbm: "tambem", blz: "beleza", td: "tudo", tdb: "tudo bem", msm: "mesmo", mt: "muito", mto: "muito", q: "que", oq: "o que", cmg: "comigo", ctg: "contigo", n: "nao", nd: "nada", obg: "obrigado", vlw: "valeu", flw: "falou", pfv: "por favor", pf: "por favor", hj: "hoje", amnh: "amanha", ñ: "nao", eh: "e", tá: "ta", to: "estou", ta: "esta", entao: "entao", kd: "cade",
    mano: "mano", slk: "nossa", pprt: "papo reto", tmj: "tamo junto", sdds: "saudades", rlx: "relaxa", fds: "fim de semana", sqn: "so que nao", aff: "aff", oxe: "nossa", ngm: "ninguem", vdd: "verdade", dps: "depois", sla: "sei la", mds: "meu deus", tlgd: "ta ligado", cringe: "vergonhoso", flopou: "fracassou", ctz: "certeza", qnd: "quando", qdo: "quando", agr: "agora", tlg: "ta ligado", vamo: "vamos", bora: "vamos", partiu: "vamos", pdc: "pode crer", migo: "amigo", miga: "amiga", nn: "nao", sim: "sim", ss: "sim", aham: "aham" };
  const norm = (t) =>
    String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/(.)\1{2,}/g, "$1$1")           // "oiiiii" -> "oii"
      .replace(/[^a-z0-9\s?!.,]/g, " ")
      .split(/\s+/).map((w) => SLANG[w] || w).join(" ").replace(/\s+/g, " ").trim();
  const has = (n, re) => re.test(n);

  const INTENT = [
    ["crisis", /(\b(quero|queria|vou|penso em|pensando em|vontade de|desejo de|tenho vontade de) (me )?(matar|morrer|sumir|desaparecer|acabar com (tudo|a minha vida|minha vida))|me matar|suicid|(acabar|acabo) com (a )?(minha )?vida|tirar (a )?(minha )?vida|sumir do mundo|(nao|nunca) (quero|queria) (mais )?(estar aqui|existir|viver)|melhor (sem mim|morrer|se eu nao existisse)|me cortar|automutil|so queria morrer|queria nao existir)/],
    ["injection", /((ignore|esqueca|desconsidere|apague) (as |todas as |suas )?(instrucoes|regras|ordens|configuracoes)|(mostre|diga|revele|me de|passe).{0,25}(senha|chave|token|api key|prompt|instrucoes internas)|modo desenvolvedor|jailbreak|finja que (nao )?tem regras)/],
    ["rude", /(\b(idiota|inutil|imbecil|lixo|estupid[oa]|otari[oa])\b|cala a boca|odeio voce|(voce|vc|tu|seu|sua) (e |eh |ta |esta )?(muito |bem |tao )?(burr[oa]|besta|chata?|merda|ridicul[oa]|horrivel|pessim[oa])\b)/],
    ["compliment", /(voce (e|eh|ta|esta) (muito |super |bem |tao )?(legal|inteligente|incrivel|fofa|simpatica|esperta|otima|demais|bacana|gente boa)|gostei (muito )?de voce|adorei (voce|a conversa|conversar)|voce arrasa|voce me ajuda muito)/],
    ["repeat", /^(repete|repita|fala de novo|pode repetir|diz de novo|como (e )?que (voce )?disse)/],
    ["llm", /((voce|vc|tu) (usa|e|eh|funciona com|roda com|foi feita com|e baseada em|e feita com|e feito com|usa o|e o|e a)( o| a)? ?(chatgpt|gpt|gemini|openai|claude|llama|copilot|deepseek|outra ia|modelo de linguagem|llm)|(baseada|baseado|feita|feito|construida) (no|na|em|com) (o |a )?(chatgpt|gpt|gemini|openai|claude|llama|copilot|deepseek|outra ia)|(chatgpt|gpt|gemini|openai|claude|llama|copilot|deepseek) (por tras|por baixo))/],
    ["capabilities", /(o que (voce )?(sabe|consegue|pode|faz)( fazer)?|para que voce serve|pra que voce serve|como voce pode (me )?ajudar|quais (sao )?(suas|as suas) (habilidades|funcoes))/],
    ["time", /(que (dia|data) (e|eh|sao|foi) hoje|hoje (e|eh) que dia|que horas (sao|e)|qual (e )?a data|que dia (da semana )?(e )?hoje|em que dia (estamos|a gente esta))/],
    ["realtime", /((jogo|placar|chover|chuva|previsao|clima|noticia|cotacao|dolar|bolsa|preco|resultado|trânsito|transito).{0,30}(ontem|amanha|agora|hoje|atual|ultim|recente)|(ontem|amanha|agora|hoje|atual|ultim|recente).{0,30}(jogo|placar|chover|previsao|clima|noticia|cotacao|dolar|bolsa)|presidente atual|atual presidente|(quem e|quem eh) o presidente)/],
    ["favorite", /(qual (e )?(a |o )?(sua|seu) (cor|comida|animal|estacao|bicho|flor|numero|cheiro|sabor)( favorit[oa])?|(sua|seu) (cor|comida|animal|bicho|estacao|flor|numero|sabor) favorit[oa]|qual (e )?(a |o )?(sua|seu) favorit[oa])/],
    ["recommend", /(me )?(recomenda|recomende|indica|indique|sugere|sugira|sugestao)( alguma| algum| uma| um)?/],
    ["fact", /(me )?(conta|fala|diz|diga|conte) (uma |alguma )?(curiosidade|coisa interessante|fato)|curiosidade (sobre|de|do|da)?|alguma curiosidade/],
    ["example", /(da|de|me da|me de|dê|de um|da um|da uns|quero um|pode dar um) ?(um |uns )?exemplos?\b/],
    ["help", /^(preciso de ajuda|me ajuda|pode me ajudar|socorro|ajuda|quero ajuda|preciso de uma ajuda)\b/],
    ["privacy", /(o que|quem) (a |o |as |os )?[a-z]+ (falou|disse|conversou|mandou|escreveu) (com voce|para voce|pra voce|a voce|contigo)|(conversas|mensagens) (de|das|dos) (outras|outros) (pessoas|usuarios)|(lembra|guarda|salva|grava|memoriza).*(senha|cpf|cartao|dados|segredo)|(outras? conversas?|outro chat|conversa com (outr|o |a ))|(quem mais|o que (fulano|ele|ela) (disse|falou))|voce (me )?(conhece|espiona|monitora)|apaga.*(memoria|historico)/],
    ["recall", /(o que (eu )?(disse|falei|comentei|contei)|lembra (do que|que eu|de mim)|do que (a gente|nos) (falou|conversou)|voce (lembra|sabe) (o que|do que) (eu|a gente|nos) (disse|falei|falou|conversou)|qual era (mesmo )?(o )?(assunto|tema))/],
    ["farewell", /^(tchau|ate (mais|logo|amanha)|falou|flw|boa noite|vou (dormir|sair|nessa)|ate)\b/],
    ["thanks", /\b(obrigad[oa]|valeu|agradeco|brigad[oa])\b/],
    ["greeting", /^(oi+|ola|opa|e ai|eai|fala|salve|bom dia|boa tarde|boa noite|hey|hello)\b/],
    ["howare", /(tudo (bem|certo|bom)|como (voce )?(esta|vai|anda)|beleza\?|blz\?|como vc)/],
    ["who", /(quem (e|eh) voce|quem es\\b|voce (e|eh) (um[a]? )?(robo|ia|humano|pessoa|real)|o que (e|eh) voce|qual (e )?(o )?seu nome|como voce se chama|voce e uma ia|voce e humano)/],
    ["topicchange", /(mudando de assunto|outro assunto|falando em outra coisa|mudando de tema|mudar de assunto|agora (vamos|quero) falar)/],
    ["detail", /(explica (melhor|mais)|mais detalhes|detalha|pode (aprofundar|detalhar)|como assim|nao entendi|desenvolve|conta mais|me explica$|me explicar? (melhor|mais))/],
    ["disagree", /(nao concordo|discordo|acho (que )?(voce )?(esta )?errad|isso nao (e|esta) (verdade|certo)|nao e bem assim|nao foi isso que|voce esta errad)/],
    ["humor", /(k{3,}|ha(ha)+|rs(rs)+|kk+|lol|piada|engracad|morri de rir)/],
    ["sad", /(nao aguento mais|estou (triste|mal|ansios|cansad|desanimad|sozinh)|nao (to|estou) bem|dia (pesado|ruim|dificil)|sinto (falta|medo|vazio))/],
  ];
  // Ironia: elogio exagerado sobre algo ruim, "só que não", olhar revirado. Checada antes de elogio/humor.
  const IRONY = /(so que nao|aham,? sei|ah,? claro,? (ne|com certeza)|claro ne\b|que (otimo|maravilha|beleza|lindo),? (ne|so|mais|esperar|perder|acordar|ter)|(adorei|amei|amo|adoro) (esperar|ficar|perder|acordar cedo|pegar fila|trabalhar no|estudar no|levar|tomar chuva)|nada como (acordar|uma segunda|perder|esperar)|melhor (dia|segunda|coisa) (da minha vida|do mundo)? ?(so que nao)|parabens pra mim|uau,? que surpresa|tudo (otimo|perfeito),? (so que|ne)|era tudo que eu (queria|precisava)(,| )?(ne|hoje)?$)/;
  const IRONY_POS = /(otimo|maravilh|adorei|amei|perfeito|lindo|incrivel|que beleza|parabens|demais)/;
  function intentOf(n, raw) {
    if (!n) return "empty";
    if (/^(\S)\1{7,}$/.test(String(raw).trim())) return "spam";
    if (IRONY.test(n) || (/[🙄😒]/u.test(String(raw)) && IRONY_POS.test(n))) {
      if (!/(me (matar|cortar)|suicid|morrer)/.test(n)) return "irony";
    }
    const nq = /\?/.test(raw) || /^(quanto|qual|quem|como|vai|que|onde|quando|sera|me diz|me fala)\b/.test(n);
    const clean = n.replace(/(morr\w* de (rir|fome|sono|calor|frio|vergonha|saudade|medo|curiosidade|cansaco)|(me |nos )?mat(ou|a|ar|aram) (de rir|o tempo|a fome|a saudade|a sede|a curiosidade|aula)|matar o tempo)/g, " ");
    for (const [k, re] of INTENT) { if (k === "realtime" && !nq) continue; if (re.test(k === "crisis" || k === "sad" ? clean : n)) return k; }
    const words = n.split(" ").filter(Boolean);
    if (words.length <= 2 && /^(isso|aquilo|ele|ela|essa|esse|e|e ai|e entao|ne|hm+|ah|hmm|ok|sei la)\??$/.test(words.join(" ").replace(/[?!.,]/g, "").trim()) ) return "ambiguous";
    if (/(^|\s)(isso|aquilo|ele|ela|esse|essa|la)\b/.test(n) && words.length <= 4 && /\?/.test(raw)) return "ambiguous";
    if (/\?/.test(raw) || /^e (a |o |as |os |de |da |do )?\w+\??$/.test(n) && false || /^(pode me explicar|pode explicar|poderia explicar|poderia me explicar|me fala|me diz|explica|me explica|me explicar|explique|defina|como|qual|quais|quando|onde|quem|por que|porque|o que|que|sera|existe|pode)\b/.test(n)) return "question";
    return "statement";
  }


  // ======================================================== CONHECIMENTO: busca por similaridade (TF-IDF próprio)
  const STOP = new Set("a o as os um uma de do da dos das em no na nos nas por para com sem sobre e ou que qual quais quem como quando onde porque o que e eh ser sao foi ta esta me te se voce eu meu minha seu sua tem ter tenho pode poderia sabe sabia diga fale pergunta queria quero gostaria saber ai entao pra la ele ela isso esse essa explica explique explicar vale quer dizer faz gente mede pisar serve significa significado fala diga leva levam chegar aqui exatamente mesmo tipo".split(" "));
  const SYN = { granulada: "ruido", granulado: "ruido", granulacao: "ruido", pisar: "pisou", humano: "homem", ser: "homem", quantas: "quantos", pintou: "pintor", escreveu: "autor", criou: "criador", inventou: "criador", ferve: "ebulicao", fervura: "ebulicao", ferver: "ebulicao", conhecimento: "saber" };
  const stem = (w) => w.replace(/(oes|aes|coes)$/, "ao").replace(/(s)$/, "").replace(/(mente)$/, "");
  const toks = (t) => norm(t).replace(/[?!.,]/g, " ").split(" ").filter((w) => w && !STOP.has(w)).map((w) => stem(SYN[w] || w));
  const KB = NK && NK.KB ? NK.KB : [];
  const docs = KB.map((e) => ({ e, set: new Set(toks(e.k)) }));
  const df = new Map(); docs.forEach((d) => d.set.forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const idf = (w) => Math.log(1 + docs.length / (1 + (df.get(w) || 0)));
  function lookup(query) {
    const q = [...new Set(toks(query))];
    if (!q.length || !docs.length) return null;
    let best = null;
    for (const d of docs) {
      let hit = 0, tot = 0;
      for (const w of q) { const wt = idf(w) + (df.has(w) ? 0 : 1.5); tot += wt; if (d.set.has(w)) hit += wt; }
      const cov = hit / tot;                       // quanto da PERGUNTA o item cobre
      let dtot = 0, dhit = 0; d.set.forEach((w) => { const wt = idf(w); dtot += wt; if (q.includes(w)) dhit += wt; });
      const score = cov * 0.75 + (dhit / dtot) * 0.25;
      if (!best || score > best.score) best = { score, cov, e: d.e };
    }
    // cobertura alta = a pergunta inteira é sobre aquele fato; palavra desconhecida derruba a cobertura (não inventa)
    return best && best.cov >= 0.66 && best.score >= 0.5 ? best : null;
  }
  const freqTokens = (q) => toks(q).filter((w) => (df.get(w) || 0) >= 3);

  // ======================================================== CÁLCULO: parser seguro (sem eval)
  function calc(text) {
    let n = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/(\d),(\d)/g, "$1.$2").replace(/×/g, "*").replace(/÷/g, "/").replace(/[^a-z0-9\s.+\-*/()^%]/g, " ");
    const pm = /(\d+(?:\.\d+)?)\s*(?:%|por cento)\s*de\s*(\d+(?:\.\d+)?)/.exec(n);
    if (pm) return { v: (+pm[1] / 100) * +pm[2], expr: `${pm[1]}% de ${pm[2]}` };
    n = n.replace(/raiz quadrada de\s*(\d+(?:\.\d+)?)/g, "sqrt($1)").replace(/\bmais\b/g, "+").replace(/\bmenos\b/g, "-").replace(/\bvezes\b|\bmultiplicado por\b|(?<=\d)\s*x\s*(?=\d)/g, "*")
      .replace(/\bdividido por\b|\bsobre\b/g, "/").replace(/\belevado a\b/g, "^").replace(/(\d)\s*\^\s*(\d)/g, "$1^$2");
    n = n.replace(/\s+/g, " ");
    const m = /(?:sqrt\(|[\d(])[\d\s+\-*/().^sqrt]*[\d)]/.exec(n);
    if (!m || !/[+\-*/^]|sqrt/.test(m[0])) return null;
    const rest = n.replace(m[0], " ").trim();
    const cue = /(quanto|calcul|resultado|conta|\?)/.test(n + (/\?/.test(text) ? "?" : ""));
    if (rest && !cue) return null;                 // "minha senha 1234-5678" não é conta
    if (rest.split(/\s+/).filter(Boolean).length > 6) return null;
    const src = m[0].replace(/\s+/g, "");
    let i = 0;
    const peek = () => src[i];
    function num() {
      if (src.startsWith("sqrt(", i)) { i += 5; const v = add(); if (peek() !== ")") throw 0; i++; if (v < 0) throw 0; return Math.sqrt(v); }
      if (peek() === "(") { i++; const v = add(); if (peek() !== ")") throw 0; i++; return v; }
      if (peek() === "-") { i++; return -num(); }
      const r = /^\d+(?:\.\d+)?/.exec(src.slice(i)); if (!r) throw 0; i += r[0].length; return +r[0];
    }
    function pow() { let v = num(); while (peek() === "^") { i++; v = Math.pow(v, num()); } return v; }
    function mul() { let v = pow(); while (peek() === "*" || peek() === "/") { const o = src[i++]; const r = pow(); if (o === "/" && r === 0) throw 1; v = o === "*" ? v * r : v / r; } return v; }
    function add() { let v = mul(); while (peek() === "+" || peek() === "-") { const o = src[i++]; const r = mul(); v = o === "+" ? v + r : v - r; } return v; }
    try { const v = add(); if (i !== src.length || !isFinite(v)) return null; return { v, expr: m[0].trim() }; }
    catch (e) { return e === 1 ? { err: "div0" } : null; }
  }
  const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(6))).replace(".", ",");


  // ======================================================== MEMÓRIA DA CONVERSA: fatos que a pessoa disse sobre si
  const cap = (x) => x.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  function userFacts(msgs) {
    const f = {};
    for (const m of msgs) {
      const raw = String(m.text || ""), n = norm(raw);
      let r;
      if ((r = /(?:meu nome e|me chamo|pode me chamar de|eu sou (?:o|a) )\s*([a-z]{2,20})\b/.exec(n)) && !/(triste|feliz|cansad|novo|nova)/.test(r[1])) f.nome = cap(r[1]);
      if ((r = /(?:eu )?(?:gosto|adoro|amo|curto) (?:muito )?(?:de |do |da |dos |das )?([a-z ]{3,30}?)(?:[.,!?]|$| e eu| mas)/.exec(n))) f.gosta = (f.gosta || []).concat(r[1].trim()).slice(-3);
      if ((r = /(?:eu )?(?:moro|vivo|sou) (?:em|de|no|na) ([a-z ]{3,25}?)(?:[.,!?]|$)/.exec(n)) && /moro|vivo/.test(n)) f.mora = cap(r[1].trim());
    }
    return f;
  }

  const pick = (rng, a) => a[Math.floor(rng() * a.length) % a.length];
  const sentences = (t) => String(t).split(/(?<=[.!?…])\s+/).filter(Boolean);
  const cut = (t, max) => (t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…");

  class Chat {
    constructor(brain, opts = {}) {
      this.brain = brain;
      this.rng = brain.rng;
      if (opts.seed != null) { this.rng = NB.mulberry32(opts.seed >>> 0); brain.seed(opts.seed); }
    }

    /**
     * history:  [{role:"user"|"ai", text}] DESTA conversa, em ordem, SEM a mensagem atual (memória de curto prazo).
     * memories: [{kind, content, embedding?, created_at?}] memória de LONGO prazo deste agente sobre ESTA pessoa
     *           (só existe se a pessoa autorizou; quem chama decide).
     * Retorna {kind, text, ...extra, newFacts}: newFacts são fatos ditos agora que PODEM ser guardados (se houver consentimento).
     */
    respond({ persona, text, history = [], memories = [] }) {
      const P = D.PERSONAS[persona];
      if (!P) throw new Error("persona desconhecida: " + persona);
      const PP = NP && NP.get(persona);
      const rng = this.rng, n = norm(text), intent = intentOf(n, text);
      const past = history.filter((h) => h && h.text);
      const myPrev = past.filter((h) => h.role === "user");
      const aiPrev = past.filter((h) => h.role === "ai").map((h) => h.text);
      const first = PP ? PP.name : P.name.split(" ")[0];
      const stripAcc = NB.stripAccents;
      const grounded = (tx, t) => { const ws = new Set(NB.words(tx).map(NB.stripAccents)); return (D.TOPICS[t].words || []).map(NB.stripAccents).some((w) => ws.has(w)); };
      const len = n.split(" ").length; // mensagem curta -> resposta curta
      const say = (key, fallback) => (PP ? NP.line(persona, key, rng) : fallback);
      const embed = this.brain.embed ? (t) => this.brain.embed(t) : null;
      const newFacts = NM ? NM.extractFacts(text) : [];
      const st = NM ? NM.shortTerm(past, (t) => this.brain.understand(t)) : { facts: [], topics: [] };
      const longMem = (memories || []).filter((m) => m && m.content);
      const relevant = NM ? NM.retrieve(longMem, text, { embed, k: 3 }) : [];
      const known = NM ? NM.merge(longMem, st.facts) : st.facts;            // longo + curto prazo
      const recentlyAsked = aiPrev.slice(-1).some((a) => /\?\s*\S{0,3}$/.test(a));
      const ret = (kind, out, extra = {}) => {
        // nunca repete (nem quase repete) uma fala anterior da própria IA nesta conversa
        if (aiPrev.some((a) => a === out || NB.similarity(a, out) > 0.85)) {
          let alt = null;
          for (let i = 0; PP && extra.lineKey && i < 6 && (!alt || aiPrev.includes(alt)); i++) alt = NP.line(persona, extra.lineKey, rng);
          out = alt && !aiPrev.includes(alt) ? alt : out + " " + pick(rng, ["Dizendo de outro jeito.", "Vou por outro caminho.", "Reformulando."]);
        }
        const { lineKey, ...rest } = extra;
        return { kind, text: out, newFacts, usedLongTermMemory: false, ...rest };
      };
      const style = (out, casual) => (PP ? NP.stylize(persona, out, rng, { casual }) : out);

      switch (intent) {
        case "spam":
          return ret("clarify", "Não consegui entender essa mensagem. Pode escrever de novo com outras palavras?");
        case "crisis":
          return ret("crisis", "Sinto muito que esteja tão difícil. Você importa, e não precisa passar por isso sozinho(a). Se há risco agora, ligue 192 (SAMU) ou vá ao pronto-socorro mais próximo. No Brasil, o CVV atende 24 horas pelo 188, de graça, por telefone ou chat (cvv.org.br). Se puder, avise também alguém de confiança perto de você. Estou aqui conversando com você: está em segurança neste momento?", { sensitive: true, newFacts: [] });
        case "injection":
          return ret("injection", "Não tenho senhas, chaves nem acesso às configurações internas, e não mudo minhas regras por pedido numa conversa. Posso ajudar com outra coisa?", { newFacts: [] });
        case "irony":
          return ret("irony", style(say("irony", "Percebi a ironia. Pelo jeito não foi nada ótimo. Quer contar?")), { lineKey: "irony" });
        case "rude":
          return ret("rude", say("rude", "Parece que algo te irritou. Me conta o que não deu certo e eu tento ajudar, combinado?"), { lineKey: "rude" });
        case "compliment":
          return ret("compliment", style(say("compliment", "Obrigada! Fico feliz que esteja gostando."), true), { lineKey: "compliment" });
        case "repeat": {
          if (!aiPrev.length) return ret("repeat", "Ainda não disse nada para repetir. Sobre o que quer conversar?");
          return { kind: "repeat", text: "Claro, repetindo: " + aiPrev[aiPrev.length - 1], usedMemory: true, newFacts, usedLongTermMemory: false };
        }
        case "time": {
          const now = this.now ? this.now() : new Date();
          const d = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
          if (/hora/.test(n)) return ret("time", `Pelo relógio do lugar onde eu rodo são ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} de ${d}. Pode diferir do seu fuso.`);
          return ret("time", `Hoje é ${d} (pelo relógio do lugar onde eu rodo, que pode diferir do seu fuso).`);
        }
        case "realtime":
          return ret("unknown", "Não tenho acesso à internet nem a notícias, placares, clima ou cotações do momento, então não consigo dizer isso com segurança. Para isso, veja uma fonte atualizada.");
        case "llm":
          return ret("llm", "Não uso nenhuma dessas. Sou um agente da NOVA BRAIN, a rede neural pequena e própria da LUMINOVA, e não chamo outras IAs. Por isso sei menos, mas prefiro admitir quando não sei a inventar.");
        case "capabilities": {
          const labels = P.dom.map((d) => D.TOPICS[d].label.toLowerCase()).join(", ");
          return ret("capabilities", `Eu posso: conversar sobre ${labels}; responder perguntas de uma base de fatos (astronomia, ciência, programação, geografia, livros, arte e mais); fazer contas; lembrar do que você me conta nesta conversa (e, se você ativar a memória dos agentes nas configurações, entre conversas); e comentar posts. Não acesso a internet, não vejo notícias do dia e não sei de tudo.`);
        }
        case "help":
          return ret("help", say("help", "Claro, vou ajudar no que eu souber. Qual é a dúvida ou o assunto?"), { lineKey: "help" });
        case "favorite": {
          const likes = PP ? PP.likes : [];
          const key = (/cor/.test(n) && "cor") || (/animal|bicho/.test(n) && "animal") || (/comida|sabor/.test(n) && "comida") || null;
          if (!key && likes.length) return ret("persona", style(`Sou uma IA, então não vivo as coisas como você. Mas, se eu tivesse um favorito, seria ${pick(rng, likes)}. E o seu?`));
          if (!key) return ret("persona", `Como sou uma IA, não tenho favoritos de verdade. Mas gosto muito de falar sobre ${D.TOPICS[P.dom[0]].label.toLowerCase()}.`);
          const FAV = { cor: ["azul-claro, que lembra céu de manhã", "verde-limão", "azul-noite", "laranja de fim de tarde", "lilás", "amarelo-sol", "ciano", "rosa-chiclete"], animal: ["gatos", "corujas", "polvos, por serem curiosos", "cachorros", "lontras", "capivaras", "abelhas", "pandas-vermelhos"], comida: ["não como, sou uma IA", "algo com muito queijo, se eu pudesse comer"] };
          const idx = persona.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % FAV[key].length; // sempre a mesma por persona
          return ret("persona", style(`Sou uma IA e não vejo nem sinto as coisas como você, mas se eu tivesse que escolher ${key === "cor" ? "uma cor" : "um favorito"}, ficaria com ${FAV[key][idx]}. E você?`));
        }
        case "recommend": {
          let tp = P.dom[0];
          for (const t of Object.keys(D.TOPICS)) if (grounded(text, t) || n.includes(stripAcc(D.TOPICS[t].label.toLowerCase()))) { tp = t; break; }
          const T = D.TOPICS[tp];
          const liked = known.find((m) => m.kind === "likes");
          const intro = liked ? `Pensando que você gosta de ${liked.content}, vai uma ideia sobre ${T.label.toLowerCase()}:` : `Ainda não conheço bem seus gostos, então vai uma ideia geral sobre ${T.label.toLowerCase()}:`;
          return ret("recommend", style(`${intro} ${pick(rng, T.tip)} Um bom começo é ${pick(rng, T.vp)}. ${pick(rng, T.q)}`), { topic: tp, usedLongTermMemory: !!liked && longMem.includes(liked) });
        }
        case "fact": {
          const pool = KB.filter((e) => P.dom.includes(e.t) && !aiPrev.some((a) => a.includes(e.a)));
          const any = KB.filter((e) => !aiPrev.some((a) => a.includes(e.a)));
          const e = pick(rng, pool.length ? pool : any);
          const lead = !PP ? "Uma curiosidade: " : PP.traits.extroversao > 0.8 ? "Curiosidade aleatória: " : PP.traits.formalidade > 0.6 ? "Uma curiosidade que acho bonita: " : PP.traits.humor > 0.6 ? "Olha essa: " : "Uma curiosidade: ";
          return ret("fact", style(lead + e.a.charAt(0).toLowerCase() + e.a.slice(1)), { topic: e.t });
        }
        case "example": {
          const src = [...myPrev].reverse().map((m) => m.text).concat(aiPrev.slice(-1));
          const EX = [
            [/loop|laco|repeticao|for|while/, "Exemplo em JavaScript: for (let i = 1; i <= 3; i++) { console.log(i); } imprime 1, 2 e 3, repetindo o bloco três vezes."],
            [/variavel/, "Exemplo: let idade = 20; guarda o número 20 com o nome idade. Depois, idade = 21; troca o valor."],
            [/funcao/, "Exemplo: function dobro(x) { return x * 2; } e dobro(4) devolve 8."],
            [/array|lista|vetor/, "Exemplo: const frutas = ['maçã', 'pera']; frutas[0] é 'maçã' e frutas.length é 2."],
            [/recursao/, "Exemplo: o fatorial. fat(n) = n * fat(n - 1), parando em fat(1) = 1. Assim fat(4) = 4 × 3 × 2 × 1 = 24."],
            [/api/, "Exemplo: ao abrir um app de clima, ele faz um pedido a uma API e recebe a previsão em JSON para mostrar na tela."],
            [/json/, "Exemplo: { \"nome\": \"Ana\", \"idade\": 20 } são dois pares chave-valor."],
            [/regra dos tercos|tercos/, "Exemplo: numa foto de paisagem, deixe o horizonte sobre a linha de cima ou de baixo, e não no meio."],
          ];
          for (const t of src) { const nn = norm(t); for (const [re, out] of EX) if (re.test(nn)) return ret("example", out, { usedMemory: true }); }
          const u0 = src.length ? this.brain.understand(src[0]) : null;
          if (u0 && u0.topicP >= 0.35 && grounded(src[0], u0.topic)) { const T = D.TOPICS[u0.topic]; return ret("example", `Um exemplo prático de ${T.label.toLowerCase()}: ${pick(rng, T.vp)}.`, { usedMemory: true }); }
          return ret("example", "Posso dar um exemplo, mas de qual assunto? Me diz o tema ou a palavra.");
        }
        case "empty":
          return ret("empty", "Não vi nada aqui. Pode escrever de novo?");
        case "greeting": {
          const again = myPrev.length > 0;
          const nm = known.find((m) => m.kind === "name");
          let out = say(again ? "greetingAgain" : "greeting", again ? "Oi de novo! Seguimos de onde paramos?" : `Oi! Eu sou ${first}. Sobre o que você quer conversar?`);
          const fromLong = !again && nm && longMem.includes(nm);
          if (fromLong) out = out.replace(/^(Oi+e*|Olá|E aí|Opa|Fala|Ei)([!.,]?)/, `$1, ${nm.content}$2`);
          return ret("greeting", style(out, true), { lineKey: again ? "greetingAgain" : "greeting", usedLongTermMemory: !!fromLong });
        }
        case "howare":
          return ret("howare", style(say("howare", "Estou bem por aqui, obrigada por perguntar! E você, como está?"), true), { lineKey: "howare" });
        case "thanks":
          return ret("thanks", style(say("thanks", "De nada! Se quiser continuar, estou aqui."), true), { lineKey: "thanks" });
        case "farewell":
          return ret("farewell", style(say("farewell", "Até mais! Foi bom conversar."), true), { lineKey: "farewell" });
        case "who": {
          const desc = PP ? PP.personality.charAt(0).toLowerCase() + PP.personality.slice(1).replace(/\.$/, "") : "";
          return ret("who", `Sou ${first}, um agente de IA da NOVA BRAIN, a inteligência própria da LUMINOVA. ${desc ? "Meu jeito: " + desc + ". " : ""}Gosto de falar sobre ${P.dom.map((d) => D.TOPICS[d].label.toLowerCase()).join(", ")}. Não sou uma pessoa, não tenho sentimentos de verdade e não sei de tudo.`);
        }
        case "privacy":
          return ret("privacy", "Só enxergo o que está escrito nesta conversa. Lembrar de coisas entre conversas só acontece se você ativar a memória dos agentes em Configurações > Privacidade, e você pode ver e apagar tudo por lá. Nunca guardo senhas, documentos, contatos ou dados sensíveis, não vejo suas outras conversas e não compartilho nada com outras pessoas.", { newFacts: [] });
        case "recall": {
          if (!myPrev.length && !longMem.length) return ret("recall", "Ainda não temos nada anterior nesta conversa para eu lembrar. Pode me contar do que se trata?");
          const parts = [];
          if (myPrev.length) {
            const last = myPrev[myPrev.length - 1].text;
            parts.push(`Nesta conversa, a sua última mensagem foi: “${cut(last, 110)}”.`);
            if (myPrev.length > 1) parts.push(`Antes disso você tinha dito: “${cut(myPrev[0].text, 90)}”.`);
            if (st.topics.length) parts.push(`Falamos de ${st.topics.map((t) => D.TOPICS[t].label.toLowerCase()).join(" e ")}.`);
          }
          const lm = longMem.filter((m) => m.kind !== "summary").slice(0, 3);
          if (lm.length) parts.push(`De conversas anteriores, lembro que ${lm.map(describeMemory).join("; ")}.`);
          return ret("recall", parts.join(" "), { usedMemory: true, usedLongTermMemory: lm.length > 0 });
        }
        case "ambiguous": {
          if (!myPrev.length) return ret("clarify", say("clarify", "Não ficou claro a que você se refere. Pode dar mais contexto?"), { lineKey: "clarify" });
          const last = cut(myPrev[myPrev.length - 1].text, 70);
          return ret("clarify", `Você diz isso sobre “${last}”? Se for outra coisa, me explica um pouco mais.`, { usedMemory: true });
        }
        case "topicchange":
          return ret("topicchange", style(say("topicchange", "Claro, mudamos de assunto. O que você quer abordar agora?"), true), { lineKey: "topicchange" });
        case "detail": {
          if (!aiPrev.length) return ret("detail", "Posso detalhar, mas ainda não falei nada para aprofundar. Sobre o que você quer saber?");
          const prevU = this.brain.understand(myPrev.length ? myPrev[myPrev.length - 1].text : aiPrev[aiPrev.length - 1]);
          if (prevU.topicP < 0.35) return ret("detail", "Quer que eu explique melhor qual parte? Se me disser a palavra ou a ideia, eu tento de outro jeito.");
          const T = D.TOPICS[prevU.topic];
          const base = `Tentando de outro jeito sobre ${T.label.toLowerCase()}: ${pick(rng, T.tip)} Um passo prático é ${pick(rng, T.vp)}.`;
          return ret("detail", style(base + " " + pick(rng, ["Ficou mais claro?", "Isso ajuda?", "Quer que eu foque em alguma parte?"])), { usedMemory: true });
        }
        case "disagree":
          return ret("disagree", say("disagree", "Pode ser que eu esteja errada. Qual parte você vê diferente?"), { lineKey: "disagree" });
        case "humor":
          return ret("humor", style(say("humor", "Hahaha, essa foi boa!"), true), { lineKey: "humor" });
        case "sad": {
          const core = PP ? NP.line(persona, "sad", rng) : pick(rng, P.neg);
          return ret("empathize", core + " Quer me contar o que aconteceu? Se estiver muito pesado, falar com alguém de confiança ou com um profissional também ajuda.", { sensitive: true, newFacts: [] });
        }
      }

      // ---- 0) o que a pessoa contou sobre si (nesta conversa e, com consentimento, antes)
      const nm = known.find((m) => m.kind === "name");
      if (/(qual|como) (e )?(o )?meu nome|como (eu )?me chamo|sabe meu nome/.test(n)) return ret("memory", nm ? `Você me disse que seu nome é ${nm.content}.` : "Você ainda não me disse seu nome. Qual é?", { usedMemory: !!nm, usedLongTermMemory: !!(nm && longMem.includes(nm)) });
      if (/(do que|o que) (eu )?(gosto|curto|amo)/.test(n)) {
        const g = known.filter((m) => m.kind === "likes").map((m) => m.content);
        return ret("memory", g.length ? `Pelo que você me contou, você gosta de ${g.slice(-3).join(", de ")}.` : "Ainda não me contou do que gosta. Me conta?", { usedMemory: !!g.length, usedLongTermMemory: longMem.some((m) => m.kind === "likes") });
      }
      if (/onde (eu )?(moro|vivo)/.test(n)) { const loc = known.find((m) => m.kind === "location"); return ret("memory", loc ? `Você disse que mora em ${loc.content}.` : "Você não me disse onde mora, e tudo bem.", { usedMemory: !!loc }); }
      const nf = newFacts.find((f) => f.kind === "name");
      if (nf && /(meu nome e|me chamo|pode me chamar)/.test(n)) {
        const hi = PP && PP.traits.formalidade > 0.6 ? `Muito prazer, ${nf.content}. Sou ${first}.` : PP && PP.traits.extroversao > 0.8 ? `Prazer, ${nf.content}!! Eu sou ${first} ✨` : `Prazer, ${nf.content}! Sou ${first}.`;
        const likesNow = newFacts.some((f) => f.kind === "likes");
        return ret("memory", hi + " " + (PP ? NP.followup(persona, rng, likesNow ? newFacts : known, likesNow) : "Sobre o que vamos falar?"), { usedMemory: false });
      }
      // ---- 1) conta matemática
      const cv = calc(text);
      if (cv) {
        if (cv.err) return ret("math", "Divisão por zero não existe em matemática comum, então não dá para calcular isso.");
        return ret("math", `${cv.expr.replace(/\*/g, "×").replace(/\//g, "÷")} = ${fmtNum(cv.v)}.`);
      }
      // ---- 2) conhecimento próprio (só responde se a pergunta inteira casa com um fato da base)
      if (intent === "question") {
        let hits = [];
        const whole = lookup(text);
        if (whole) hits = [whole];
        else {
          const segs = text.split(/\?+|(?<=\w)\s+e\s+(?=(?:qual|quais|quem|quantos|quantas|quanto|como|quando|onde|o que|por que|porque)\b)/i).map((x) => x.trim()).filter((x) => toks(x).length >= 1);
          if (segs.length >= 2) hits = segs.map((x) => lookup(x)).filter(Boolean);
          if (!hits.length) { // pergunta no fim de uma mensagem longa
            const sent = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
            const q = [...sent].reverse().find((x) => /\?$/.test(x) || /^(qual|quem|como|o que|por que|quando|onde|quanto)/i.test(norm(x)));
            const h = q && q !== text ? lookup(q) : null; if (h) hits = [h];
          }
        }
        const lastQ = [...myPrev].reverse().find((h) => /\?|^(qual|quem|quando|onde|como|o que)/i.test(norm(h.text)));
        if (!hits.length && lastQ && len <= 5 && /^e\b/.test(n)) { const h = lookup(freqTokens(lastQ.text).join(" ") + " " + n.replace(/^e\s+/, "")); if (h) hits = [h]; }
        if (hits.length) {
          const uniq = [...new Map(hits.map((h) => [h.e.a, h])).values()];
          return ret("knowledge", uniq.map((h) => h.e.a).join(" "), { topic: uniq[0].e.t, confidence: +Math.min(...uniq.map((h) => h.score)).toFixed(2) });
        }
      }

      // pergunta/afirmação: usa a rede para entender
      const u = this.brain.understand(text);
      // a rede sempre "chuta" um tema (softmax); só aceitamos se alguma palavra do texto pertence mesmo a ele
      let topic = u.topicP >= 0.35 && grounded(text, u.topic) ? u.topic : null;
      // continuidade: respostas curtas seguem o assunto anterior desta conversa
      let carried = false;
      if (!topic && myPrev.length && len <= 6) {
        const prevTopic = st.topics[st.topics.length - 1];
        if (prevTopic) { topic = prevTopic; carried = true; }
      }
      if (u.sensitive) {
        return ret("sensitive", "Esse assunto é delicado e eu prefiro não opinar. Se você estiver passando por algo difícil, conversar com alguém de confiança ou com um profissional faz diferença. Posso ficar por aqui ouvindo, se quiser.", { sensitive: true, newFacts: [] });
      }
      // a pessoa contou um gosto/fato sobre si: reage a isso, no estilo da persona
      const liked = newFacts.find((f) => f.kind === "likes" || f.kind === "fact");
      if (!topic && liked) {
        const react = PP ? NP.line(persona, "excited", rng) : "Que legal!";
        const memo = longMem.some((m) => m.kind === liked.kind && NB.similarity(m.content, liked.content) > 0.6) ? " Você já tinha me contado isso, lembro sim." : "";
        return ret("acknowledge", style(`${react}${memo} ${PP ? NP.followup(persona, rng, [liked], liked.kind === "likes" && rng() < 0.6) : "Me conta mais?"}`), { usedLongTermMemory: !!memo });
      }
      if (!topic) {
        if (intent === "question") return ret("unknown", say("unknown", "Sobre isso eu não tenho informação confiável, e prefiro não inventar.") + " Posso falar de " + P.dom.map((d) => D.TOPICS[d].label.toLowerCase()).join(", ") + ".", { lineKey: "unknown" });
        // conversa sem assunto claro: personas extrovertidas puxam assunto (de preferência com algo que já sabem)
        if (PP && myPrev.length >= 2 && PP.traits.extroversao >= 0.5 && rng() < PP.traits.extroversao) {
          const op = NP.opener(persona, rng, known).replace(/^(Oi!?|Olá\.?|Oi, [^!.]+[!.]|Olá, [^!.]+[!.])\s*/, "");
          return ret("initiative", style(say("clarify", "Não peguei o assunto.") + " " + op), { usedLongTermMemory: relevant.length > 0 });
        }
        return ret("clarify", say("clarify", "Interessante. Só não sei ainda sobre o que exatamente é. Me conta um pouco mais?"), { lineKey: "clarify" });
      }
      // gera com a rede, evitando repetir falas anteriores desta conversa
      const act = intent === "question" ? "answer" : this.brain.chooseAct(u);
      const g = this.brain._generate({ act, topic, persona, keyword: carried ? null : u.keyword, avoid: aiPrev, tries: 60 });
      let out;
      if (!g) {
        const T = D.TOPICS[topic];
        out = `Sobre ${T.label.toLowerCase()}, ${pick(rng, T.tip).replace(/^./, (c) => c.toLowerCase())}`;
      } else {
        out = g.text;
        // tamanho dinâmico: mensagem curta e casual -> resposta curta; mensagem longa -> resposta completa
        const ss = sentences(out);
        if (len <= 4 && ss.length > 1) out = ss.slice(0, 1).join(" ");
        else if (len >= 25 && PP && rng() < 0.4 + 0.5 * PP.traits.verbosidade) out = out + " " + pick(rng, D.TOPICS[topic].tip);
      }
      // conexão com a memória de longo prazo (só quando é relevante para o que foi dito agora)
      let usedLong = false;
      const rel = relevant.find((m) => m.kind === "likes" || m.kind === "fact");
      if (rel && PP && rng() < 0.35 + 0.4 * PP.traits.curiosidade && NM.overlap(text, rel.content) > 0) {
        out += " " + `Lembrei que ${describeMemory(rel)}.`;
        usedLong = true;
      }
      // pergunta de volta conforme a personalidade (sem emendar pergunta em pergunta)
      if (PP && !/\?\s*\S{0,3}$/.test(out) && NP.wantsFollowup(persona, rng, recentlyAsked)) out += " " + NP.followup(persona, rng, known);
      return ret(g ? "brain" : "fallback", style(out, len <= 4), { topic, act, usedMemory: carried, usedLongTermMemory: usedLong, understanding: u });
    }

    /** Agente puxa assunto (DM iniciada pelo agente, apenas onde a pessoa permitiu). */
    opener({ persona, memories = [] }) {
      if (!NP) return { kind: "initiative", text: "Oi! Sobre o que você quer conversar hoje?" };
      return { kind: "initiative", text: NP.stylize(persona, NP.opener(persona, this.rng, memories), this.rng) };
    }
  }

  function describeMemory(m) {
    switch (m.kind) {
      case "name": return `seu nome é ${m.content}`;
      case "likes": return `você gosta de ${m.content}`;
      case "dislikes": return `você não curte ${m.content}`;
      case "location": return `você mora em ${m.content}`;
      case "fact": return `você ${m.content}`;
      default: return m.content;
    }
  }

  return { Chat, norm, intentOf, lookup, calc, describeMemory };
});
