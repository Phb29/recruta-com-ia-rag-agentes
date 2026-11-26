// Recruta IA — mesma aplicação da versão tradicional, agora com RAG, agentes e orquestrador.
import { store } from "./store.js";
import { ETAPAS } from "./data.js";
import { criarIndice, IndiceRAG, tokens } from "./ia/rag.js";
import { AGENTES } from "./ia/agentes.js";
import { orquestrar } from "./ia/orquestrador.js";
import { criarGrafo } from "./ia/grafo.js";
import { config, salvarConfig, usandoClaude, MODELO_PADRAO } from "./ia/llm.js";

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const view = () => $("#view");
const MIN_POR_CURRICULO = 15; // mesma referência da versão sem IA
const DOCS_KEY = "recruta-com-ia:docs";
const docsExtras = () => JSON.parse(localStorage.getItem(DOCS_KEY) || "[]");
const indice = () => criarIndice(store.vagas, docsExtras());
const classeScore = (s) => (s >= 75 ? "alto" : s >= 50 ? "medio" : "baixo");
const fmtMs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
let ocupado = false;

const routes = {
  "": dashboard, dashboard, vagas, "nova-vaga": novaVaga, candidatos, "novo-candidato": novoCandidato,
  candidato, pipeline, orquestrador: telaOrquestrador, organograma, conhecimento, comparativo, config: telaConfig,
};

