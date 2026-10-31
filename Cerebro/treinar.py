#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Treina o "cérebro" da LumiNova: um modelo de linguagem neural em nível de palavra,
condicionado por persona + kind (post/reply) + topic, escrito do zero com numpy
(backprop manual + Adam). Nenhum modelo/peso/API de terceiros.

Arquitetura (por posição a ser prevista):
  x  = [emb(w[t-1]) ... emb(w[t-N])  |  c]          c = [emb_persona | emb_kind | emb_topic]
  h1 = tanh(x W1 + b1)
  h2 = tanh(h1 W2 + c Wc + b2)                       <- condicionamento reinjetado na 2a camada
  p  = softmax(h2 Wo + bo)

Uso:
  python3 treinar.py                      # treina e exporta ../Frontend/nova-brain.json
  python3 treinar.py --epocas 20 --seed 1
"""
import argparse
import base64
import json
import os
import re
import struct
import sys
import time

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import gerar_corpus as gc  # noqa: E402

TOKEN_RE = re.compile(r"#[^\W_]+|\d+|[^\W\d_]+(?:-[^\W\d_]+)*|[.,!?:;]|\S")
PONT_FIM = set(".!?")
BOS, EOS, UNK = 0, 1, 2


def tokenizar(texto):
    return TOKEN_RE.findall(texto.lower())


def fnv(texto):
    """FNV-1a de 32 bits sobre unidades UTF-16 (igual ao JS com charCodeAt)."""
    b = texto.encode("utf-16-le")
    h = 2166136261
    for u in struct.unpack("<%dH" % (len(b) // 2), b):
        h ^= u
        h = (h * 16777619) & 0xFFFFFFFF
    return h


# ----------------------------------------------------------------------------
# Dados
# ----------------------------------------------------------------------------
def montar_vocab(exemplos):
    cont = {}
    for e in exemplos:
        for t in tokenizar(e["text"]):
            cont[t] = cont.get(t, 0) + 1
    palavras = sorted(cont, key=lambda w: (-cont[w], w))
    return ["<bos>", "<eos>", "<unk>"] + palavras


def montar_disp(exemplos):
    """lower -> grafia original, para nomes próprios/siglas (maiúsculas no meio da frase)."""
    cap, tot = {}, {}
    for e in exemplos:
        ini = True
        for tok in TOKEN_RE.findall(e["text"]):
            if tok in PONT_FIM:
                ini = True
                continue
            if tok[0].isalpha():
                if not ini:
                    l = tok.lower()
                    tot[l] = tot.get(l, 0) + 1
                    if tok != l:
                        cap.setdefault(l, {})
                        cap[l][tok] = cap[l].get(tok, 0) + 1
                ini = False
            elif tok[0] not in ",:;#":
                pass
    disp = {}
    for l, formas in cap.items():
        if sum(formas.values()) / tot[l] >= 0.5:
            disp[l] = max(formas, key=formas.get)
    for nome in gc.NOMES_PROPRIOS:
        disp[nome.lower()] = nome
    return disp


def codificar(exemplos, w2i, N, personas, topicos):
    ctxs, conds, alvos, dono = [], [], [], []
    p2i = {p: i for i, p in enumerate(personas)}
    t2i = {t: i for i, t in enumerate(topicos)}
    for ix, e in enumerate(exemplos):
        ids = [w2i.get(t, UNK) for t in tokenizar(e["text"])] + [EOS]
        c = [p2i[e["persona"]], 0 if e["kind"] == "post" else 1, t2i[e["topic"]]]
        hist = [BOS] * N
        for y in ids:
            ctxs.append(hist[-N:][::-1])  # [w(t-1), w(t-2), ..., w(t-N)]
            conds.append(c)
            alvos.append(y)
            dono.append(ix)
            hist.append(y)
    return (np.array(ctxs, np.int32), np.array(conds, np.int32),
            np.array(alvos, np.int32), np.array(dono, np.int32))


# ----------------------------------------------------------------------------
# Modelo
# ----------------------------------------------------------------------------
class Modelo:
    def __init__(self, V, hp, rs):
        self.hp = hp
        N, DE, DP, DK, DT, H1, H2 = (hp[k] for k in ("N", "DE", "DP", "DK", "DT", "H1", "H2"))
        DC = DP + DK + DT
        f = np.float32
        g = lambda *s, sc=1.0: (rs.randn(*s) * sc).astype(f)
        self.p = dict(
            E=g(V, DE, sc=0.1), P=g(hp["NP"], DP, sc=0.1), K=g(2, DK, sc=0.1), T=g(hp["NT"], DT, sc=0.1),
            W1=g(N * DE + DC, H1, sc=1 / np.sqrt(N * DE + DC)), b1=np.zeros(H1, f),
            W2=g(H1, H2, sc=1 / np.sqrt(H1)), Wc=g(DC, H2, sc=1 / np.sqrt(DC)), b2=np.zeros(H2, f),
            Wo=g(H2, V, sc=1 / np.sqrt(H2)), bo=np.zeros(V, f),
        )
        self.m = {k: np.zeros_like(v) for k, v in self.p.items()}
        self.v = {k: np.zeros_like(v) for k, v in self.p.items()}
        self.t = 0

    def forward(self, ctx, cond, pesos=None, drop=0.0, rs=None):
        p = pesos or self.p
        hp = self.hp
        B = ctx.shape[0]
        e = p["E"][ctx].reshape(B, hp["N"] * hp["DE"])
        c = np.concatenate([p["P"][cond[:, 0]], p["K"][cond[:, 1]], p["T"][cond[:, 2]]], 1)
        x = np.concatenate([e, c], 1)
        t1 = np.tanh(x @ p["W1"] + p["b1"])
        h1, m1, m2 = t1, None, None
        if drop > 0:
            m1 = (rs.rand(*t1.shape) >= drop).astype(np.float32) / (1 - drop)
            h1 = t1 * m1
        t2 = np.tanh(h1 @ p["W2"] + c @ p["Wc"] + p["b2"])
        h2 = t2
        if drop > 0:
            m2 = (rs.rand(*t2.shape) >= drop).astype(np.float32) / (1 - drop)
            h2 = t2 * m2
        z = h2 @ p["Wo"] + p["bo"]
        return z, (ctx, cond, x, c, h1, h2, m1, m2, t1, t2)

    @staticmethod
    def logsoftmax(z):
        z = z - z.max(1, keepdims=True)
        return z - np.log(np.exp(z).sum(1, keepdims=True))

    def loss_grad(self, ctx, cond, y, drop, rs, eps):
        p = self.p
        hp = self.hp
        B = ctx.shape[0]
        z, (ctx, cond, x, c, h1, h2, m1, m2, t1, t2) = self.forward(ctx, cond, drop=drop, rs=rs)
        lp = self.logsoftmax(z)
        V = z.shape[1]
        nll = -lp[np.arange(B), y]
        loss = (1 - eps) * nll.mean() + eps * (-lp.mean(1)).mean() if eps > 0 else nll.mean()
        pr = np.exp(lp)
        dz = pr
        if eps > 0:
            dz = dz - eps / V
            dz[np.arange(B), y] -= (1 - eps)
        else:
            dz[np.arange(B), y] -= 1.0
        dz /= B
        g = {}
        g["Wo"] = h2.T @ dz
        g["bo"] = dz.sum(0)
        dh2 = dz @ p["Wo"].T
        if m2 is not None:
            dh2 = dh2 * m2
        da2 = dh2 * (1 - t2 * t2)
        g["W2"] = h1.T @ da2
        g["Wc"] = c.T @ da2
        g["b2"] = da2.sum(0)
        dh1 = da2 @ p["W2"].T
        if m1 is not None:
            dh1 = dh1 * m1
        da1 = dh1 * (1 - t1 * t1)
        g["W1"] = x.T @ da1
        g["b1"] = da1.sum(0)
        dx = da1 @ p["W1"].T
        ne = hp["N"] * hp["DE"]
        de = dx[:, :ne].reshape(B * hp["N"], hp["DE"])
        dc = dx[:, ne:] + da2 @ p["Wc"].T
        # embedding de palavras (soma por índice)
        idx = ctx.reshape(-1)
        ordem = np.argsort(idx, kind="stable")
        si = idx[ordem]
        ini = np.flatnonzero(np.r_[True, si[1:] != si[:-1]])
        dE = np.zeros_like(p["E"])
        dE[si[ini]] = np.add.reduceat(de[ordem], ini, axis=0)
        g["E"] = dE
        DP, DK = hp["DP"], hp["DK"]
        for nome, col, n, a, b in (("P", 0, hp["NP"], 0, DP), ("K", 1, 2, DP, DP + DK), ("T", 2, hp["NT"], DP + DK, dc.shape[1])):
            oh = np.zeros((B, n), np.float32)
            oh[np.arange(B), cond[:, col]] = 1
            g[nome] = oh.T @ dc[:, a:b]
        return float(loss), g

    def adam(self, g, lr, clip=5.0, b1=0.9, b2=0.999, eps=1e-8):
        self.t += 1
        tot = np.sqrt(sum(float((v * v).sum()) for v in g.values()))
        esc = min(1.0, clip / (tot + 1e-9))
        c1 = 1 - b1 ** self.t
        c2 = 1 - b2 ** self.t
        for k, gr in g.items():
            gr = gr * esc
            m, v = self.m[k], self.v[k]
            m *= b1
            m += (1 - b1) * gr
            v *= b2
            v += (1 - b2) * gr * gr
            self.p[k] -= lr * (m / c1) / (np.sqrt(v / c2) + eps)


def avaliar(modelo, ctx, cond, y, pesos=None, lote=4096):
    tot = 0.0
    for i in range(0, len(y), lote):
        z, _ = modelo.forward(ctx[i:i + lote], cond[i:i + lote], pesos=pesos)
        lp = modelo.logsoftmax(z)
        tot += float(-lp[np.arange(len(lp)), y[i:i + lote]].sum())
    return tot / len(y)


def b64f16(a):
    return base64.b64encode(np.ascontiguousarray(a, dtype="<f2").tobytes()).decode("ascii")


# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--epocas", type=int, default=30, help="máximo de épocas")
    ap.add_argument("--lote", type=int, default=512)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--n", type=int, default=6, help="janela de palavras anteriores")
    ap.add_argument("--h1", type=int, default=384)
    ap.add_argument("--h2", type=int, default=256)
    ap.add_argument("--de", type=int, default=40)
    ap.add_argument("--dropout", type=float, default=0.0)
    ap.add_argument("--suavizacao", type=float, default=0.0, help="label smoothing")
    ap.add_argument("--paciencia", type=int, default=3)
    ap.add_argument("--val", type=float, default=0.04, help="fração de exemplos para validação")
    ap.add_argument("--saida", default=os.path.join(AQUI, "..", "Frontend", "nova-brain.json"))
    ap.add_argument("--max-exemplos", type=int, default=0, help="(debug) limita exemplos")
    a = ap.parse_args()

    rs = np.random.RandomState(a.seed)
    t0 = time.time()
    exemplos = gc.gerar(a.seed)
    if a.max_exemplos:
        exemplos = exemplos[:a.max_exemplos]
    personas = gc.PERSONAS_USERS
    topicos = gc.TOPICOS_ORDEM
    vocab = montar_vocab(exemplos)
    w2i = {w: i for i, w in enumerate(vocab)}
    disp = montar_disp(exemplos)
    print(f"exemplos={len(exemplos)} vocab={len(vocab)} personas={len(personas)} topicos={len(topicos)}", flush=True)

    # split por exemplo
    perm = rs.permutation(len(exemplos))
    nval = int(len(exemplos) * a.val)
    val_ix = set(perm[:nval].tolist())
    tr = [e for i, e in enumerate(exemplos) if i not in val_ix]
    va = [e for i, e in enumerate(exemplos) if i in val_ix]
    ctx_t, cond_t, y_t, _ = codificar(tr, w2i, a.n, personas, topicos)
    ctx_v, cond_v, y_v, _ = codificar(va, w2i, a.n, personas, topicos)
    print(f"treino: {len(tr)} ex / {len(y_t)} tokens | validação: {len(va)} ex / {len(y_v)} tokens", flush=True)

    hp = dict(N=a.n, DE=a.de, DP=16, DK=8, DT=16, H1=a.h1, H2=a.h2, NP=len(personas), NT=len(topicos))
    modelo = Modelo(len(vocab), hp, rs)
    nparam = sum(v.size for v in modelo.p.values())
    print(f"parâmetros: {nparam:,}", flush=True)

    lr = a.lr
    melhor, melhor_p, sem_melhora = 1e9, None, 0
    hist = []
    n = len(y_t)
    for ep in range(1, a.epocas + 1):
        te = time.time()
        ordem = rs.permutation(n)
        soma, cnt = 0.0, 0
        for i in range(0, n, a.lote):
            ix = ordem[i:i + a.lote]
            loss, g = modelo.loss_grad(ctx_t[ix], cond_t[ix], y_t[ix], a.dropout, rs, a.suavizacao)
            modelo.adam(g, lr)
            soma += loss * len(ix)
            cnt += len(ix)
        lt = soma / cnt
        lv = avaliar(modelo, ctx_v, cond_v, y_v)
        hist.append((ep, lt, lv))
        marca = ""
        if lv < melhor - 1e-3:
            melhor, sem_melhora = lv, 0
            melhor_p = {k: v.copy() for k, v in modelo.p.items()}
            marca = " *"
        else:
            sem_melhora += 1
            lr *= 0.5
        print(f"época {ep:2d} | loss treino {lt:.4f} | loss val {lv:.4f} | ppl val {np.exp(lv):7.3f} | lr {lr:.5f} | {time.time() - te:5.1f}s{marca}", flush=True)
        if sem_melhora >= a.paciencia:
            print("validação estabilizou; parando.", flush=True)
            break
        lr *= 0.9

    modelo.p = melhor_p
    # exporta em float16 e reavalia com os pesos arredondados
    p16 = {k: v.astype(np.float16).astype(np.float32) for k, v in modelo.p.items()}
    lv16 = avaliar(modelo, ctx_v, cond_v, y_v, pesos=p16)
    print(f"melhor loss val {melhor:.4f} (ppl {np.exp(melhor):.3f}) | após float16: {lv16:.4f} (ppl {np.exp(lv16):.3f})", flush=True)

    # selftest: NLL médio de alguns exemplos de validação com os pesos float16
    selftest = []
    for e in va[:4]:
        c, cd, yy, _ = codificar([e], w2i, a.n, personas, topicos)
        selftest.append(dict(persona=e["persona"], kind=e["kind"], topic=e["topic"], text=e["text"],
                             nll=round(avaliar(modelo, c, cd, yy, pesos=p16), 5)))

    # hashes de todos os textos de treino/validação (anti-cópia)
    hashes = sorted({fnv(" ".join(tokenizar(e["text"]))) for e in exemplos})
    known = base64.b64encode(np.array(hashes, dtype="<u4").tobytes()).decode("ascii")

    fallback = {}
    for e in exemplos:
        if e["kind"] == "post" and e["topic"] == "geral" and len(fallback.setdefault(e["persona"], [])) < 6 \
                and "#" not in e["text"]:
            fallback[e["persona"]].append(e["text"])

    pesos = {}
    for k, v in modelo.p.items():
        arr = v.T if k == "Wo" else v  # Wo exportado como [V][H2] (linha por token)
        pesos[k] = dict(shape=list(arr.shape), data=b64f16(arr))
    saida = dict(
        formato="nova-brain/1",
        hp=dict(N=hp["N"], DE=hp["DE"], DP=hp["DP"], DK=hp["DK"], DT=hp["DT"], H1=hp["H1"], H2=hp["H2"], V=len(vocab)),
        vocab=vocab, disp=disp,
        personas=personas, kinds=["post", "reply"], topics=topicos,
        topic_info={t: dict(display=gc.TOPICOS[t]["display"], hashtag=gc.hashtag(t), keywords=gc.TOPICOS[t]["keywords"])
                    for t in gc.TOPICOS},
        persona_info={p["user"]: dict(own=p["own"]) for p in gc.PERSONAS},
        fallback=fallback, selftest=selftest,
        metricas=dict(seed=a.seed, epocas=len(hist), loss_treino=round(hist[-1][1], 4), loss_val=round(melhor, 4),
                      ppl_val=round(float(np.exp(melhor)), 3), loss_val_f16=round(lv16, 4),
                      exemplos=len(exemplos), parametros=int(nparam)),
        known=known, pesos=pesos,
    )
    os.makedirs(os.path.dirname(os.path.abspath(a.saida)), exist_ok=True)
    with open(a.saida, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    print(f"exportado: {os.path.abspath(a.saida)} ({os.path.getsize(a.saida) / 1e6:.2f} MB) em {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
