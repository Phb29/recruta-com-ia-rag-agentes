// Desenha o grafo da orquestração em SVG e acende nós/arestas conforme os eventos chegam.
import { AGENTES } from "./agentes.js";

const W = 178, H = 58;
export const POS = {
  orquestrador: [700, 44],
  entrada: [44, 215],
  guardiao: [200, 215],
  leitor: [395, 215],
  pesquisador: [590, 140],
  recomendador: [590, 295],
  avaliador: [790, 215],
  revisor: [985, 215],
  entrevistador: [1180, 140],
  comunicador: [1180, 295],
  humano: [1370, 215],
};
const FLUXO = [
  ["entrada", "guardiao"], ["guardiao", "leitor"], ["leitor", "pesquisador"], ["leitor", "recomendador"],
  ["pesquisador", "avaliador"], ["recomendador", "avaliador"], ["avaliador", "revisor"],
  ["revisor", "entrevistador"], ["revisor", "comunicador"], ["entrevistador", "humano"], ["comunicador", "humano"],
];
const id = (de, para) => `e-${de}-${para}`;

function caminho(de, para) {
  const [x1, y1] = POS[de], [x2, y2] = POS[para];
  if (de === "orquestrador") return `M${x1},${y1 + H / 2} L${x2},${y2 - H / 2}`;
  if (de === "revisor" && para === "pesquisador") return `M${x1},${y1 - H / 2} C${x1},${92} ${x2 + 120},${92} ${x2 + W / 2 - 10},${y2 - H / 2 + 4}`;
  return `M${x1 + (de === "entrada" ? 34 : W / 2)},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2 - W / 2},${y2}`;
}

export function criarGrafo(el) {
  const nos = Object.keys(POS).filter((n) => n !== "entrada");
  el.innerHTML = `
  <svg viewBox="0 0 1470 360" class="grafo" role="img" aria-label="Fluxo da orquestração de agentes">
    <defs><marker id="seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>
    <g class="supervisao">${nos.filter((n) => n !== "orquestrador").map((n) => `<path id="${id("orquestrador", n)}" class="sup" d="${caminho("orquestrador", n)}"/>`).join("")}</g>
    <g>${FLUXO.map(([a, b]) => `<path id="${id(a, b)}" class="aresta" d="${caminho(a, b)}" marker-end="url(#seta)"/>`).join("")}
      <path id="${id("revisor", "pesquisador")}" class="aresta loop" d="${caminho("revisor", "pesquisador")}" marker-end="url(#seta)"/>
      <text x="905" y="104" class="loop-lbl">confiança baixa → nova busca</text></g>
    <g class="no entrada" id="n-entrada" transform="translate(${POS.entrada[0]},${POS.entrada[1]})"><circle r="32"/><text y="-3">Currículo</text><text y="13" class="c">entrada</text></g>
    ${nos.map((n) => {
      const a = AGENTES[n], [x, y] = POS[n];
      return `<g class="no" id="n-${n}" transform="translate(${x},${y})" style="--cor:${a.cor}">
        <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="12"/>
        <text y="-4">${a.nome}</text><text y="14" class="c">${a.cargo}</text>
        <text class="ms" y="${H / 2 + 16}"></text></g>`;
    }).join("")}
  </svg>`;
  const $ = (s) => el.querySelector(s);
  return {
    reset() {
      el.querySelectorAll(".no").forEach((n) => n.classList.remove("ativo", "feito"));
      el.querySelectorAll(".aresta,.sup").forEach((a) => a.classList.remove("on", "feita"));
      el.querySelectorAll(".ms").forEach((m) => (m.textContent = ""));
      el.querySelector(".grafo").classList.remove("com-loop");
    },
    evento(e) {
      if (e.tipo === "inicio") { $(`#n-${e.no}`)?.classList.add("ativo"); $("#n-orquestrador").classList.add("ativo"); }
      if (e.tipo === "fim") {
        const n = $(`#n-${e.no}`);
        n?.classList.remove("ativo"); n?.classList.add("feito");
        const ms = n?.querySelector(".ms"); if (ms) ms.textContent = e.ms < 1 ? "<1 ms" : `${Math.round(e.ms)} ms`;
        $(`#${id("orquestrador", e.no)}`)?.classList.replace("on", "feita");
      }
      if (e.tipo === "aresta") {
        const a = $(`#${id(e.de, e.para)}`);
        if (a) { a.classList.add("on"); setTimeout(() => a.classList.replace("on", "feita"), 900); }
        if (e.de === "entrada") $("#n-entrada").classList.add("feito");
      }
      if (e.tipo === "loop") {
        el.querySelector(".grafo").classList.add("com-loop");
        ["pesquisador", "avaliador", "revisor"].forEach((n) => $(`#n-${n}`).classList.remove("feito"));
      }
    },
  };
}
