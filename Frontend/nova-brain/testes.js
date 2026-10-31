/* Roda todas as baterias. node nova-brain/testes.js  (sai com erro se alguma falhar) */
const { spawnSync } = require("child_process"); const path = require("path");
let fail = 0;
for (const [f, args] of [["eval.js", ["--seeds", "20"]], ["teste-cego.js", []], ["teste-cego2.js", []], ["fuzz.js", []]]) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f), ...args], { encoding: "utf8" });
  const out = r.stdout.trim().split("\n"); const line = out.filter((l) => /\d+\/\d+|Total|execuções/.test(l)).slice(-1)[0] || out.slice(-1)[0];
  const ok = !/FALHOU|FALHAS/.test(r.stdout) && r.status === 0 && !/Total: (\d+)\/(?!\1\b)/.test(r.stdout);
  console.log((ok ? "OK    " : "FALHA ") + f.padEnd(16) + line); if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
