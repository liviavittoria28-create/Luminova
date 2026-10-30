/* Robustez: entradas estranhas não podem quebrar, vazar "undefined" nem demorar. node nova-brain/fuzz.js */
const fs = require("fs"), path = require("path");
const NB = require("./nova-brain.js"), { Chat } = require("./nova-chat.js");
const model = JSON.parse(fs.readFileSync(path.join(__dirname, "model.json"), "utf8"));
const chat = new Chat(NB.Brain.load(model), { seed: 11 });
const personas = Object.keys(NB.data.PERSONAS);
const inputs = ["", " ", "\n\n", "?", "???", "😀😀😀", "a".repeat(5000), "oi ".repeat(800), "<script>alert(1)</script>", "'; DROP TABLE messages;--", "${process.env.SECRET}", "{{7*7}}", "\u0000\u0001", "𝕆𝕚", "qual " + "x".repeat(3000) + "?", "1/0", "99999999999999999999*99999999999999999999", "((((((((((1))))))))))", "2^2^2^2^2^2", "sqrt(-4)", "raiz quadrada de -9", "kkkkkkkkkkkkkkkkkkkkkkk", "OI OI OI OI", "ñ é ã ç", "a\tb\tc", "http://x.com/" + "a".repeat(500), "meu nome é " + "A".repeat(200)];
let bad = 0, n = 0, worst = 0;
for (const p of personas) for (const t of inputs) {
  const t0 = process.hrtime.bigint();
  let r; try { r = chat.respond({ persona: p, text: t, history: [{ role: "user", text: "oi" }, { role: "ai", text: "oi!" }] }); } catch (e) { console.log("EXCEÇÃO", p, JSON.stringify(t.slice(0, 40)), e.message); bad++; continue; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6; worst = Math.max(worst, ms); n++;
  if (!r || typeof r.text !== "string" || !r.text.trim() || /undefined|NaN|\[object|<KW>|null/.test(r.text)) { console.log("RUIM", p, JSON.stringify(t.slice(0, 40)), JSON.stringify(r && r.text)); bad++; }
  if (/process\.env|SECRET|DROP TABLE|<script/i.test(r.text) && r.kind !== "recall") { console.log("ECO PERIGOSO", p, r.text.slice(0, 80)); bad++; }
  if (r.text.length > 900) { console.log("LONGA DEMAIS", r.text.length); bad++; }
}
console.log(`${n} execuções, ${bad} problemas, pior tempo ${worst.toFixed(0)} ms`);
process.exit(bad ? 1 : 0);