function router() {
  const [rota, id] = location.hash.replace(/^#\/?/, "").split("/");
  (routes[rota] || dashboard)(id);
  document.querySelectorAll(".side nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#/${rota || "dashboard"}`));
  $("#modo").textContent = usandoClaude() ? "Claude API ativa" : "Modo local (sem chave)";
  window.scrollTo(0, 0);
}

/* ---------- executar a orquestração e salvar ---------- */
async function processar(c, onEvento) {
  const ia = await orquestrar(c, { vagas: store.vagas, indice: indice(), onEvento });
  store.update(c.id, { ia });
  return ia;
}

function aprovar(id) {
  const c = store.candidato(id);
  const d = c.ia.decisao;
  if (d.tipo === "trocar" && c.ia.alternativa) store.update(id, { vagaId: c.ia.alternativa.id });
  store.update(id, { ia: { ...c.ia, status: "aprovado" }, nota: Math.max(1, Math.round(c.ia.score / 20)) });
  store.mover(id, d.etapa, "Recrutador(a), aprovando sugestão da IA");
}

/* ---------------- Painel ---------------- */
function dashboard() {
  const cs = store.candidatos;
  const pendentes = cs.filter((c) => c.etapa === "Triagem" && !c.ia);
  const proc = cs.filter((c) => c.ia);
  const aguardando = proc.filter((c) => c.ia.status === "pendente");
  const mediaIa = proc.length ? proc.reduce((s, c) => s + c.ia.msTotal, 0) / proc.length : 0;
  const horas = ((proc.length * MIN_POR_CURRICULO) / 60).toFixed(1);
  view().innerHTML = `
    <div class="spread"><div><h1>Painel de recrutamento <span class="badge-ia">com IA</span></h1>
    <p class="sub" style="margin:0">Os agentes fazem a triagem; você aprova. Nada sai sem uma pessoa.</p></div>
    <button class="primary" id="fila" ${pendentes.length ? "" : "disabled"}>Processar fila com IA (${pendentes.length})</button></div>
    <div class="grid g4" style="margin-top:12px">
      ${kpi("Triados pela IA", `${proc.length}/${cs.length}`)}
      ${kpi("Aguardando sua aprovação", aguardando.length, "Um clique para aprovar")}
      ${kpi("Tempo médio por currículo", proc.length ? fmtMs(mediaIa) : "—", `inclui a animação · contra ~${MIN_POR_CURRICULO} min à mão`)}
      ${kpi("Horas economizadas", `${horas} h`, `${proc.length} × ${MIN_POR_CURRICULO} min de leitura manual`)}
    </div>
    <div id="progresso"></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Fila de aprovação</h2>${aguardando.length ? tabelaCandidatos(aguardando, true) : '<p class="muted small">Nada esperando aprovação. Processe a fila para gerar sugestões.</p>'}</div>
      <div class="card"><h2>O que mudou em relação à versão sem IA</h2>
        <ol class="small" style="line-height:1.8;padding-left:18px;margin:0">
          <li><b>Guardião LGPD</b> apaga idade, estado civil e endereço antes da avaliação.</li>
          <li><b>Leitor</b> transforma o currículo em perfil estruturado.</li>
          <li><b>Pesquisador RAG</b> busca a vaga e as políticas da empresa e cita a fonte.</li>
          <li><b>Avaliador + Revisor</b> dão a nota com evidência e conferem a qualidade.</li>
          <li><b>Entrevistador + Comunicador</b> deixam perguntas e e-mail prontos.</li>
          <li><b>Você</b> aprova com um clique. <a href="#/orquestrador">Ver a orquestração ao vivo →</a></li>
        </ol></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="spread"><h2 style="margin:0">Todos os candidatos</h2><a class="btn" href="#/candidatos">Abrir lista</a></div>
      ${tabelaCandidatos([...cs].sort((a, b) => (b.ia?.score ?? -1) - (a.ia?.score ?? -1)))}</div>`;
  $("#fila").onclick = () => processarFila(pendentes, $("#progresso"), dashboard);
}

async function processarFila(lista, el, aoFim) {
  if (ocupado) return;
  ocupado = true;
  const t0 = performance.now();
  for (const [i, c] of lista.entries()) {
    el.innerHTML = `<div class="card" style="margin-top:16px"><b>Processando ${i + 1} de ${lista.length}:</b> ${esc(c.nome)}
      <div class="bar" style="margin-top:8px"><span style="width:${(i / lista.length) * 100}%"></span></div></div>`;
    await processar(c, () => {});
  }
  ocupado = false;
  const seg = ((performance.now() - t0) / 1000).toFixed(1);
  alert(`${lista.length} currículo(s) triado(s) em ${seg}s (com a animação). À mão seriam cerca de ${lista.length * MIN_POR_CURRICULO} minutos.`);
  aoFim();
}

const kpi = (lbl, num, hint = "") => `<div class="card kpi"><div class="lbl">${lbl}</div><div class="num">${num}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
const tagEtapa = (e) => `<span class="tag ${{ Contratado: "ok", Reprovado: "bad", Proposta: "acc", "Teste técnico": "warn", Entrevista: "warn" }[e] || ""}">${e}</span>`;
const scoreHtml = (c) => (c.ia ? `<span class="score ${classeScore(c.ia.score)}">${c.ia.score}%</span>` : '<span class="muted small">não processado</span>');

function tabelaCandidatos(lista, curta = false) {
  if (!lista.length) return `<p class="muted">Nenhum candidato encontrado.</p>`;
  return `<table><thead><tr><th>Nome</th>${curta ? "" : "<th>Vaga</th>"}<th>Aderência IA</th><th>Sugestão</th>${curta ? "" : "<th>Etapa</th>"}</tr></thead><tbody>
    ${lista.map((c) => `<tr><td><a href="#/candidato/${c.id}">${esc(c.nome)}</a>${c.ia?.status === "pendente" ? ' <span class="tag acc">aprovar</span>' : ""}</td>
      ${curta ? "" : `<td class="small">${esc(store.vaga(c.vagaId)?.titulo || "—")}</td>`}
      <td>${scoreHtml(c)}</td><td class="small">${c.ia ? esc(c.ia.decisao.texto) : "—"}</td>${curta ? "" : `<td>${tagEtapa(c.etapa)}</td>`}</tr>`).join("")}
  </tbody></table>`;
}

/* ---------------- Vagas (igual à versão sem IA) ---------------- */
function vagas() {
  view().innerHTML = `
    <div class="spread"><div><h1>Vagas</h1><p class="sub" style="margin:0">Cada vaga vira um documento na base de conhecimento do RAG.</p></div>
    <a class="btn primary" href="#/nova-vaga">+ Nova vaga</a></div>
    <div class="grid g2">${store.vagas.map((v) => {
      const cs = store.candidatos.filter((c) => c.vagaId === v.id && c.ia);
      const melhor = cs.sort((a, b) => b.ia.score - a.ia.score)[0];
      return `<div class="card">
        <div class="spread" style="margin-bottom:6px"><h2 style="margin:0">${esc(v.titulo)}</h2><span class="tag acc">${esc(v.senioridade)}</span></div>
        <div class="small muted">${esc(v.area)} · ${esc(v.modelo)} · ${esc(v.salario)}</div>
        <p class="small">${esc(v.descricao)}</p>
        <div class="small"><b>Obrigatórios:</b> ${v.obrigatorios.map((r) => `<span class="tag">${esc(r)}</span>`).join("")}</div>
        <div class="small"><b>Desejáveis:</b> ${v.desejaveis.map((r) => `<span class="tag">${esc(r)}</span>`).join("")}</div>
        <div class="small muted" style="margin-top:8px">${store.candidatos.filter((c) => c.vagaId === v.id).length} candidato(s)${melhor ? ` · mais aderente: <a href="#/candidato/${melhor.id}">${esc(melhor.nome)}</a> (${melhor.ia.score}%)` : ""}</div>
      </div>`;
    }).join("")}</div>`;
}

function novaVaga() {
  view().innerHTML = `
    <h1>Nova vaga</h1><p class="sub">Ao salvar, a vaga entra automaticamente no índice do RAG.</p>
    <form class="card" id="f" style="max-width:720px">
      <label>Título</label><input name="titulo" required placeholder="Ex.: Desenvolvedor(a) Python Pleno">
      <div class="grid g3">
        <div><label>Área</label><input name="area" required placeholder="Backend"></div>
        <div><label>Senioridade</label><select name="senioridade"><option>Júnior</option><option selected>Pleno</option><option>Sênior</option></select></div>
        <div><label>Modelo</label><input name="modelo" value="Remoto"></div>
      </div>
      <label>Faixa salarial</label><input name="salario" placeholder="R$ 8.000 a R$ 11.000">
      <label>Requisitos obrigatórios</label><input name="obrigatorios" required placeholder="python, django, sql">
      <label>Requisitos desejáveis</label><input name="desejaveis" placeholder="docker, aws">
      <label>Descrição</label><textarea name="descricao"></textarea>
      <div class="row" style="margin-top:14px"><button class="primary">Salvar vaga</button><a class="btn" href="#/vagas">Cancelar</a></div>
    </form>`;
  $("#f").onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const lista = (s) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    store.addVaga({ ...d, obrigatorios: lista(d.obrigatorios), desejaveis: lista(d.desejaveis || "") });
    location.hash = "#/vagas";
  };
}

/* ---------------- Candidatos com busca semântica ---------------- */
function candidatos() {
  view().innerHTML = `
    <div class="spread"><div><h1>Candidatos</h1><p class="sub" style="margin:0">Busca por significado: "k8s" encontra quem escreveu "Kubernetes", "pyspark" encontra "Spark".</p></div>
    <a class="btn primary" href="#/novo-candidato">+ Cadastrar candidato</a></div>
    <div class="card">
      <div class="row" style="margin-bottom:12px">
        <input id="q" placeholder="Ex.: k8s com observabilidade" style="max-width:340px">
        <select id="fv" style="max-width:280px"><option value="">Todas as vagas</option>${store.vagas.map((v) => `<option value="${v.id}">${esc(v.titulo)}</option>`).join("")}</select>
        <select id="fe" style="max-width:200px"><option value="">Todas as etapas</option>${ETAPAS.map((e) => `<option>${e}</option>`).join("")}</select>
      </div>
      <div id="lista"></div>
    </div>`;
  const idx = new IndiceRAG(store.candidatos.map((c) => ({ id: c.id, titulo: c.nome, tipo: "cv", texto: c.curriculo.replace(/\n/g, " ") })));
  const render = () => {
    const q = $("#q").value.trim(), fv = $("#fv").value, fe = $("#fe").value;
    let l = store.candidatos;
    if (q) { const ordem = idx.buscar(q, 50).map((r) => r.docId); l = ordem.map((id) => store.candidato(id)); }
    l = l.filter((c) => (!fv || c.vagaId === fv) && (!fe || c.etapa === fe));
    $("#lista").innerHTML = (q ? `<p class="small muted">${l.length} resultado(s), do mais relevante para o menos relevante.</p>` : "") + tabelaCandidatos(l);
  };
  ["#q", "#fv", "#fe"].forEach((s) => ($(s).oninput = render));
  render();
}

function novoCandidato() {
  view().innerHTML = `
    <h1>Cadastrar candidato</h1><p class="sub">Ao cadastrar, o orquestrador já roda a triagem completa.</p>
    <form class="card" id="f" style="max-width:720px">
      <div class="grid g2"><div><label>Nome</label><input name="nome" required></div><div><label>E-mail</label><input name="email" type="email" required></div></div>
      <label>Vaga</label><select name="vagaId">${store.vagas.map((v) => `<option value="${v.id}">${esc(v.titulo)}</option>`).join("")}</select>
      <label>Currículo (texto)</label><textarea name="curriculo" required style="min-height:200px"></textarea>
      <div class="row" style="margin-top:14px"><button class="primary">Cadastrar e triar com IA</button><a class="btn" href="#/candidatos">Cancelar</a></div>
    </form>`;
  $("#f").onsubmit = (e) => {
    e.preventDefault();
    const c = store.addCandidato(Object.fromEntries(new FormData(e.target)));
    location.hash = `#/candidato/${c.id}/rodar`;
  };
}

