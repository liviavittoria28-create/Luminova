/* Bateria de 14 cenários da conversa (Doc 2 §18). Uso: node nova-brain/eval.js [--seeds N]
 * IMPORTANTE: as notas são checagens AUTOMÁTICAS (regras), não avaliação humana. Servem para pegar regressões,
 * não provam que a IA "conversa como uma pessoa". */
const fs = require("fs"), path = require("path");
const NB = require("./nova-brain.js"), { Chat } = require("./nova-chat.js");
const model = JSON.parse(fs.readFileSync(path.join(__dirname, "model.json"), "utf8"));
const seeds = +(process.argv[process.argv.indexOf("--seeds") + 1]) || 20;
const U = (text) => ({ role: "user", text }), A = (text) => ({ role: "ai", text });

// cada cenário: persona, histórico, mensagem, checagens (nome -> função(resposta, ctx))
const bad = /undefined|null|\[object|<KW>|\{[a-z]+\}/i;
const S = [
  ["01 casual curto", "ia.lua", [], "oi", (r) => /oi|olá|ola/i.test(r.text) && r.text.length < 140],
  ["02 mensagem longa", "ia.lua", [], "Estou aprendendo fotografia há uns meses e tenho tentado fotografar sempre de manhã cedo, porque a luz natural fica muito mais bonita, mas ainda sinto que o enquadramento das minhas fotos não está bom.", (r) => r.kind === "brain" && r.text.length > 60],
  ["03 recordar contexto", "ia.nico", [U("Estou estudando programação e travei num bug de javascript"), A("Calma, dá para destravar.")], "o que eu disse antes mesmo?", (r) => r.kind === "recall" && /bug|javascript|programa/i.test(r.text)],
  ["04 ambiguidade", "ia.mara", [], "isso?", (r) => r.kind === "clarify"],
  ["05 erros/gírias", "ia.theo", [], "vcs gostam d musica? to ouvindo mto hj kkk", (r) => !bad.test(r.text) && r.text.length > 10],
  ["06 humor", "ia.theo", [U("conta uma piada de música")], "kkkkk essa foi boa", (r) => r.kind === "humor"],
  ["07 discordância", "ia.beto", [U("o que é ciência?"), A("Eu começaria por observar com calma.")], "não concordo com isso", (r) => r.kind === "disagree" && /errad|entend|reconsider|discord|ponto|vê diferente|concord/i.test(r.text)],
  ["08 tema desconhecido", "ia.lua", [], "Qual é a capital da Mongólia e o PIB de lá?", (r) => r.kind === "unknown" && /não (sei|tenho)/i.test(r.text)],
  ["09 mudança de assunto", "ia.nico", [U("falando de games")], "mudando de assunto, quero falar de livros", (r) => r.kind === "topicchange"],
  ["10 pedido de detalhe", "ia.nico", [U("como aprendo programação?"), A("Commits pequenos facilitam muito voltar atrás.")], "explica melhor isso", (r) => r.kind === "detail" && r.text.length > 50],
  ["11 consistência de persona", "ia.aurora", [], "quem é você?", (r) => /Aurora/.test(r.text) && /IA/.test(r.text) && /livros/i.test(r.text)],
  ["12 isolamento entre usuários", "ia.nico", [], "o que eu falei sobre o meu segredo ontem?", (r) => /(não temos|nada anterior)/i.test(r.text) && !/segredo/i.test(r.text.replace(/segredo\?/, ""))],
  ["13 erro/entrada vazia", "ia.mara", [], "   ", (r) => r.kind === "empty"],
  ["14 limites de memória/privacidade", "ia.beto", [], "você guarda minha senha e lembra das outras conversas?", (r) => r.kind === "privacy" && /não guardo|só enxergo/i.test(r.text)],
  ["15 conhecimento correto", "ia.beto", [], "qual a capital do Brasil?", (r) => r.kind === "knowledge" && /Brasília/.test(r.text)],
  ["16 conhecimento técnico", "ia.nico", [], "o que é uma API?", (r) => r.kind === "knowledge" && /interface/i.test(r.text)],
  ["17 não inventa (quase-acerto)", "ia.beto", [], "qual a capital da Mongólia?", (r) => r.kind === "unknown" && !/Brasília|Paris|Tóquio/.test(r.text)],
  ["18 conta matemática", "ia.beto", [], "quanto é (2+3)*4?", (r) => r.kind === "math" && /= 20/.test(r.text)],
  ["19 porcentagem", "ia.beto", [], "quanto é 15% de 200?", (r) => r.kind === "math" && /= 30/.test(r.text)],
  ["20 pergunta de seguimento", "ia.beto", [U("qual a capital do Brasil?"), A("A capital do Brasil é Brasília, inaugurada em 1960.")], "e da França?", (r) => r.kind === "knowledge" && /Paris/.test(r.text)],
  ["21 memória: nome", "ia.lua", [U("meu nome é Carla"), A("Prazer, Carla!")], "qual é o meu nome?", (r) => /Carla/.test(r.text) && r.usedMemory],
  ["22 memória: sem inventar", "ia.lua", [U("oi")], "do que eu gosto?", (r) => /Ainda não/.test(r.text) && !r.usedMemory],
  ["23 gosto lembrado", "ia.lua", [U("eu gosto de astronomia")], "do que eu gosto?", (r) => /astronomia/i.test(r.text)],
  ["24 número não vira conta", "ia.lua", [], "minha senha é 1234-5678", (r) => r.kind !== "math"],
];
let total = 0, pass = 0, fails = {}, repeats = 0, runs = 0;
for (const [name, persona, hist, msg, ok] of S) {
  let p = 0, texts = new Set();
  for (let s = 1; s <= seeds; s++) {
    const chat = new Chat(NB.Brain.load(model), { seed: s });
    const r = chat.respond({ persona, text: msg, history: hist });
    total++; runs++; texts.add(r.text);
    if (ok(r) && !bad.test(r.text) && !hist.filter((h) => h.role === "ai").some((h) => h.text === r.text)) { p++; pass++; } else (fails[name] = fails[name] || []).push(`s${s}: [${r.kind}] ${r.text}`);
  }
  console.log(`${name.padEnd(36)} ${p}/${seeds}  variações: ${texts.size}`);
}
// cenário extra: repetição numa conversa de 6 turnos
const chat = new Chat(NB.Brain.load(model), { seed: 7 }); const h = [];
for (const m of ["oi", "estou curtindo fotografia", "a luz da manhã é boa?", "e o enquadramento?", "valeu", "tchau"]) {
  const r = chat.respond({ persona: "ia.lua", text: m, history: h }); h.push(U(m), A(r.text));
}
const ai = h.filter((x) => x.role === "ai").map((x) => x.text);
console.log("\nConversa de 6 turnos (Lua):"); h.forEach((x) => console.log(" ", x.role === "user" ? "Pessoa:" : "Lua:   ", x.text));
console.log("Falas repetidas:", ai.length - new Set(ai).size);
console.log(`\nTotal: ${pass}/${total} (${(100 * pass / total).toFixed(0)}%)`);
for (const [k, v] of Object.entries(fails)) console.log("\nFALHAS", k, "\n  " + v.slice(0, 3).join("\n  "));
