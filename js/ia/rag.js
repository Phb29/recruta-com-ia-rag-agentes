// RAG (Retrieval-Augmented Generation) rodando 100% no navegador.
// 1) quebra os documentos em trechos (chunks)
// 2) indexa com BM25 (palavras) + vetores de trigramas (parecido com embedding leve)
// 3) busca híbrida: junta as duas notas e devolve os trechos mais relevantes
// Em produção, troque o vetor de trigramas por embeddings reais (pgvector, Qdrant, etc.).
import { DOCUMENTOS, SINONIMOS } from "./conhecimento.js";

const STOP = new Set("a o e é de da do das dos em no na nos nas um uma uns umas para por com sem que se ao aos à às ou como mais menos muito já há ter tem sua seu suas seus ser foi são até entre sobre the and of to in".split(" "));

export const normalizar = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function tokens(texto) {
  return normalizar(texto)
    .split(/[^a-z0-9/+#.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// Expande a consulta com sinônimos ("k8s" também busca "kubernetes").
export function expandir(texto) {
  const n = normalizar(texto);
  const extras = [];
  for (const [de, para] of Object.entries(SINONIMOS)) {
    if (new RegExp(`(^|[^a-z])${de.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}([^a-z]|$)`).test(n)) extras.push(para);
  }
  return extras.length ? `${texto} ${extras.join(" ")}` : texto;
}

function trigramas(texto) {
  const v = new Map();
  const s = ` ${normalizar(texto).replace(/\s+/g, " ")} `;
  for (let i = 0; i < s.length - 2; i++) {
    const g = s.slice(i, i + 3);
    v.set(g, (v.get(g) || 0) + 1);
  }
  let norma = 0;
  v.forEach((x) => (norma += x * x));
  return { v, norma: Math.sqrt(norma) || 1 };
}

function cosseno(a, b) {
  let dot = 0;
  const [p, q] = a.v.size < b.v.size ? [a, b] : [b, a];
  p.v.forEach((x, g) => { const y = q.v.get(g); if (y) dot += x * y; });
  return dot / (a.norma * b.norma);
}

export function chunkar(doc) {
  // um trecho por parágrafo/linha: bom para políticas curtas e fácil de citar
  return doc.texto.split(/\n+/).map((t) => t.trim()).filter(Boolean).map((texto, i) => ({
    id: `${doc.id}#${i + 1}`, docId: doc.id, titulo: doc.titulo, tipo: doc.tipo, texto,
  }));
}

export const vagaComoDocumento = (v) => ({
  id: `vaga-${v.id}`, titulo: `Vaga: ${v.titulo}`, tipo: "vaga", vagaId: v.id,
  texto: `Vaga ${v.titulo} (${v.senioridade}, ${v.area}, ${v.modelo}). Requisitos obrigatórios: ${v.obrigatorios.join(", ")}. Requisitos desejáveis: ${v.desejaveis.join(", ")}. ${v.descricao}`,
});

export class IndiceRAG {
  constructor(documentos) {
    this.k1 = 1.4; this.b = 0.75;
    this.chunks = documentos.flatMap((d) => chunkar(d).map((c) => ({ ...c, vagaId: d.vagaId })));
    this.docs = documentos;
    this.chunks.forEach((c) => { c.tok = tokens(expandir(c.texto)); c.tri = trigramas(c.texto); });
    this.df = new Map();
    this.chunks.forEach((c) => new Set(c.tok).forEach((t) => this.df.set(t, (this.df.get(t) || 0) + 1)));
    this.avg = this.chunks.reduce((s, c) => s + c.tok.length, 0) / (this.chunks.length || 1);
  }

  bm25(qTok, c) {
    const N = this.chunks.length;
    let s = 0;
    for (const t of new Set(qTok)) {
      const f = c.tok.filter((x) => x === t).length;
      if (!f) continue;
      const df = this.df.get(t) || 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      s += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * c.tok.length) / this.avg)));
    }
    return s;
  }

  // Busca híbrida. filtro opcional: (chunk) => boolean
  buscar(consulta, k = 5, filtro = null) {
    const qExp = expandir(consulta);
    const qTok = tokens(qExp);
    const qTri = trigramas(qExp);
    const base = this.chunks.filter((c) => !filtro || filtro(c));
    const brutos = base.map((c) => ({ c, bm: this.bm25(qTok, c), sem: cosseno(qTri, c.tri) }));
    const maxBm = Math.max(...brutos.map((r) => r.bm), 1e-9);
    return brutos
      .map((r) => ({ ...r.c, bm25: r.bm, semantico: r.sem, score: 0.7 * (r.bm / maxBm) + 0.3 * r.sem }))
      .filter((r) => r.bm25 > 0 || r.semantico > 0.18)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ tok, tri, ...resto }) => ({ ...resto, termos: qTok.filter((t) => tok.includes(t)) }));
  }
}

export function criarIndice(vagas, extras = []) {
  return new IndiceRAG([...DOCUMENTOS, ...extras, ...vagas.map(vagaComoDocumento)]);
}