/* ---------------- Candidato: resultado da IA ---------------- */
function candidato(id) {
  const rodar = location.hash.endsWith("/rodar");
  const c = store.candidato(id);
  if (!c) return (location.hash = "#/candidatos");
  const v = store.vaga(c.vagaId);
  view().innerHTML = `
    <div class="spread"><div><a href="#/candidatos" class="small">← Candidatos</a><h1>${esc(c.nome)}</h1>
      <div class="small muted">${esc(c.email)} · ${esc(v.titulo)} · ${tagEtapa(c.etapa)}</div></div>
      <button class="primary" id="run">${c.ia ? "Rodar de novo" : "Triar com IA"}</button></div>
    <div class="grafo-wrap" id="g"></div>
    <div id="res" style="margin-top:16px"></div>`;
  const g = criarGrafo($("#g"));
  const mostrar = () => {
    const ia = store.candidato(id).ia;
    if (!ia) { $("#res").innerHTML = `<div class="card"><h2>Currículo</h2><pre class="cv">${esc(c.curriculo)}</pre></div>`; return; }
    $("#res").innerHTML = resultadoHtml(store.candidato(id));
    ligarAprovacao(id, mostrar);
  };
  $("#run").onclick = async () => {
    if (ocupado) return; ocupado = true; $("#run").disabled = true; g.reset();
    await processar(c, (e) => g.evento(e));
    ocupado = false; $("#run").disabled = false; $("#run").textContent = "Rodar de novo"; mostrar();
  };
  if (c.ia) c.ia.trace.filter((t) => t.no !== "orquestrador").forEach((t) => g.evento({ tipo: "fim", no: t.no, ms: t.ms }));
  mostrar();
  if (rodar) { history.replaceState(null, "", `#/candidato/${id}`); $("#run").click(); }
}

