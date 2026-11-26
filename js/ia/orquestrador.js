// Orquestrador: decide a ordem dos agentes, roda etapas em paralelo, faz nova busca quando a
// confiança é baixa e entrega o pacote para aprovação humana. Emite eventos para a tela desenhar o fluxo.
import * as A from "./agentes.js";
import { config, usandoClaude } from "./llm.js";

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export async function orquestrar(candidato, { vagas, indice, onEvento = () => {} }) {
  const atraso = Math.round(450 / (config().velocidade || 1));
  const ctx = { candidato, vaga: vagas.find((v) => v.id === candidato.vagaId), vagas, indice, avisos: [], trace: [] };
  const inicio = performance.now();
  let msProc = 0;
  const emit = (e) => onEvento({ ...e, t: Math.round(performance.now() - inicio) });
  const orq = (texto) => { ctx.trace.push({ no: "orquestrador", resumo: texto, ms: 0 }); emit({ tipo: "log", no: "orquestrador", texto }); };

  async function passo(no, fn, de, opcoes) {
    emit({ tipo: "aresta", de: "orquestrador", para: no });
    if (de) emit({ tipo: "aresta", de, para: no });
    emit({ tipo: "inicio", no });
    await esperar(atraso); // só para o olho acompanhar a animação
    const t0 = performance.now();
    const r = await fn(ctx, opcoes);
    const ms = performance.now() - t0;
    msProc += ms;
    const resumo = typeof r === "string" ? r : r.resumo;
    ctx.trace.push({ no, resumo, ms: Math.round(ms * 10) / 10 });
    emit({ tipo: "fim", no, texto: resumo, ms });
    return r;
  }

  orq(`Novo currículo: ${candidato.nome} → vaga "${ctx.vaga.titulo}". Modo: ${usandoClaude() ? "Claude API" : "local (sem chave)"}.`);
  await passo("guardiao", A.guardiao, "entrada");
  await passo("leitor", A.leitor, "guardiao");
  orq("Disparando Pesquisador RAG e Recomendador em paralelo.");
  await Promise.all([passo("pesquisador", A.pesquisador, "leitor"), passo("recomendador", A.recomendador, "leitor")]);
  emit({ tipo: "aresta", de: "recomendador", para: "avaliador" });
  await passo("avaliador", A.avaliador, "pesquisador");
  let rev = await passo("revisor", A.revisor, "avaliador");
  if (rev.refazer) {
    ctx.refeito = true;
    orq("Revisor pediu mais contexto. Voltando ao Pesquisador com busca ampliada.");
    emit({ tipo: "loop" });
    await passo("pesquisador", A.pesquisador, "revisor", { estrito: true });
    await passo("avaliador", A.avaliador, "pesquisador");
    rev = await passo("revisor", A.revisor, "avaliador");
  }
  orq("Disparando Entrevistador e Comunicador em paralelo.");
  await Promise.all([passo("entrevistador", A.entrevistador, "revisor"), passo("comunicador", A.comunicador, "revisor")]);
  emit({ tipo: "aresta", de: "entrevistador", para: "humano" });
  emit({ tipo: "aresta", de: "comunicador", para: "humano" });
  emit({ tipo: "inicio", no: "humano" });
  orq(`Pacote pronto. Aguardando aprovação do(a) recrutador(a): ${ctx.decisao.texto}.`);

  return {
    quando: new Date().toLocaleString("pt-BR"),
    modo: usandoClaude() ? "claude" : "local",
    score: ctx.avaliacao.score,
    decisao: ctx.decisao,
    confianca: ctx.revisao.confianca,
    alternativa: ctx.alternativa,
    perfil: ctx.perfil,
    removidos: ctx.removidos,
    cvAnonimo: ctx.cvAnonimo,
    avaliacao: ctx.avaliacao,
    perguntas: ctx.perguntas,
    email: ctx.email,
    contexto: ctx.contexto.map(({ id, titulo, texto, score, motivo }) => ({ id, titulo, texto, score: Math.round(score * 100) / 100, motivo })),
    trace: ctx.trace,
    avisos: ctx.avisos,
    refeito: !!ctx.refeito,
    buscas: ctx.buscas,
    msProcessamento: Math.round(msProc * 10) / 10,
    msTotal: Math.round(performance.now() - inicio),
    status: "pendente",
  };
}
