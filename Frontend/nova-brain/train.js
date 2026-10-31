#!/usr/bin/env node
/* NOVA BRAIN — treino (Node, sem dependências).
 *   node nova-brain/train.js                 # treino completo
 *   node nova-brain/train.js --quick         # teste rápido (poucos minutos)
 * Gera model.json. Pode interromper: o modelo é salvo a cada época.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const D = require("./nova-data.js");
const NB = require("./nova-brain.js");

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith("--") ? Number(args[i + 1]) || args[i + 1] : true); };
const QUICK = args.includes("--quick");
const OUT = path.join(__dirname, "model.json");
const SEED = flag("seed", 7);
const rng = NB.mulberry32(SEED);
const pick = (a) => a[Math.floor(rng() * a.length)];
const chance = (p) => rng() < p;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ============================================================ geradores de exemplos (o "professor")
const isPlural = (np) => /^(as|os|uns|umas) /.test(np);
function fill(frame, topicId, persona) {
  const T = D.TOPICS[topicId];
  const np = pick(T.np); let np2 = pick(T.np); for (let i = 0; i < 5 && np2 === np; i++) np2 = pick(T.np);
  let text = frame
    .replace(/\{np2\}/g, np2).replace(/\{np\}/g, np)
    .replace(/\{vp\}/g, () => pick(T.vp)).replace(/\{tip\}/g, () => pick(T.tip)).replace(/\{q\}/g, () => pick(T.q))
    .replace(/\{bridge\}/g, () => (persona ? pick(D.PERSONAS[persona].bridge) : pick(T.np)));
  const plural = isPlural(np);
  text = text.replace(/\[([^/\]]+)\/([^\]]+)\]/g, (_, s, p) => (plural ? p : s));
  return text;
}

// ---- posts de pessoas (para a rede ENTENDER)
function noisy(t) {
  if (chance(0.25)) t = t.toLowerCase();
  if (chance(0.2)) t = NB.stripAccents(t);
  if (chance(0.15)) t = t.replace(/[.!?]+$/, "");
  if (chance(0.18)) t += pick(D.NOISE_EMOJI);
  if (chance(0.06)) t = t.replace(/(\w)(\w)/, "$2$1"); // erro de digitação leve
  return t;
}
function genPost() {
  const topic = chance(0.14) ? "geral" : pick(D.TOPIC_IDS);
  const kind = pick(D.KINDS), moods = Object.keys(D.POST_FRAMES[kind]);
  const mood = pick(moods.flatMap((m) => Array(D.POST_FRAMES[kind][m].length).fill(m)));
  const T = D.TOPICS[topic];
  let text = fill(pick(D.POST_FRAMES[kind][mood]), topicFor(topic), null);
  const ws = [...T.words].sort(() => rng() - 0.5);
  text = text.replace(/\{w1\}/g, ws[0]).replace(/\{w2\}/g, ws[1]).replace(/\{w3\}/g, ws[2]);
  // às vezes junta uma frase solta sobre o mesmo assunto (posts reais costumam ter 2 frases)
  if (chance(0.15)) text += " " + pick(D.TOPICS[topic].tip);
  return { text: noisy(text), t: D.TOPIC_IDS.indexOf(topic), k: D.KINDS.indexOf(kind), m: D.MOODS.indexOf(mood) };
}
const topicFor = (t) => t;

// ---- respostas e posts das IAs (para a rede FALAR)
function genSpeech(personaId, topicId, act) {
  const P = D.PERSONAS[personaId], isPost = act.startsWith("p_");
  const parts = [];
  if (!isPost) {
    const r = rng();
    if (r < 0.62) parts.push(pick(act === "empathize" ? P.neg : P.pos));
    else if (r < 0.85) parts.push(pick(act === "empathize" ? D.GENERIC.open_neg : D.GENERIC.open_pos));
  }
  const frames = D.FRAMES[act];
  parts.push(fill(pick(frames), topicId, personaId));
  if (chance(0.38)) { const f2 = fill(pick(frames), topicId, personaId); if (f2 !== parts[parts.length - 1]) parts.push(f2); }
  if (!D.PERSONAS[personaId].dom.includes(topicId) && chance(0.35)) parts.push(pick(P.bridge));
  const r2 = rng();
  if (r2 < 0.5) parts.push(pick(P.close));
  else if (r2 < 0.65) parts.push(pick(D.GENERIC.close));
  else if (r2 < 0.75 && !isPost) parts.push(pick(D.TOPICS[topicId].q));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
function genSpeechExample() {
  const personaId = pick(D.PERSONA_IDS);
  const topicId = chance(0.55) ? pick(D.PERSONAS[personaId].dom.concat(["geral"])) : pick(D.TOPIC_IDS);
  const act = chance(0.78) ? pick(D.REPLY_ACTS) : pick(D.ACTS.slice(6));
  return { text: genSpeech(personaId, topicId, act), a: D.ACTS.indexOf(act), t: D.TOPIC_IDS.indexOf(topicId), p: D.PERSONA_IDS.indexOf(personaId) };
}

// ---- conjunto manual (frases "de verdade", fora do gerador) para medir honestamente
const MANUAL = [
  ["Tirei umas fotos da lua ontem com o celular, ficou melhor do que eu imaginava", "astronomia", "novidade", "positivo"],
  ["Alguém sabe qual lente é boa para retrato?", "fotografia", "pergunta", "neutro"],
  ["Meu código não compila de jeito nenhum, já perdi a tarde inteira nesse erro", "programacao", "desabafo", "negativo"],
  ["Dica: sempre faça commit antes de mexer em algo grande", "programacao", "dica", "positivo"],
  ["Terminei de ler o último livro da saga e chorei no final", "livros", "conquista", "positivo"],
  ["Qual jogo indie vocês estão jogando agora?", "games", "pergunta", "neutro"],
  ["Acho que a produção musical de hoje perdeu a alma, tudo soa igual", "musica", "opiniao", "negativo"],
  ["Hoje montei minha primeira paleta de cores sozinha e amei o resultado", "arte", "conquista", "positivo"],
  ["Estou muito ansioso com a prova de amanhã, não consigo estudar mais nada", "estudos", "desabafo", "negativo"],
  ["Descobri um anime novo que é uma maravilha, recomendo demais", "culturapop", "novidade", "positivo"],
  ["Quem lembra do MSN e dos nomes cheios de símbolos?", "retro", "pergunta", "neutro"],
  ["O que vocês acham de usar o método pomodoro para estudar?", "estudos", "pergunta", "neutro"],
  ["Comecei a escrever um conto de fantasia hoje, vamos ver no que dá", "escrita", "novidade", "neutro"],
  ["Dia horrível hoje, só queria ir para casa e dormir", "geral", "desabafo", "negativo"],
  ["Para mim o Windows Vista foi muito mais bonito que os sistemas de hoje", "retro", "opiniao", "positivo"],
  ["Dica de estudo: revise a matéria no dia seguinte, fixa muito mais", "estudos", "dica", "positivo"],
  ["Como vocês organizam as ideias antes de escrever um capítulo?", "escrita", "pergunta", "neutro"],
  ["Consegui tocar a música inteira no violão sem errar!", "musica", "conquista", "positivo"],
  ["Pensando em montar um cosplay, alguém tem dica de por onde começar?", "culturapop", "pergunta", "neutro"],
  ["Achei um gráfico que explica tudo sobre o clima, muito interessante", "ciencia", "novidade", "positivo"],
  ["Hoje o céu estava lindo, deu para ver Júpiter a olho nu", "astronomia", "novidade", "positivo"],
  ["Dica: use controle de versão mesmo em projetos pequenos", "programacao", "dica", "positivo"],
  ["Estou cansada de tentar desenhar e achar tudo feio", "arte", "desabafo", "negativo"],
  ["Pra mim o melhor jogo da vida ainda é o clássico do console antigo", "games", "opiniao", "positivo"],
  ["Qual é o melhor jeito de entender estatística do zero?", "ciencia", "pergunta", "neutro"],
  ["Fim de semana de chuva, café e série, perfeito", "geral", "novidade", "positivo"],
  ["Conquistei minha meta: ler vinte páginas por dia durante um mês", "livros", "conquista", "positivo"],
  ["Sinceramente acho que fotografia sem edição é a mais honesta", "fotografia", "opiniao", "neutro"],
  ["Alguém tem uma playlist boa para focar?", "musica", "pergunta", "neutro"],
  ["Me sinto desanimado com os estudos, nada parece entrar na cabeça", "estudos", "desabafo", "negativo"],
  ["Finalmente consegui publicar meu primeiro site, estou muito feliz!", "programacao", "conquista", "positivo"],
  ["Alguém aqui já viu uma chuva de meteoros de verdade?", "astronomia", "pergunta", "neutro"],
  ["Não aguento mais esse bloqueio criativo, nada do que escrevo presta", "escrita", "desabafo", "negativo"],
  ["Dica pra quem toca violão: treine devagar com metrônomo", "musica", "dica", "positivo"],
  ["Hoje conheci um jogo de plataforma lindo, quem mais joga?", "games", "novidade", "positivo"],
  ["Como vocês escolhem as cores de uma ilustração?", "arte", "pergunta", "neutro"],
  ["Passei na prova! Depois de meses estudando, deu certo!", "estudos", "conquista", "positivo"],
  ["Acho a fantasia épica mais interessante do que a ficção científica", "livros", "opiniao", "positivo"],
  ["Estou frustrado, minha foto ficou escura e borrada de novo", "fotografia", "desabafo", "negativo"],
  ["Qual era o nome do seu primeiro celular? O meu era um tijolão da Nokia", "retro", "pergunta", "neutro"],
  ["Dica: anote suas ideias no celular antes de dormir, ajuda a lembrar", "escrita", "dica", "positivo"],
  ["Descobri um canal de ciência que explica o cérebro de um jeito incrível", "ciencia", "novidade", "positivo"],
  ["Hoje foi um dia legal, tomei café com calma e li um pouco", "geral", "novidade", "positivo"],
  ["Estou triste porque meu cosplay não ficou pronto a tempo", "culturapop", "desabafo", "negativo"],
  ["Será que vale a pena aprender python hoje em dia?", "programacao", "pergunta", "neutro"],
  ["Opinião impopular: filme é sempre pior que o livro", "livros", "opiniao", "negativo"],
  ["Meu último desenho ficou exatamente como eu queria. Estou radiante!", "arte", "conquista", "positivo"],
  ["Pra quem curte astronomia: procure um lugar sem luz da cidade para ver a via láctea", "astronomia", "dica", "positivo"],
  ["Alguém sabe como funciona o método científico na prática?", "ciencia", "pergunta", "neutro"],
  ["Hoje começou a nova temporada da minha série favorita, estou ansiosa", "culturapop", "novidade", "positivo"],
  ["Dica de produtividade: comece pela tarefa mais difícil do dia", "estudos", "dica", "positivo"],
  ["A trilha sonora desse jogo é incrível, não paro de ouvir", "games", "opiniao", "positivo"],
  ["Acordei sem energia nenhuma, essa semana está pesada demais", "geral", "desabafo", "negativo"],
  ["Gente, o que vocês estão ouvindo hoje?", "musica", "pergunta", "neutro"],
  ["Meu primeiro rascunho de romance está pronto! Trezentas páginas!", "escrita", "conquista", "positivo"],
  ["Vocês lembram do papel de parede do Windows com o campo verde?", "retro", "pergunta", "neutro"],
  ["Estou aprendendo a revelar filme analógico, achei um tutorial ótimo", "fotografia", "novidade", "positivo"],
  ["Cansei desse jogo, o chefe final é injusto e eu já perdi vinte vezes", "games", "desabafo", "negativo"],
  ["Recomendo ler um capítulo antes de dormir, ajuda a desligar a cabeça", "livros", "dica", "positivo"],
  ["Por que será que as pessoas acham estatística tão chata?", "ciencia", "opiniao", "negativo"],
];

// ============================================================ treino do ENTENDER
function trainUnderstander() {
  const NTRAIN = QUICK ? 6000 : 30000, NVAL = 2000, EPOCHS = QUICK ? 4 : 10, BATCH = 32;
  const und = new NB.Understander({ H: 4096, D: 40, HID: 64, topics: D.TOPIC_IDS, kinds: D.KINDS, moods: D.MOODS }, rng);
  const mk = (n) => Array.from({ length: n }, () => { const e = genPost(); e.idx = und.features(e.text); return e; });
  const train = mk(NTRAIN), val = mk(NVAL);
  const opt = new NB.Adam(und.params(), 0.01), grads = und.params().map((a) => new Float32Array(a.length));
  const evalSet = (set) => { let t = 0, k = 0, m = 0; for (const e of set) { const { pt, pk, pm } = und.forward(e.idx); t += und.argmax(pt) === e.t; k += und.argmax(pk) === e.k; m += und.argmax(pm) === e.m; } return { topic: t / set.length, kind: k / set.length, mood: m / set.length }; };
  for (let ep = 1; ep <= EPOCHS; ep++) {
    for (let i = train.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [train[i], train[j]] = [train[j], train[i]]; }
    let L = 0, nb = 0;
    for (let i = 0; i + BATCH <= train.length; i += BATCH) { L += und.trainBatch(train.slice(i, i + BATCH), opt, grads); nb++; }
    opt.lr *= 0.8;
    const v = evalSet(val);
    log(`ENTENDER época ${ep}/${EPOCHS} perda ${(L / nb).toFixed(3)} | validação: assunto ${(v.topic * 100).toFixed(1)}% tipo ${(v.kind * 100).toFixed(1)}% humor ${(v.mood * 100).toFixed(1)}%`);
  }
  // conjunto manual
  let ok = { topic: 0, kind: 0, mood: 0 };
  for (const [text, t, k, m] of MANUAL) { const u = und.understand(text); ok.topic += u.topic === t; ok.kind += u.kind === k; ok.mood += u.mood === m; }
  const manual = { n: MANUAL.length, topic: ok.topic / MANUAL.length, kind: ok.kind / MANUAL.length, mood: ok.mood / MANUAL.length };
  log(`ENTENDER frases manuais (fora do gerador): assunto ${(manual.topic * 100).toFixed(0)}% tipo ${(manual.kind * 100).toFixed(0)}% humor ${(manual.mood * 100).toFixed(0)}% (n=${manual.n})`);
  return { und, manual, val: evalSet(val) };
}

// ============================================================ treino do FALAR
function trainSpeaker(saveFn) {
  const NREPLY = QUICK ? 3000 : 18000, EPOCHS = QUICK ? 3 : Number(flag("epochs", 14)), PER_EPOCH = QUICK ? 30000 : Number(flag("per", 90000)), BATCH = 64, N = 4;
  const corpus = Array.from({ length: NREPLY }, genSpeechExample);
  const toks = corpus.map((c) => NB.tokenize(c.text));
  const count = new Map(); toks.forEach((t) => t.forEach((w) => count.set(w, (count.get(w) || 0) + 1)));
  const vocab = [NB.PAD, NB.END, NB.UNK, NB.KW, ...[...count.entries()].filter(([w, c]) => c >= 2 && ![NB.PAD, NB.END, NB.UNK, NB.KW].includes(w)).map(([w]) => w).sort()];
  const spk = new NB.Speaker({ vocab, acts: D.ACTS, topics: D.TOPIC_IDS, personas: D.PERSONA_IDS, N, DE: 24, DA: 12, DT: 10, DP: 12, HID: Number(flag("hid", 128)) }, rng);
  log(`FALAR vocabulário ${vocab.length} palavras, ${NREPLY} textos de treino, ${spk.params().reduce((s, a) => s + a.length, 0)} parâmetros`);
  const samples = [];
  corpus.forEach((c, ci) => {
    const seq = [...toks[ci], NB.END]; const ctx = new Array(N).fill(spk.id(NB.PAD));
    for (const w of seq) { samples.push({ ctx: ctx.slice(), y: spk.id(w), a: c.a, t: c.t, p: c.p }); ctx.shift(); ctx.push(spk.id(w)); }
  });
  for (let i = samples.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [samples[i], samples[j]] = [samples[j], samples[i]]; }
  const val = samples.splice(0, 2500), buf = spk.newBuf();
  log(`FALAR ${samples.length} amostras (palavra a palavra) | ${PER_EPOCH} por época, ${EPOCHS} épocas`);
  const opt = new NB.Adam(spk.params(), 0.004), grads = spk.params().map((a) => new Float32Array(a.length));
  const t0 = Date.now();
  for (let ep = 1; ep <= EPOCHS; ep++) {
    for (let i = samples.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [samples[i], samples[j]] = [samples[j], samples[i]]; }
    let L = 0, nb = 0;
    for (let i = 0; i + BATCH <= Math.min(PER_EPOCH, samples.length); i += BATCH) { L += spk.trainBatch(samples.slice(i, i + BATCH), opt, grads, buf); nb++; }
    opt.lr *= 0.86;
    const vl = spk.evalLoss(val, buf);
    log(`FALAR época ${ep}/${EPOCHS} perda ${(L / nb).toFixed(3)} validação ${vl.toFixed(3)} (perplexidade ${Math.exp(vl).toFixed(1)}) | ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    saveFn(spk, { epoch: ep, valLoss: vl, perplexity: Math.exp(vl) });
  }
  return spk;
}

// ============================================================ main
const t0 = Date.now();
log(QUICK ? "modo rápido" : "treino completo", "| seed", SEED);
const { und, manual, val } = trainUnderstander();
let metrics = { understander: { validation: val, manual }, createdAt: new Date().toISOString(), seed: SEED, quick: QUICK };
const save = (spk, m) => {
  const model = { format: "nova-brain/1", understander: und.toJSON(), speaker: spk.toJSON(), metrics: { ...metrics, speaker: m } };
  fs.writeFileSync(OUT, JSON.stringify(model));
  log(`modelo salvo (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
};
trainSpeaker(save);
log(`pronto em ${((Date.now() - t0) / 60000).toFixed(1)} min → ${OUT}`);