function resultadoHtml(c) {
  const ia = c.ia, av = ia.avaliacao;
  const status = { pendente: "Aguardando sua aprovação", aprovado: "Aprovado por você", recusado: "Sugestão recusada" }[ia.status];
  return `
  <div class="grid g2">
    <div class="card ${ia.status === "pendente" ? "aprov" : ""}">
      <div class="spread" style="margin-bottom:8px"><h2 style="margin:0">Decisão sugerida</h2><span class="tag ${ia.status === "aprovado" ? "ok" : "acc"}">${status}</span></div>
      <div class="row"><span class="score ${classeScore(ia.score)}" style="font-size:40px">${ia.score}%</span>
        <div><b>${esc(ia.decisao.texto)}</b><div class="small muted">Confiança do revisor: ${ia.confianca}% · ${ia.refeito ? "fez nova busca" : "sem nova busca"} · ${ia.buscas} buscas no RAG · ${ia.modo === "claude" ? "Claude API" : "modo local"}</div></div></div>
      <p class="small">${esc(av.justificativa)}</p>
      ${ia.status === "pendente" ? `<div class="row"><button class="primary" id="ok">${ia.decisao.tipo === "trocar" ? `Aprovar troca para "${esc(ia.alternativa?.titulo || "")}"` : `Aprovar e mover para "${ia.decisao.etapa}"`}</button><button id="nok">Recusar sugestão</button></div>` : ""}
      ${ia.avisos.length ? `<p class="small" style="color:var(--warn)">${ia.avisos.map(esc).join("<br>")}</p>` : ""}
    </div>
    <div class="card"><h2>Pontos fortes e lacunas</h2>
      ${av.fortes.map((f) => `<div class="small" style="margin-bottom:6px"><span class="tag ok">${esc(f.item)}</span> <span class="muted">"${esc(f.evidencia)}"</span></div>`).join("") || '<p class="small muted">Nenhum ponto forte com evidência.</p>'}
      <div style="margin-top:8px">${av.lacunas.map((l) => `<span class="tag ${l.tipo === "obrigatório" ? "bad" : "warn"}">falta ${esc(l.item)}</span>`).join("")}</div>
      ${ia.alternativa ? `<p class="small" style="margin-top:10px"><b>Recomendador:</b> combina mais com <b>${esc(ia.alternativa.titulo)}</b> (${ia.alternativa.score}%).</p>` : ""}
    </div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h2>Roteiro de entrevista</h2>${ia.perguntas.map((p) => `<div class="pergunta"><span class="tag">${esc(p.tipo)}</span> ${esc(p.texto)}</div>`).join("")}</div>
    <div class="card"><h2>E-mail pronto para revisar</h2><textarea id="email" style="min-height:220px">${esc(ia.email)}</textarea>
      <div class="row" style="margin-top:8px"><button id="copiar">Copiar e-mail</button></div></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h2>Fontes usadas (RAG)</h2><p class="small muted">Trechos que fundamentaram a decisão. Cada afirmação pode ser conferida.</p>
      ${ia.contexto.map((t) => `<div class="chunk"><div class="meta"><b>[${esc(t.id)}] ${esc(t.titulo)}</b><span>${esc(t.motivo || "")} · relevância ${t.score}</span></div><div class="small">${esc(t.texto)}</div></div>`).join("")}</div>
    <div class="card"><h2>Privacidade (Guardião LGPD)</h2>
      ${ia.removidos.length ? ia.removidos.map((r) => `<span class="tag bad">${esc(r.tipo)}: ${esc(r.trecho)}</span>`).join("") : '<p class="small muted">Nada removido.</p>'}
      <h3 style="margin-top:14px">Currículo que os agentes viram</h3><pre class="cv small">${esc(ia.cvAnonimo)}</pre>
      <h3 style="margin-top:14px">Registro da execução</h3>${traceHtml(ia.trace)}
      <p class="small muted">Processamento: ${fmtMs(ia.msProcessamento)} · total com animação: ${fmtMs(ia.msTotal)} · ${ia.quando}</p></div>
  </div>`;
}

