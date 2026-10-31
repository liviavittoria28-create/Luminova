#!/usr/bin/env node
/* Acrescenta ?v=<versão> aos .js/.css locais de todas as páginas do Frontend, para o navegador
 * baixar os arquivos novos depois de cada publicação (cache-busting).
 *   node Backend/versionar-assets.js            # usa a versão de Frontend/supabase-config.js
 */
"use strict";
const fs = require("fs"), path = require("path");
const FE = path.join(__dirname, "..", "Frontend");
const cfg = fs.readFileSync(path.join(FE, "supabase-config.js"), "utf8");
const version = (/LUMINOVA_VERSION\s*=\s*"([^"]+)"/.exec(cfg) || [])[1];
if (!version) throw new Error("LUMINOVA_VERSION não encontrada em supabase-config.js");
let n = 0;
for (const f of fs.readdirSync(FE).filter((x) => x.endsWith(".html"))) {
  const p = path.join(FE, f), src = fs.readFileSync(p, "utf8");
  const out = src.replace(/\b(src|href)="(\.\/)?((?:nova-brain\/)?[\w.-]+\.(?:js|css))(?:\?v=[\w.-]+)?"/g, (m, attr, dot, file) => `${attr}="${dot || ""}${file}?v=${version}"`);
  if (out !== src) { fs.writeFileSync(p, out); n++; }
}
// o CSS da sidebar é injetado pelo JS
const sbp = path.join(FE, "luminova-sidebar.js");
fs.writeFileSync(sbp, fs.readFileSync(sbp, "utf8").replace(/css\.href = "luminova-sidebar\.css(?:\?v=[\w.-]+)?"/, `css.href = "luminova-sidebar.css?v=${version}"`));
console.log(`versão ${version} aplicada em ${n} página(s)`);
