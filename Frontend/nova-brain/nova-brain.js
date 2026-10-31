/* NOVA BRAIN — o cérebro neural próprio da LumiNova.
 * Sem dependências, sem APIs externas, sem outras IAs: duas redes neurais pequenas escritas aqui mesmo,
 * com propagação e retropropagação (backprop) feitas à mão, que rodam em Node e no navegador.
 *
 *   1) ENTENDER (Understander): lê um texto e responde "qual o assunto? é pergunta, conquista,
 *      desabafo, dica, opinião ou novidade? qual o humor?" e acha a palavra-chave mais importante.
 *      Rede: texto → features hash (palavras, pares de palavras, pedaços de palavra) → embedding
 *      médio → camada oculta tanh → 3 saídas softmax.
 *   2) FALAR (Speaker): modelo de linguagem neural (estilo Bengio): as 4 últimas palavras + o
 *      "ato" (o que a resposta faz) + o assunto + a persona → camada oculta tanh → próxima palavra.
 *      Amostra palavra por palavra (temperatura, top-k), então cada resposta nasce da rede.
 *
 * Os pesos são aprendidos no treino (train.js) e ficam em model.json.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./nova-data.js"));
  else root.NovaBrain = factory(root.NovaData);
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";

  // ======================================================================= utilitários
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const stripAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  const STOP = new Set(D.STOPWORDS.map((w) => stripAccents(w)));
  const lexCache = {};
  function topicLex(topic) {
    if (!lexCache[topic]) {
      const T = D.TOPICS[topic], set = new Set();
      const add = (str) => (String(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9_]+/g) || []).forEach((w) => { if (w.length >= 4 && !STOP.has(w)) set.add(w); });
      T.words.forEach(add); T.np.forEach(add); T.vp.forEach(add);
      lexCache[topic] = set;
    }
    return lexCache[topic];
  }

  // palavras para o ENTENDER (sem acento, minúsculas)
  function words(text) {
    return (stripAccents(String(text || "").toLowerCase()).match(/[a-z0-9_]+/g) || []);
  }
  // tokens para o FALAR (mantém maiúsculas, pontuação e <KW>)
  const TOKEN_RE = /<KW>|#[\p{L}\p{N}_]+|[\p{L}\p{N}_]+(?:[-'][\p{L}\p{N}_]+)*|[^\s]/gu;
  const tokenize = (text) => String(text || "").match(TOKEN_RE) || [];
  function detokenize(tokens) {
    let out = "";
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i], prev = tokens[i - 1];
      if (i === 0) { out = t; continue; }
      if (/^[.,!?;:)\]”%]$/.test(t) || t === "…") out += t;
      else if (prev === "“" || prev === "(" || prev === "[") out += t;
      else out += " " + t;
    }
    return out;
  }

  // ======================================================================= álgebra mínima
  const f32 = (n) => new Float32Array(n);
  function randn(rng) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function initMat(n, scale, rng) { const a = f32(n); for (let i = 0; i < n; i++) a[i] = randn(rng) * scale; return a; }
  function softmaxInPlace(z, n) {
    let m = -Infinity; for (let i = 0; i < n; i++) if (z[i] > m) m = z[i];
    let s = 0; for (let i = 0; i < n; i++) { z[i] = Math.exp(z[i] - m); s += z[i]; }
    const inv = 1 / s; for (let i = 0; i < n; i++) z[i] *= inv;
  }
  class Adam {
    constructor(params, lr, b1 = 0.9, b2 = 0.999) {
      this.p = params; this.lr = lr; this.b1 = b1; this.b2 = b2; this.t = 0;
      this.m = params.map((a) => f32(a.length)); this.v = params.map((a) => f32(a.length));
    }
    step(grads, scale = 1) {
      this.t++;
      const { b1, b2, lr } = this, c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
      for (let k = 0; k < this.p.length; k++) {
        const p = this.p[k], g = grads[k], m = this.m[k], v = this.v[k];
        for (let i = 0; i < p.length; i++) {
          const gi = g[i] * scale;
          m[i] = b1 * m[i] + (1 - b1) * gi;
          v[i] = b2 * v[i] + (1 - b2) * gi * gi;
          p[i] -= (lr * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + 1e-8);
        }
      }
    }
  }

  // empacotar pesos em Int16 + base64 (modelo pequeno para baixar no navegador)
  function toB64(u8) {
    if (typeof Buffer !== "undefined") return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString("base64");
    let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s);
  }
  function fromB64(b64) {
    if (typeof Buffer !== "undefined") { const b = Buffer.from(b64, "base64"); return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
    const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u;
  }
  function packTensor(a) {
    let mx = 1e-9; for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i]));
    const scale = mx / 32767, q = new Int16Array(a.length);
    for (let i = 0; i < a.length; i++) q[i] = Math.round(a[i] / scale);
    return { n: a.length, scale, data: toB64(new Uint8Array(q.buffer)) };
  }
  function unpackTensor(t) {
    const u8 = fromB64(t.data), q = new Int16Array(u8.buffer, u8.byteOffset, t.n), a = f32(t.n);
    for (let i = 0; i < t.n; i++) a[i] = q[i] * t.scale;
    return a;
  }

  // ======================================================================= 1) ENTENDER
  class Understander {
    constructor(cfg, rng) {
      this.cfg = { H: 4096, D: 40, HID: 64, ...cfg };
      this.topics = cfg.topics; this.kinds = cfg.kinds; this.moods = cfg.moods;
      const { H, D: Dm, HID } = this.cfg;
      if (rng) {
        this.E = initMat(H * Dm, 0.1, rng);
        this.W1 = initMat(HID * Dm, Math.sqrt(1 / Dm), rng); this.b1 = f32(HID);
        this.Wt = initMat(this.topics.length * HID, Math.sqrt(1 / HID), rng); this.bt = f32(this.topics.length);
        this.Wk = initMat(this.kinds.length * HID, Math.sqrt(1 / HID), rng); this.bk = f32(this.kinds.length);
        this.Wm = initMat(this.moods.length * HID, Math.sqrt(1 / HID), rng); this.bm = f32(this.moods.length);
      }
    }
    // features: palavras, pares, pedaços de 3 letras (ajudam com erros de digitação)
    features(text) {
      const w = words(text), idx = [], H = this.cfg.H, add = (s) => idx.push(fnv(s) % H);
      for (let i = 0; i < w.length; i++) {
        add("u:" + w[i]);
        if (i > 0) add("b:" + w[i - 1] + "_" + w[i]);
        if (w[i].length >= 4) { const t = "<" + w[i] + ">"; for (let j = 0; j + 3 <= t.length; j++) add("c:" + t.slice(j, j + 3)); }
      }
      return idx;
    }
    forward(idx, cache) {
      const { D: Dm, HID } = this.cfg, n = Math.max(1, idx.length), inv = 1 / Math.sqrt(n);
      const e = cache ? cache.e : f32(Dm), h = cache ? cache.h : f32(HID);
      e.fill(0);
      for (let k = 0; k < idx.length; k++) { const o = idx[k] * Dm; for (let d = 0; d < Dm; d++) e[d] += this.E[o + d]; }
      for (let d = 0; d < Dm; d++) e[d] *= inv;
      for (let j = 0; j < HID; j++) { let s = this.b1[j]; const o = j * Dm; for (let d = 0; d < Dm; d++) s += this.W1[o + d] * e[d]; h[j] = Math.tanh(s); }
      const head = (W, b, K, out) => { for (let k = 0; k < K; k++) { let s = b[k]; const o = k * HID; for (let j = 0; j < HID; j++) s += W[o + j] * h[j]; out[k] = s; } softmaxInPlace(out, K); return out; };
      const pt = head(this.Wt, this.bt, this.topics.length, cache ? cache.pt : f32(this.topics.length));
      const pk = head(this.Wk, this.bk, this.kinds.length, cache ? cache.pk : f32(this.kinds.length));
      const pm = head(this.Wm, this.bm, this.moods.length, cache ? cache.pm : f32(this.moods.length));
      return { pt, pk, pm };
    }
    params() { return [this.E, this.W1, this.b1, this.Wt, this.bt, this.Wk, this.bk, this.Wm, this.bm]; }
    // treina um lote; devolve a perda média
    trainBatch(batch, opt, grads) {
      const { D: Dm, HID } = this.cfg;
      grads.forEach((g) => g.fill(0));
      const [gE, gW1, gb1, gWt, gbt, gWk, gbk, gWm, gbm] = grads;
      const cache = { e: f32(Dm), h: f32(HID), pt: f32(this.topics.length), pk: f32(this.kinds.length), pm: f32(this.moods.length) };
      const dh = f32(HID), de = f32(Dm), pre = f32(HID);
      let loss = 0;
      for (const ex of batch) {
        const idx = ex.idx, n = Math.max(1, idx.length), inv = 1 / Math.sqrt(n);
        const { pt, pk, pm } = this.forward(idx, cache);
        loss += -Math.log(pt[ex.t] + 1e-9) - Math.log(pk[ex.k] + 1e-9) - Math.log(pm[ex.m] + 1e-9);
        dh.fill(0);
        const back = (p, y, W, gW, gb, K) => {
          for (let k = 0; k < K; k++) {
            const dz = p[k] - (k === y ? 1 : 0); gb[k] += dz; const o = k * HID;
            for (let j = 0; j < HID; j++) { gW[o + j] += dz * cache.h[j]; dh[j] += dz * W[o + j]; }
          }
        };
        back(pt, ex.t, this.Wt, gWt, gbt, this.topics.length);
        back(pk, ex.k, this.Wk, gWk, gbk, this.kinds.length);
        back(pm, ex.m, this.Wm, gWm, gbm, this.moods.length);
        for (let j = 0; j < HID; j++) pre[j] = dh[j] * (1 - cache.h[j] * cache.h[j]);
        de.fill(0);
        for (let j = 0; j < HID; j++) { const o = j * Dm, pj = pre[j]; gb1[j] += pj; for (let d = 0; d < Dm; d++) { gW1[o + d] += pj * cache.e[d]; de[d] += pj * this.W1[o + d]; } }
        for (let k = 0; k < idx.length; k++) { const o = idx[k] * Dm; for (let d = 0; d < Dm; d++) gE[o + d] += de[d] * inv; }
      }
      opt.step(grads, 1 / batch.length);
      return loss / batch.length;
    }
    argmax(a) { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; }
    // palavra mais importante = a que, ao sumir, mais derruba a confiança no assunto previsto.
    // Só vale palavra do vocabulário do assunto (assim a resposta nunca cita uma palavra sem sentido).
    keyword(text, base) {
      const lex = topicLex(this.topics[base.t]);
      const raw = String(text || "").match(/[\p{L}\p{N}_]+/gu) || [];
      const cand = []; const seen = new Set();
      for (const r of raw) {
        const w = stripAccents(r.toLowerCase());
        if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w) || seen.has(w) || !lex.has(w)) continue;
        seen.add(w); cand.push({ raw: r.toLowerCase(), w });
      }
      if (!cand.length) return null;
      const t = base.t, p0 = base.pt[t];
      let best = null, bestDrop = -Infinity;
      for (const c of cand) {
        const rest = words(text).filter((x) => x !== c.w).join(" ");
        const { pt } = this.forward(this.features(rest));
        const drop = p0 - pt[t] + (0.02 * Math.min(c.w.length, 10)) / 10;
        if (drop > bestDrop) { bestDrop = drop; best = c.raw; }
      }
      return best;
    }
    understand(text) {
      const idx = this.features(text);
      const { pt, pk, pm } = this.forward(idx);
      const t = this.argmax(pt), k = this.argmax(pk), m = this.argmax(pm);
      const norm = stripAccents(String(text || "").toLowerCase());
      const sensitive = D.SENSITIVE.some((s) => norm.includes(stripAccents(s)));
      const order = Array.from(pt).map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([p, i]) => ({ topic: this.topics[i], p: +p.toFixed(3) }));
      const keyword = idx.length ? this.keyword(text, { t, pt }) : null;
      return { topic: this.topics[t], topicP: +pt[t].toFixed(3), kind: this.kinds[k], kindP: +pk[k].toFixed(3), mood: this.moods[m], moodP: +pm[m].toFixed(3), top: order, keyword, sensitive };
    }
    toJSON() {
      const T = {}; ["E", "W1", "b1", "Wt", "bt", "Wk", "bk", "Wm", "bm"].forEach((k) => (T[k] = packTensor(this[k])));
      return { cfg: this.cfg, topics: this.topics, kinds: this.kinds, moods: this.moods, T };
    }
    static fromJSON(j) {
      const u = new Understander({ ...j.cfg, topics: j.topics, kinds: j.kinds, moods: j.moods });
      ["E", "W1", "b1", "Wt", "bt", "Wk", "bk", "Wm", "bm"].forEach((k) => (u[k] = unpackTensor(j.T[k])));
      return u;
    }
  }

  // ======================================================================= 2) FALAR
  const PAD = "<S>", END = "<END>", UNK = "<UNK>", KW = "<KW>";
  class Speaker {
    constructor(cfg, rng) {
      this.cfg = { N: 4, DE: 24, DA: 12, DT: 10, DP: 12, HID: 128, ...cfg };
      this.vocab = cfg.vocab; this.acts = cfg.acts; this.topics = cfg.topics; this.personas = cfg.personas;
      this.index = new Map(this.vocab.map((w, i) => [w, i]));
      const { N, DE, DA, DT, DP, HID } = this.cfg, V = this.vocab.length, IN = N * DE + DA + DT + DP;
      this.IN = IN; this.V = V;
      if (rng) {
        this.E = initMat(V * DE, 0.1, rng);
        this.A = initMat(this.acts.length * DA, 0.1, rng);
        this.T = initMat(this.topics.length * DT, 0.1, rng);
        this.P = initMat(this.personas.length * DP, 0.1, rng);
        this.W1 = initMat(HID * IN, Math.sqrt(1 / IN), rng); this.b1 = f32(HID);
        this.W2 = initMat(V * HID, Math.sqrt(1 / HID) * 0.5, rng); this.b2 = f32(V);
      }
    }
    id(w) { const i = this.index.get(w); return i === undefined ? this.index.get(UNK) : i; }
    params() { return [this.E, this.A, this.T, this.P, this.W1, this.b1, this.W2, this.b2]; }
    // monta a entrada: 4 palavras de contexto + ato + assunto + persona
    buildInput(ctx, a, t, p, x) {
      const { N, DE, DA, DT, DP } = this.cfg; let o = 0;
      for (let k = 0; k < N; k++) { const b = ctx[k] * DE; for (let d = 0; d < DE; d++) x[o++] = this.E[b + d]; }
      let b = a * DA; for (let d = 0; d < DA; d++) x[o++] = this.A[b + d];
      b = t * DT; for (let d = 0; d < DT; d++) x[o++] = this.T[b + d];
      b = p * DP; for (let d = 0; d < DP; d++) x[o++] = this.P[b + d];
    }
    forward(ctx, a, t, p, buf) {
      const { HID } = this.cfg, { IN, V } = this;
      const x = buf.x, h = buf.h, z = buf.z;
      this.buildInput(ctx, a, t, p, x);
      for (let j = 0; j < HID; j++) { let s = this.b1[j]; const o = j * IN; for (let i = 0; i < IN; i++) s += this.W1[o + i] * x[i]; h[j] = Math.tanh(s); }
      for (let v = 0; v < V; v++) { let s = this.b2[v]; const o = v * HID; for (let j = 0; j < HID; j++) s += this.W2[o + j] * h[j]; z[v] = s; }
      return z;
    }
    newBuf() { return { x: f32(this.IN), h: f32(this.cfg.HID), z: f32(this.V), dz: f32(this.V), dh: f32(this.cfg.HID), dx: f32(this.IN) }; }
    // treina um lote de amostras [ctx(4 ids), alvo, ato, assunto, persona]
    trainBatch(batch, opt, grads, buf) {
      const { N, DE, DA, DT, DP, HID } = this.cfg, { IN, V } = this;
      grads.forEach((g) => g.fill(0));
      const [gE, gA, gT, gP, gW1, gb1, gW2, gb2] = grads;
      const { x, h, z, dh, dx } = buf, pre = buf.pre || (buf.pre = f32(HID));
      let loss = 0;
      for (const s of batch) {
        const ctx = s.ctx, y = s.y;
        this.forward(ctx, s.a, s.t, s.p, buf);
        softmaxInPlace(z, V);
        loss += -Math.log(z[y] + 1e-9);
        z[y] -= 1; // dz = p - onehot
        dh.fill(0);
        for (let v = 0; v < V; v++) {
          const dz = z[v]; gb2[v] += dz; const o = v * HID;
          for (let j = 0; j < HID; j++) { gW2[o + j] += dz * h[j]; dh[j] += dz * this.W2[o + j]; }
        }
        dx.fill(0);
        for (let j = 0; j < HID; j++) {
          const pj = dh[j] * (1 - h[j] * h[j]); gb1[j] += pj; const o = j * IN;
          for (let i = 0; i < IN; i++) { gW1[o + i] += pj * x[i]; dx[i] += pj * this.W1[o + i]; }
        }
        let o = 0;
        for (let k = 0; k < N; k++) { const b = ctx[k] * DE; for (let d = 0; d < DE; d++) gE[b + d] += dx[o++]; }
        let b = s.a * DA; for (let d = 0; d < DA; d++) gA[b + d] += dx[o++];
        b = s.t * DT; for (let d = 0; d < DT; d++) gT[b + d] += dx[o++];
        b = s.p * DP; for (let d = 0; d < DP; d++) gP[b + d] += dx[o++];
      }
      opt.step(grads, 1 / batch.length);
      return loss / batch.length;
    }
    // perda média numa lista de amostras (validação)
    evalLoss(samples, buf) {
      let loss = 0;
      for (const s of samples) { this.forward(s.ctx, s.a, s.t, s.p, buf); softmaxInPlace(buf.z, this.V); loss += -Math.log(buf.z[s.y] + 1e-9); }
      return loss / samples.length;
    }
    // gera uma resposta; devolve {tokens, logp}
    sample({ act, topic, persona, hasKw, rng, temperature = 0.78, topK = 12, maxLen = 64, minLen = 6 }) {
      const a = this.acts.indexOf(act), t = this.topics.indexOf(topic), p = this.personas.indexOf(persona);
      if (a < 0 || t < 0 || p < 0) throw new Error("ato/assunto/persona desconhecido");
      const buf = this.newBuf(), ctx = new Array(this.cfg.N).fill(this.id(PAD)), out = []; let logp = 0;
      const idEnd = this.id(END), idUnk = this.id(UNK), idPad = this.id(PAD), idKw = this.id(KW);
      const idx = new Int32Array(this.V);
      for (let step = 0; step < maxLen; step++) {
        const z = this.forward(ctx, a, t, p, buf);
        z[idUnk] = -1e9; z[idPad] = -1e9;
        if (!hasKw) z[idKw] = -1e9;
        if (out.length < minLen) z[idEnd] = -1e9;
        // não repetir a mesma palavra em seguida, nem repetir <KW> mais de duas vezes
        if (out.length) z[ctx[ctx.length - 1]] -= 3;
        if (out.filter((w) => w === KW).length >= 2) z[idKw] = -1e9;
        const lse = (() => { let m = -Infinity; for (let v = 0; v < this.V; v++) if (z[v] > m) m = z[v]; let s = 0; for (let v = 0; v < this.V; v++) s += Math.exp(z[v] - m); return m + Math.log(s); })();
        // top-k com temperatura
        for (let v = 0; v < this.V; v++) idx[v] = v;
        const order = Array.from(idx).sort((i, j) => z[j] - z[i]).slice(0, topK);
        let mx = z[order[0]], sum = 0; const pr = order.map((i) => { const e = Math.exp((z[i] - mx) / temperature); sum += e; return e; });
        let r = rng() * sum, pick = order[0];
        for (let k = 0; k < order.length; k++) { r -= pr[k]; if (r <= 0) { pick = order[k]; break; } }
        logp += z[pick] - lse;
        if (pick === idEnd) break;
        out.push(this.vocab[pick]);
        ctx.shift(); ctx.push(pick);
      }
      return { tokens: out, logp, ended: out.length < maxLen };
    }
    toJSON() {
      const T = {}; ["E", "A", "T", "P", "W1", "b1", "W2", "b2"].forEach((k) => (T[k] = packTensor(this[k])));
      return { cfg: this.cfg, vocab: this.vocab, acts: this.acts, topics: this.topics, personas: this.personas, T };
    }
    static fromJSON(j) {
      const s = new Speaker({ ...j.cfg, vocab: j.vocab, acts: j.acts, topics: j.topics, personas: j.personas });
      ["E", "A", "T", "P", "W1", "b1", "W2", "b2"].forEach((k) => (s[k] = unpackTensor(j.T[k])));
      return s;
    }
  }


  // ======================================================================= controle de qualidade
  // Cada frase que a rede escreve precisa ser uma frase bem formada do repertório dessa persona, desse
  // ato e desse assunto (gramática escrita à mão). Isso corta as "costuras" quebradas entre frases.
  const SPLIT = /(?<=[.!?…:])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÀÇ“#])|\u0001/;
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const accCache = {};
  function sentencesOf(tpl) { return tpl.replace(/\{(tip|q|bridge)\}\s+/g, "{$1}\u0001").split(SPLIT).map((x) => x.trim()).filter(Boolean); }
  function tplRegex(sent, T, P) {
    const alt = (arr) => "(?:" + arr.map(reEsc).join("|") + ")";
    const parts = sent.split(/(\{np2?\}|\{vp\}|\{tip\}|\{q\}|\{bridge\}|<KW>|\[[^\]/]+\/[^\]]+\])/);
    let re = "";
    for (const part of parts) {
      if (part === "{np}" || part === "{np2}") re += alt(T.np);
      else if (part === "{vp}") re += alt(T.vp);
      else if (part === "{tip}") re += alt(T.tip);
      else if (part === "{q}") re += alt(T.q);
      else if (part === "{bridge}") re += alt(P.bridge);
      else if (part === "<KW>") re += "[^“”]{2,40}?";
      else if (/^\[[^\]/]+\/[^\]]+\]$/.test(part)) re += "(?:" + part.slice(1, -1).split("/").map(reEsc).join("|") + ")";
      else re += reEsc(part);
    }
    return new RegExp("^" + re + "$");
  }
  function acceptor(persona, act, topic) {
    const key = persona + "|" + act + "|" + topic;
    if (accCache[key]) return accCache[key];
    const T = D.TOPICS[topic], P = D.PERSONAS[persona], isPost = act.startsWith("p_");
    let tpls = D.FRAMES[act].slice();
    if (!isPost) tpls = tpls.concat(act === "empathize" ? P.neg.concat(D.GENERIC.open_neg) : P.pos.concat(D.GENERIC.open_pos), ["{q}"]);
    tpls = tpls.concat(P.close, D.GENERIC.close, P.bridge);
    const res = []; tpls.forEach((t) => sentencesOf(t).forEach((x) => res.push(tplRegex(x, T, P))));
    return (accCache[key] = res);
  }
  function sentenceCheck(text, persona, act, topic) {
    const res = acceptor(persona, act, topic), sents = text.split(SPLIT).map((x) => x.trim()).filter(Boolean);
    if (!sents.length || new Set(sents).size !== sents.length) return false;
    return sents.every((x) => res.some((r) => r.test(x)));
  }

  // ======================================================================= API pública
  const REPLY_ACT = { pergunta: "answer", conquista: "celebrate", desabafo: "empathize", dica: "thank_add", opiniao: "opine", novidade: "curious" };

  class Brain {
    constructor(model) {
      this.model = model;
      this.und = Understander.fromJSON(model.understander);
      this.spk = Speaker.fromJSON(model.speaker);
      this.rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
    }
    static load(json) { return new Brain(typeof json === "string" ? JSON.parse(json) : json); }
    seed(n) { this.rng = mulberry32(n >>> 0); return this; }
    understand(text) { return this.und.understand(text); }
    /** Vetor do texto (camada oculta do ENTENDER, 64 dimensões, normalizado). Usado na memória vetorial. */
    embed(text) {
      const und = this.und, idx = und.features(text);
      if (!idx.length) return null;
      const { D: Dm, HID } = und.cfg, cache = { e: f32(Dm), h: f32(HID), pt: f32(und.topics.length), pk: f32(und.kinds.length), pm: f32(und.moods.length) };
      und.forward(idx, cache);
      let n = 0; for (let j = 0; j < HID; j++) n += cache.h[j] * cache.h[j];
      n = Math.sqrt(n) || 1;
      return Array.from(cache.h, (v) => +(v / n).toFixed(4));
    }
    chooseAct(u) { return REPLY_ACT[u.kind] || "curious"; }

    // várias tentativas; fica com a mais provável que passe nos filtros de qualidade
    _generate({ act, topic, persona, keyword, avoid = [], tries = 40, strict = true }) {
      const hasKw = !!keyword; let best = null;
      for (let i = 0; i < tries; i++) {
        const r = this.spk.sample({ act, topic, persona, hasKw, rng: this.rng, temperature: i < 20 ? 0.8 : 0.95 });
        if (!r.ended) continue;
        let text = detokenize(r.tokens).replace(/<KW>/g, keyword || "");
        text = text.replace(/\s+/g, " ").trim();
        if (text.length < 24 || text.length > 420) continue;
        if (/[<>{}\[\]]/.test(text)) continue;
        if (strict && !sentenceCheck(text, persona, act, topic)) continue;
        if ((text.match(/“/g) || []).length !== (text.match(/”/g) || []).length) continue;
        if (!/[.!?…]$/.test(text) && !/#[\p{L}\p{N}_]+$/u.test(text)) continue;
        const toks = r.tokens, uniq = new Set(toks).size;
        if (uniq / toks.length < 0.55) continue; // muita repetição
        if (avoid.some((a) => similarity(a, text) > 0.8)) continue;
        const score = r.logp / Math.max(8, toks.length) - 0.0 * toks.length;
        if (!best || score > best.score) best = { text, score, tokens: toks.length };
      }
      return best;
    }

    /** Responde a um post. Retorna {skip:true, reason} quando não deve responder. */
    reply({ text, persona, avoid = [] }) {
      const u = this.understand(text);
      if (u.sensitive) return { skip: true, reason: "assunto sensível: fica para pessoas", understanding: u };
      if (u.topicP < 0.35 && u.kindP < 0.4) return { skip: true, reason: "pouca confiança no que o post diz", understanding: u };
      const act = this.chooseAct(u);
      const g = this._generate({ act, topic: u.topic, persona, keyword: u.keyword, avoid });
      if (!g) return { skip: true, reason: "nenhuma resposta passou nos filtros de qualidade", understanding: u };
      return { skip: false, text: g.text, act, topic: u.topic, persona, understanding: u, score: +g.score.toFixed(3) };
    }

    /** Cria um post novo no estilo da persona. */
    post({ persona, topic, act, avoid = [] }) {
      const dom = D.PERSONAS[persona].dom;
      topic = topic || dom[Math.floor(this.rng() * dom.length)];
      act = act || ["p_question", "p_tip", "p_reflect", "p_recommend"][Math.floor(this.rng() * 4)];
      const g = this._generate({ act, topic, persona, keyword: null, avoid });
      if (!g) return { skip: true, reason: "nenhum post passou nos filtros de qualidade" };
      const tag = D.TOPICS[topic].tag[0];
      const text = /#[\p{L}\p{N}_]+$/u.test(g.text) ? g.text : g.text + " #" + tag;
      return { skip: false, text, act, topic, persona, score: +g.score.toFixed(3) };
    }
  }

  // semelhança simples (Jaccard de palavras) para não repetir respostas
  function similarity(a, b) {
    const A = new Set(words(a)), B = new Set(words(b)); if (!A.size || !B.size) return 0;
    let i = 0; A.forEach((w) => B.has(w) && i++);
    return i / (A.size + B.size - i);
  }

  return { Brain, sentenceCheck, Understander, Speaker, Adam, mulberry32, tokenize, detokenize, words, stripAccents, similarity, PAD, END, UNK, KW, REPLY_ACT, data: D };
});