function ligarAprovacao(id, depois) {
  $("#ok") && ($("#ok").onclick = () => { aprovar(id); depois(); });
  $("#nok") && ($("#nok").onclick = () => { const c = store.candidato(id); store.update(id, { ia: { ...c.ia, status: "recusado" } }); depois(); });
  $("#copiar") && ($("#copiar").onclick = () => navigator.clipboard?.writeText($("#email").value).then(() => ($("#copiar").textContent = "Copiado!")));
}

const traceHtml = (trace) => `<div class="trace" style="height:auto;max-height:260px">${trace.map((t) =>
  `<div><span class="n ${t.no === "orquestrador" ? "orq" : ""}">${esc(AGENTES[t.no]?.nome || t.no)}</span>${t.ms ? ` <span class="t">${t.ms} ms</span>` : ""} — ${esc(t.resumo)}</div>`).join("")}</div>`;

/* ---------------- Funil ---------------- */
function pipeline() {
  view().innerHTML = `
    <h1>Funil de seleção</h1><p class="sub">Arraste para mudar a etapa. A nota de aderência da IA aparece em cada cartão.</p>
    <div class="kanban">${ETAPAS.map((e) => {
      const l = store.candidatos.filter((c) => c.etapa === e).sort((a, b) => (b.ia?.score ?? 0) - (a.ia?.score ?? 0));
      return `<div class="col" data-etapa="${e}"><h3><span>${e}</span><span>${l.length}</span></h3>
        ${l.map((c) => `<div class="kcard" draggable="true" data-id="${c.id}"><b>${esc(c.nome)}</b><span class="muted">${esc(store.vaga(c.vagaId)?.titulo || "")}</span>
        <div>${scoreHtml(c)} ${c.ia?.status === "pendente" ? '<span class="tag acc">aprovar</span>' : ""}</div></div>`).join("")}</div>`;
    }).join("")}</div>`;
  document.querySelectorAll(".kcard").forEach((k) => {
    k.ondragstart = (ev) => ev.dataTransfer.setData("id", k.dataset.id);
    k.ondblclick = () => (location.hash = `#/candidato/${k.dataset.id}`);
  });
  document.querySelectorAll(".col").forEach((col) => {
    col.ondragover = (ev) => { ev.preventDefault(); col.classList.add("over"); };
    col.ondragleave = () => col.classList.remove("over");
    col.ondrop = (ev) => { ev.preventDefault(); store.mover(ev.dataTransfer.getData("id"), col.dataset.etapa); pipeline(); };
  });
}

/* ---------------- Orquestrador ao vivo ---------------- */
function telaOrquestrador() {
  const cs = store.candidatos;
  view().innerHTML = `
    <div class="spread"><div><h1>Orquestração ao vivo</h1><p class="sub" style="margin:0">Veja cada agente trabalhando. Linhas pontilhadas de cima: o orquestrador despachando tarefas.</p></div>
      <div class="row"><select id="sel" style="width:280px">${cs.map((c) => `<option value="${c.id}">${esc(c.nome)} — ${esc(store.vaga(c.vagaId)?.titulo)}</option>`).join("")}</select>
      <button class="primary" id="run">Rodar</button><button id="todos">Rodar todos</button></div></div>
    <div class="grafo-wrap" id="g"></div>
    <div class="grid g2" style="margin-top:16px">
      <div><h3>Registro em tempo real</h3><div class="trace" id="log"><span class="t">Escolha um candidato e clique em Rodar. Dica: "Rafael Souza" tem currículo curto e mostra o Revisor pedindo nova busca.</span></div></div>
      <div class="card" id="resumo"><h2>Resultado</h2><p class="muted small">Aparece aqui quando o fluxo terminar.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Por que um orquestrador?</h2>
      <div class="grid g3 small">
        <div><b>Ordem e dependências.</b> O Avaliador só roda depois que o Pesquisador trouxe as regras certas. O orquestrador garante isso.</div>
        <div><b>Paralelismo.</b> Pesquisador e Recomendador rodam juntos, Entrevistador e Comunicador também. Menos espera.</div>
        <div><b>Controle de qualidade.</b> Se o Revisor acha a confiança baixa, o orquestrador volta e busca mais contexto, uma vez, sem loop infinito.</div>
      </div></div>`;
  const g = criarGrafo($("#g"));
  const log = $("#log");
  const linha = (e) => {
    if (e.tipo !== "fim" && e.tipo !== "log") return;
    const nome = AGENTES[e.no]?.nome || e.no;
    log.insertAdjacentHTML("beforeend", `<div><span class="t">[${(e.t / 1000).toFixed(2)}s]</span> <span class="n ${e.no === "orquestrador" ? "orq" : ""}" style="color:${e.no === "orquestrador" ? "" : "#c4b5fd"}">${esc(nome)}</span> ${esc(e.texto)}</div>`);
    log.scrollTop = log.scrollHeight;
  };
  const rodar = async (c) => {
    g.reset(); log.innerHTML = "";
    const ia = await processar(c, (e) => { g.evento(e); linha(e); });
    $("#resumo").innerHTML = `<h2>${esc(c.nome)}</h2>
      <div class="row"><span class="score ${classeScore(ia.score)}" style="font-size:36px">${ia.score}%</span><div><b>${esc(ia.decisao.texto)}</b>
      <div class="small muted">Confiança ${ia.confianca}% · ${ia.buscas} buscas no RAG · ${ia.contexto.length} fontes citadas · processamento ${fmtMs(ia.msProcessamento)}</div></div></div>
      <p class="small">${esc(ia.avaliacao.justificativa)}</p>
      <div class="row"><a class="btn primary" href="#/candidato/${c.id}">Abrir e aprovar</a></div>`;
  };
  $("#run").onclick = async () => { if (ocupado) return; ocupado = true; await rodar(store.candidato($("#sel").value)); ocupado = false; };
  $("#todos").onclick = async () => {
    if (ocupado) return; ocupado = true;
    for (const c of store.candidatos) { $("#sel").value = c.id; await rodar(c); }
    ocupado = false;
  };
}

/* ---------------- Organograma dos agentes ---------------- */
function organograma() {
  const pessoa = (k, grande = false) => {
    const a = AGENTES[k];
    return `<div class="pessoa ${grande ? "grande" : ""}" style="--cor:${a.cor}"><b>${a.nome}</b><div class="cargo">${a.cargo}</div>${a.descricao}
      <div class="io"><b>Recebe:</b> ${a.entradas}<br><b>Entrega:</b> ${a.saidas}<br><b>Ferramentas:</b> ${a.ferramentas.join(", ")}</div></div>`;
  };
  const time = (nome, ks) => `<div class="time"><h4>${nome}</h4><div class="membros">${ks.map((k) => pessoa(k)).join("")}</div></div>`;
  view().innerHTML = `
    <h1>Organograma da orquestração</h1>
    <p class="sub">Como numa empresa: uma pessoa decide, um coordenador distribui o trabalho e cada especialista cuida de uma parte.</p>
    <div class="card org">
      <div class="nivel primeiro">${pessoa("humano", true)}</div>
      <div class="nivel">${pessoa("orquestrador", true)}</div>
      <div class="nivel">
        ${time("1 · Entrada", ["guardiao", "leitor"])}
        ${time("2 · Conhecimento (RAG)", ["pesquisador", "recomendador"])}
      </div>
      <div class="nivel">
        ${time("3 · Decisão", ["avaliador", "revisor"])}
        ${time("4 · Saída", ["entrevistador", "comunicador"])}
      </div>
    </div>
    <div class="grid g3" style="margin-top:16px">
      <div class="card"><h3>Por que agentes separados?</h3><p class="small">Cada agente tem uma tarefa pequena e testável. É mais fácil descobrir onde algo deu errado, trocar uma peça e auditar o que foi decidido.</p></div>
      <div class="card"><h3>Por que RAG?</h3><p class="small">A IA não sabe as regras da sua empresa. O RAG busca a vaga, a política de senioridade e o guia de entrevista na hora e cita a fonte, em vez de inventar.</p></div>
      <div class="card"><h3>Por que uma pessoa no topo?</h3><p class="small">A política diz que nenhuma reprovação sai sem revisão humana. A IA faz o trabalho pesado e a pessoa decide.</p></div>
    </div>`;
}

/* ---------------- Base de conhecimento (RAG) ---------------- */
function conhecimento() {
  const idx = indice();
  const destacar = (texto, termos) => {
    let h = esc(texto);
    termos.forEach((t) => { if (t.length > 2) h = h.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")})`, "gi"), "<mark>$1</mark>"); });
    return h;
  };
  view().innerHTML = `
    <h1>Base de conhecimento (RAG)</h1>
    <p class="sub">${idx.docs.length} documentos, ${idx.chunks.length} trechos indexados. Busca híbrida: BM25 (palavras) + vetores de trigramas (parecido) + sinônimos.</p>
    <div class="grid g2">
      <div class="card"><h2>Testar a busca</h2>
        <div class="row"><input id="q" value="candidato com pouca experiência pode seguir?" style="flex:1"><button class="primary" id="b">Buscar</button></div>
        <div id="hits" style="margin-top:12px"></div></div>
      <div class="card"><h2>Documentos</h2>
        <table><tbody>${idx.docs.map((d) => `<tr><td><b class="small">${esc(d.titulo)}</b></td><td><span class="tag">${esc(d.tipo)}</span></td><td class="small muted">${idx.chunks.filter((c) => c.docId === d.id).length} trecho(s)</td></tr>`).join("")}</tbody></table>
        <h3 style="margin-top:16px">Adicionar documento</h3>
        <form id="f"><input name="titulo" placeholder="Título (ex.: Política de indicação)" required>
          <textarea name="texto" placeholder="Uma regra por linha" required style="margin-top:8px;min-height:90px"></textarea>
          <button class="primary" style="margin-top:8px">Indexar</button></form></div>
    </div>`;
  const buscar = () => {
    const q = $("#q").value;
    const r = idx.buscar(q, 6);
    $("#hits").innerHTML = `<p class="small muted">Termos da consulta (já com sinônimos): ${tokens(q).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</p>` +
      (r.map((h, i) => `<div class="chunk"><div class="meta"><b>#${i + 1} [${esc(h.id)}] ${esc(h.titulo)}</b><span>nota ${h.score.toFixed(2)} · BM25 ${h.bm25.toFixed(2)} · vetor ${h.semantico.toFixed(2)}</span></div>
        <div class="small">${destacar(h.texto, h.termos)}</div></div>`).join("") || '<p class="muted">Nada encontrado.</p>');
  };
  $("#b").onclick = buscar; $("#q").onkeydown = (e) => e.key === "Enter" && buscar(); buscar();
  $("#f").onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    localStorage.setItem(DOCS_KEY, JSON.stringify([...docsExtras(), { id: "doc-" + Date.now(), titulo: d.titulo, tipo: "seu documento", texto: d.texto }]));
    conhecimento();
  };
}

/* ---------------- Antes × Depois ---------------- */
function comparativo() {
  const proc = store.candidatos.filter((c) => c.ia);
  const media = proc.length ? proc.reduce((s, c) => s + c.ia.msTotal, 0) / proc.length : null;
  const n = store.candidatos.length;
  view().innerHTML = `
    <h1>Antes × Depois</h1><p class="sub">Mesma aplicação, mesmo processo. A diferença é quem faz o trabalho repetitivo.</p>
    <div class="card"><table class="cmp"><thead><tr><th>Tarefa</th><th>Sem IA (repositório recruta-sem-ia)</th><th>Com IA (este repositório)</th></tr></thead><tbody>
      <tr><td>Ler e avaliar um currículo</td><td>~${MIN_POR_CURRICULO} min por pessoa</td><td>${media ? fmtMs(media) : "segundos"} (medido aqui)</td></tr>
      <tr><td>Triar os ${n} currículos de exemplo</td><td>~${((n * MIN_POR_CURRICULO) / 60).toFixed(1)} h de trabalho</td><td>um clique em "Processar fila"</td></tr>
      <tr><td>Comparar com os requisitos</td><td>checklist marcado à mão</td><td>Leitor + Avaliador, com a frase do currículo como evidência</td></tr>
      <tr><td>Lembrar das regras da empresa</td><td>de cabeça ou procurando no Drive</td><td>Pesquisador RAG busca e cita a política</td></tr>
      <tr><td>Avaliação sem viés / LGPD</td><td>depende de quem lê (idade e estado civil aparecem)</td><td>Guardião remove os dados antes da avaliação</td></tr>
      <tr><td>Candidato bom na vaga errada</td><td>costuma ser reprovado</td><td>Recomendador sugere a vaga certa</td></tr>
      <tr><td>Roteiro de entrevista</td><td>escrito do zero</td><td>gerado com base nas lacunas</td></tr>
      <tr><td>E-mail de retorno</td><td>modelo genérico com [ESCREVA AQUI]</td><td>personalizado, no tom da empresa</td></tr>
      <tr><td>Busca de candidatos</td><td>texto exato ("kubernetes" não acha "k8s")</td><td>por significado e sinônimos</td></tr>
      <tr><td>Quem decide</td><td>recrutador(a)</td><td>recrutador(a), com um clique (humano no controle)</td></tr>
      <tr><td>Rastreabilidade</td><td>anotações soltas</td><td>registro de cada agente, fontes e tempos</td></tr>
    </tbody></table></div>`;
}

/* ---------------- Configurações ---------------- */
function telaConfig() {
  const c = config();
  view().innerHTML = `
    <h1>Configurações</h1><p class="sub">Por padrão tudo roda no navegador, sem chave e sem custo. Com uma chave da Anthropic, Leitor, Avaliador e Comunicador passam a usar o Claude.</p>
    <form class="card" id="f" style="max-width:640px">
      <label>Modo dos agentes de linguagem</label>
      <select name="modo"><option value="local" ${c.modo === "local" ? "selected" : ""}>Local (regras, sem chave)</option><option value="claude" ${c.modo === "claude" ? "selected" : ""}>Claude API</option></select>
      <label>Chave da API Anthropic (fica só neste navegador)</label><input name="apiKey" type="password" value="${esc(c.apiKey)}" placeholder="sk-ant-...">
      <label>Modelo</label><input name="modelo" value="${esc(c.modelo || MODELO_PADRAO)}">
      <label>Velocidade da animação</label>
      <select name="velocidade">${[0.5, 1, 2, 4].map((v) => `<option value="${v}" ${Number(c.velocidade) === v ? "selected" : ""}>${v}×</option>`).join("")}</select>
      <div class="notice" style="margin-top:14px">A chave fica salva no localStorage e a chamada sai direto do navegador. Serve para demonstração. Em produção, coloque a chamada num backend e guarde a chave no servidor.</div>
      <div class="row"><button class="primary">Salvar</button><span id="ok" class="small muted"></span></div>
    </form>`;
  $("#f").onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    salvarConfig({ ...d, velocidade: Number(d.velocidade) });
    $("#ok").textContent = "Salvo."; router();
  };
}

$("#reset").onclick = () => { if (confirm("Voltar aos dados de exemplo? (apaga as triagens da IA)")) { store.reset(); localStorage.removeItem(DOCS_KEY); router(); } };
window.addEventListener("hashchange", router);
router();
