// Agentes especialistas. Cada um faz UMA coisa bem feita e devolve um resultado para o orquestrador.
// Todos funcionam no modo local (sem chave). Com a chave do Claude, os agentes de linguagem usam o modelo
// e, se a chamada falhar, voltam sozinhos para o modo local.
import { normalizar } from "./rag.js";
import { SINONIMOS } from "./conhecimento.js";
import { claudeJSON, usandoClaude } from "./llm.js";

/* ---------- ficha de cada agente (usada no organograma e no grafo) ---------- */
export const AGENTES = {
  orquestrador: { nome: "Orquestrador", cargo: "Coordena o fluxo", time: "Coordenação", cor: "#7c3aed",
    descricao: "Recebe o currículo, decide a ordem dos agentes, roda etapas em paralelo, refaz a busca quando a confiança é baixa e entrega tudo para aprovação humana.",
    ferramentas: ["roteamento condicional", "execução paralela", "nova tentativa", "registro (trace)"], entradas: "candidato + vaga", saidas: "pacote de decisão" },
  guardiao: { nome: "Guardião LGPD", cargo: "Privacidade e viés", time: "Entrada", cor: "#0f766e",
    descricao: "Remove idade, estado civil, contatos e endereço antes de qualquer avaliação (avaliação cega).",
    ferramentas: ["detecção de dados pessoais", "anonimização"], entradas: "currículo bruto", saidas: "currículo anonimizado" },
  leitor: { nome: "Leitor de Currículo", cargo: "Extração de perfil", time: "Entrada", cor: "#0f766e",
    descricao: "Transforma texto livre em perfil estruturado: competências, anos de experiência, idiomas e liderança.",
    ferramentas: ["LLM / regras", "dicionário de competências"], entradas: "currículo anonimizado", saidas: "perfil JSON" },
  pesquisador: { nome: "Pesquisador RAG", cargo: "Busca vaga e políticas", time: "Conhecimento", cor: "#2563eb",
    descricao: "Busca os trechos certos da vaga e das políticas da empresa (senioridade, prazos, guia de entrevista) para fundamentar a decisão.",
    ferramentas: ["busca híbrida BM25 + vetores", "expansão por sinônimos"], entradas: "perfil + vaga", saidas: "trechos citáveis" },
  recomendador: { nome: "Recomendador de Vagas", cargo: "Banco de talentos", time: "Conhecimento", cor: "#2563eb",
    descricao: "Procura, entre todas as vagas abertas, se o candidato combina melhor com outra.",
    ferramentas: ["busca RAG em vagas", "cálculo de aderência"], entradas: "perfil", saidas: "vaga alternativa" },
  avaliador: { nome: "Avaliador", cargo: "Aderência à vaga", time: "Decisão", cor: "#b45309",
    descricao: "Compara perfil e requisitos, calcula a aderência e lista pontos fortes e lacunas com evidência.",
    ferramentas: ["LLM / regras", "pontuação ponderada"], entradas: "perfil + trechos", saidas: "nota e justificativa" },
  revisor: { nome: "Revisor de Qualidade", cargo: "Guardrails", time: "Decisão", cor: "#b45309",
    descricao: "Confere se cada afirmação tem evidência no currículo, se a nota segue a política e se a confiança é suficiente. Se não for, devolve para nova busca.",
    ferramentas: ["checagem de evidência", "regras da política", "limiar de confiança"], entradas: "avaliação", saidas: "aprovado ou refazer" },
  entrevistador: { nome: "Entrevistador", cargo: "Roteiro de entrevista", time: "Saída", cor: "#be185d",
    descricao: "Monta perguntas no formato STAR para os pontos fortes e para as lacunas, seguindo o guia da empresa.",
    ferramentas: ["LLM / modelos", "guia de entrevista (RAG)"], entradas: "avaliação", saidas: "perguntas" },
  comunicador: { nome: "Comunicador", cargo: "Mensagem ao candidato", time: "Saída", cor: "#be185d",
    descricao: "Escreve o e-mail personalizado no tom de voz da empresa. Nada é enviado sem aprovação.",
    ferramentas: ["LLM / modelos", "guia de tom de voz (RAG)"], entradas: "decisão", saidas: "rascunho de e-mail" },
  humano: { nome: "Recrutador(a)", cargo: "Aprovação final", time: "Humano", cor: "#111827",
    descricao: "Revisa o pacote, aprova ou corrige com um clique. Reprovações nunca saem sem uma pessoa.",
    ferramentas: ["aprovar", "editar", "recusar"], entradas: "pacote de decisão", saidas: "decisão final" },
};

/* ---------- utilidades ---------- */
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const temTermo = (textoNorm, termo) => new RegExp(`(^|[^a-z0-9])${escRe(normalizar(termo))}([^a-z0-9]|$)`).test(textoNorm);
const frases = (t) => t.split(/(?<=[.!?])\s+/).filter(Boolean);
const NIVEL = { "Júnior": [0, 2], Pleno: [3, 5], "Sênior": [6, 99] };
const nivelPorAnos = (a) => (a == null ? "?" : a <= 2 ? "Júnior" : a <= 5 ? "Pleno" : "Sênior");

// "Nunca trabalhei com Angular" ou "estudando Spark" não contam como competência comprovada.
const NEGACAO = /\b(nunca|nao tenho|nao conheco|sem experiencia|estudando|aprendendo|quero aprender|pretendo)\b/;
const afirmado = (cvNorm, termo) => cvNorm.split(/[.!?;]/).some((f) => temTermo(f, termo) && !NEGACAO.test(f));

function competenciaPresente(cvNorm, req) {
  if (afirmado(cvNorm, req)) return req;
  for (const [de, para] of Object.entries(SINONIMOS)) if (para === req && afirmado(cvNorm, de)) return de;
  return null;
}

export function aderencia(perfilSkills, anos, vaga) {
  const set = new Set(perfilSkills);
  const ob = vaga.obrigatorios.filter((r) => set.has(r));
  const de = vaga.desejaveis.filter((r) => set.has(r));
  const [min, max] = NIVEL[vaga.senioridade] || [0, 99];
  const sen = anos == null ? 0.5 : anos >= min ? 1 : anos >= min - 1 ? 0.6 : 0.2;
  const score = Math.round(100 * (0.7 * (ob.length / vaga.obrigatorios.length) + 0.2 * (de.length / (vaga.desejaveis.length || 1)) + 0.1 * sen));
  return { score, ob, de, faltaOb: vaga.obrigatorios.filter((r) => !set.has(r)), faltaDe: vaga.desejaveis.filter((r) => !set.has(r)), sen, max };
}

/* ---------- 1. Guardião LGPD ---------- */
export function guardiao(ctx) {
  let t = ctx.candidato.curriculo;
  const removidos = [];
  const regras = [
    [/[\w.+-]+@[\w-]+\.[\w.]+/g, "e-mail"],
    [/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g, "telefone"],
    [/(,|\.)\s*\d{2}\s*anos(?=\s*[,.])/gi, "idade"],
    [/\b(idade|nascid[oa] em)[^.,]*/gi, "idade"],
    [/,?\s*\b(casad[oa]|solteir[oa]|divorciad[oa]|viúv[oa])\b/gi, "estado civil"],
    [/\b(moro|resido|residente) (em|no|na) [^.,]+[.,]?/gi, "endereço"],
  ];
  for (const [re, tipo] of regras) t = t.replace(re, (m) => { removidos.push({ tipo, trecho: m.replace(/^[,.\s]+/, "") }); return m.startsWith(",") || m.startsWith(".") ? m[0] : ""; });
  t = t.replace(/\s+([,.])/g, "$1").replace(/([,.]){2,}/g, "$1").replace(/\s{2,}/g, " ").trim();
  ctx.cvAnonimo = t;
  ctx.removidos = removidos;
  return removidos.length
    ? `Removi ${removidos.length} dado(s) pessoal(is): ${[...new Set(removidos.map((r) => r.tipo))].join(", ")}.`
    : "Nenhum dado pessoal sensível encontrado.";
}

/* ---------- 2. Leitor de currículo ---------- */
export async function leitor(ctx) {
  const vocab = [...new Set(ctx.vagas.flatMap((v) => [...v.obrigatorios, ...v.desejaveis]))];
  const cvNorm = normalizar(ctx.cvAnonimo);
  const local = () => {
    const skills = vocab.filter((r) => competenciaPresente(cvNorm, r));
    const m = cvNorm.match(/(\d+)\s*anos?\b/); // a idade já foi removida pelo Guardião
    const anos = m ? Number(m[1]) : null;
    const idiomas = [];
    const ing = cvNorm.match(/ingles\s*(basico|intermediario|avancado|fluente)/);
    if (ing) idiomas.push(`inglês ${ing[1].replace("basico", "básico").replace("intermediario", "intermediário").replace("avancado", "avançado")}`);
    const lideranca = /lider|gestao de time|coordenei|mentor/.test(cvNorm);
    return { skills, anos, idiomas, lideranca, nivel: nivelPorAnos(anos) };
  };
  let perfil = local();
  if (usandoClaude()) {
    try {
      const { dados } = await claudeJSON({
        sistema: "Você é um agente que extrai perfil profissional de currículos em português. Use somente o que está escrito no texto.",
        pedido: `Vocabulário de competências permitido: ${vocab.join(", ")}.\nCurrículo:\n${ctx.cvAnonimo}\n\nDevolva {"skills": [itens do vocabulário que o currículo comprova], "anos": número de anos de experiência ou null, "idiomas": [strings], "lideranca": boolean}`,
      });
      const skills = (dados.skills || []).map((s) => normalizar(String(s))).map((s) => vocab.find((v) => normalizar(v) === s)).filter(Boolean);
      perfil = { skills, anos: dados.anos ?? perfil.anos, idiomas: dados.idiomas || [], lideranca: !!dados.lideranca, nivel: nivelPorAnos(dados.anos ?? perfil.anos), fonte: "claude" };
    } catch (e) { ctx.avisos.push(`Leitor: Claude indisponível (${e.message}); usei o modo local.`); }
  }
  ctx.perfil = perfil;
  return `${perfil.skills.length} competências encontradas, ${perfil.anos ?? "?"} anos de experiência (nível ${perfil.nivel}).`;
}

/* ---------- 3. Pesquisador RAG ---------- */
export function pesquisador(ctx, { estrito = false } = {}) {
  const { vaga, perfil, indice } = ctx;
  const consultas = [
    { q: `${vaga.titulo} requisitos obrigatórios desejáveis`, filtro: (c) => c.vagaId === vaga.id, k: 1, motivo: "requisitos da vaga" },
    { q: `critérios senioridade ${vaga.senioridade} ${perfil.anos ?? ""} anos de experiência`, filtro: (c) => c.docId === "pol-senioridade", k: 2, motivo: "regra de senioridade" },
    { q: "aderência entrevista revisão humana reprovação outra vaga", filtro: (c) => c.docId === "pol-processo", k: 2, motivo: "regra de decisão" },
    { q: "avaliação cega reprovação aprovação pessoa", filtro: (c) => c.docId === "pol-avaliacao", k: 1, motivo: "regra de privacidade" },
  ];
  if (estrito) consultas.push(
    { q: "lacunas como aprenderia contato indireto exemplo real projeto", filtro: (c) => c.docId === "guia-entrevista", k: 2, motivo: "guia para lacunas (nova busca)" },
    { q: "candidatos abaixo da faixa requisitos obrigatórios ressalva", filtro: (c) => c.docId === "pol-senioridade", k: 1, motivo: "exceção de senioridade (nova busca)" },
  );
  const vistos = new Set(ctx.contexto?.map((c) => c.id) || []);
  const achados = [];
  for (const { q, filtro, k, motivo } of consultas) {
    for (const r of indice.buscar(q, k, filtro)) if (!vistos.has(r.id)) { vistos.add(r.id); achados.push({ ...r, motivo, consulta: q }); }
  }
  ctx.contexto = [...(ctx.contexto || []), ...achados];
  ctx.buscas = (ctx.buscas || 0) + consultas.length;
  return `${consultas.length} buscas na base, ${achados.length} trecho(s) novo(s): ${[...new Set(achados.map((a) => a.titulo))].join("; ")}.`;
}

/* ---------- 4. Recomendador de vagas ---------- */
export function recomendador(ctx) {
  const { perfil, indice, vaga } = ctx;
  const hits = indice.buscar(perfil.skills.join(" ") || ctx.cvAnonimo, 5, (c) => c.tipo === "vaga");
  const opcoes = hits.map((h) => ctx.vagas.find((v) => v.id === h.vagaId)).filter(Boolean)
    .map((v) => ({ vaga: v, ...aderencia(perfil.skills, perfil.anos, v) }))
    .sort((a, b) => b.score - a.score);
  const atual = aderencia(perfil.skills, perfil.anos, vaga).score;
  const melhor = opcoes.find((o) => o.vaga.id !== vaga.id);
  ctx.alternativa = melhor && melhor.score >= atual + 15 && melhor.score >= 60 ? { id: melhor.vaga.id, titulo: melhor.vaga.titulo, score: melhor.score } : null;
  return ctx.alternativa ? `Combina mais com "${ctx.alternativa.titulo}" (${ctx.alternativa.score}% contra ${atual}%).` : "A vaga atual é a mais adequada entre as abertas.";
}

/* ---------- 5. Avaliador ---------- */
export async function avaliador(ctx) {
  const { perfil, vaga, cvAnonimo, contexto } = ctx;
  const a = aderencia(perfil.skills, perfil.anos, vaga);
  const cvNorm = normalizar(cvAnonimo);
  const evidencia = (req) => {
    const termo = competenciaPresente(cvNorm, req);
    return frases(cvAnonimo).find((f) => termo && temTermo(normalizar(f), termo)) || "";
  };
  const cita = (docId) => contexto.find((c) => c.docId === docId)?.id;
  const fortes = [...a.ob, ...a.de].map((r) => ({ item: r, evidencia: evidencia(r) }));
  const lacunas = a.faltaOb.map((r) => ({ item: r, tipo: "obrigatório" })).concat(a.faltaDe.map((r) => ({ item: r, tipo: "desejável" })));
  const excecao = contexto.find((c) => /abaixo da faixa/.test(c.texto));
  const notaExcecao = a.sen < 1 && excecao ? ` Pela regra de exceção, pode seguir se cumprir os obrigatórios [${excecao.id}].` : "";
  const ressalvaSen = (a.sen < 1 ? `Experiência (${perfil.anos ?? "?"} anos) abaixo da faixa ${vaga.senioridade} [${cita("pol-senioridade") || "pol-senioridade"}].` : `Experiência compatível com ${vaga.senioridade} [${cita("pol-senioridade") || "pol-senioridade"}].`) + notaExcecao;
  let av = {
    score: a.score, fortes, lacunas,
    justificativa: `Cumpre ${a.ob.length} de ${vaga.obrigatorios.length} requisitos obrigatórios e ${a.de.length} de ${vaga.desejaveis.length} desejáveis [${cita("vaga-" + vaga.id) || "vaga"}]. ${ressalvaSen}`,
    scoreRegra: a.score,
  };
  if (usandoClaude()) {
    try {
      const { dados } = await claudeJSON({
        sistema: "Você é um avaliador de candidatos justo e objetivo. Use apenas o currículo e os trechos fornecidos. Cite os trechos pelo id entre colchetes.",
        pedido: `Vaga: ${JSON.stringify({ titulo: vaga.titulo, senioridade: vaga.senioridade, obrigatorios: vaga.obrigatorios, desejaveis: vaga.desejaveis })}
Perfil extraído: ${JSON.stringify(perfil)}
Currículo anonimizado: ${cvAnonimo}
Trechos da base de conhecimento:
${contexto.map((c) => `[${c.id}] ${c.texto}`).join("\n")}

Devolva {"score": 0-100, "justificativa": "2 frases com citações [id]", "fortes": [{"item": "...", "evidencia": "frase copiada do currículo"}], "lacunas": [{"item": "...", "tipo": "obrigatório|desejável"}]}`,
      });
      av = { ...av, ...dados, scoreRegra: a.score, fonte: "claude" };
    } catch (e) { ctx.avisos.push(`Avaliador: Claude indisponível (${e.message}); usei o modo local.`); }
  }
  ctx.avaliacao = av;
  return `Aderência ${av.score}%. ${av.fortes.length} ponto(s) forte(s), ${av.lacunas.filter((l) => l.tipo === "obrigatório").length} lacuna(s) obrigatória(s).`;
}

/* ---------- 6. Revisor de qualidade (guardrails) ---------- */
export function revisor(ctx) {
  const { avaliacao: av, cvAnonimo, removidos, alternativa } = ctx;
  const problemas = [];
  const semEvidencia = av.fortes.filter((f) => !f.evidencia || !normalizar(cvAnonimo).includes(normalizar(f.evidencia).slice(0, 25)));
  if (semEvidencia.length) problemas.push(`${semEvidencia.length} ponto(s) forte(s) sem evidência no currículo: ${semEvidencia.map((f) => f.item).join(", ")}`);
  const vazou = (removidos || []).filter((r) => r.trecho.length > 3 && JSON.stringify(av).includes(r.trecho));
  if (vazou.length) problemas.push("a avaliação citou dado pessoal removido");
  if (Math.abs((av.score ?? 0) - av.scoreRegra) > 25) problemas.push(`nota do modelo (${av.score}) muito distante da nota por regra (${av.scoreRegra})`);
  // sinais de pouca confiança: pouca evidência, currículo curto, nota na zona cinzenta (50 a 74)
  const sinais = [];
  if (ctx.perfil.skills.length <= 4) sinais.push("poucas competências comprovadas");
  if (cvAnonimo.length < 180) sinais.push("currículo curto");
  if (av.score >= 50 && av.score < 75) sinais.push("nota na zona de revisão");
  const bonus = ctx.refeito ? 0.15 : 0; // a nova busca trouxe regras de exceção e guia para lacunas
  const confianca = Math.min(1, Math.max(0.3, 1 + bonus - (sinais.length * 0.15 + (sinais.length ? 0.05 : 0)) - problemas.length * 0.2));

  // remove afirmações sem evidência em vez de deixar passar
  if (semEvidencia.length) av.fortes = av.fortes.filter((f) => !semEvidencia.includes(f));
  if (Math.abs((av.score ?? 0) - av.scoreRegra) > 25) av.score = av.scoreRegra;

  let decisao;
  if (alternativa && av.score < 75) decisao = { tipo: "trocar", etapa: "Triagem", texto: `Sugerir a vaga "${alternativa.titulo}" (${alternativa.score}%)` };
  else if (av.score >= 75) decisao = { tipo: "entrevista", etapa: "Entrevista", texto: "Chamar para entrevista" };
  else if (av.score >= 50) decisao = { tipo: "revisar", etapa: "Triagem", texto: "Revisão humana (aderência intermediária)" };
  else decisao = { tipo: "reprovar", etapa: "Reprovado", texto: "Sugerir reprovação (precisa de aprovação humana)" };

  ctx.revisao = { problemas, confianca: Math.round(confianca * 100), decisao };
  ctx.decisao = decisao;
  const refazer = confianca < 0.6 && !ctx.refeito;
  return { refazer, resumo: refazer
    ? `Confiança baixa (${Math.round(confianca * 100)}%): ${[...sinais, ...problemas].join("; ")}. Pedindo nova busca.`
    : `Aprovado com ${Math.round(confianca * 100)}% de confiança. Decisão: ${decisao.texto}.${problemas.length ? " Corrigido: " + problemas.join("; ") + "." : ""}` };
}

/* ---------- 7. Entrevistador ---------- */
export async function entrevistador(ctx) {
  const { avaliacao: av, vaga, perfil } = ctx;
  const p = [];
  av.fortes.slice(0, 3).forEach((f) => p.push({ tipo: "ponto forte", texto: `Conte um projeto real em que você usou ${f.item}. Qual foi a situação, o que você fez e qual foi o resultado?` }));
  av.lacunas.filter((l) => l.tipo === "obrigatório").slice(0, 2).forEach((l) => p.push({ tipo: "lacuna", texto: `A vaga pede ${l.item}. Você já teve algum contato, mesmo indireto, com isso? Como você aprenderia nas primeiras semanas?` }));
  if (vaga.senioridade === "Sênior" || perfil.lideranca) p.push({ tipo: "liderança", texto: "Fale de uma decisão técnica difícil que você tomou e de como orientou outras pessoas nela." });
  if (vaga.area === "Suporte") p.push({ tipo: "simulação", texto: "Simulação: um cliente irritado diz que está sem acesso há duas horas. Como você conduz o atendimento?" });
  p.push({ tipo: "motivação", texto: `O que te atrai na vaga de ${vaga.titulo} e no modelo ${vaga.modelo.toLowerCase()}?` });
  ctx.perguntas = p;
  ctx.contexto.push(...ctx.indice.buscar("STAR perguntas lacunas exemplo real projeto", 2, (c) => c.docId === "guia-entrevista").filter((r) => !ctx.contexto.some((c) => c.id === r.id)).map((r) => ({ ...r, motivo: "guia de entrevista" })));
  return `${p.length} perguntas no formato STAR, seguindo o guia [guia-entrevista].`;
}

/* ---------- 8. Comunicador ---------- */
export async function comunicador(ctx) {
  const { candidato, vaga, decisao, avaliacao: av, alternativa } = ctx;
  const nome = candidato.nome.split(" ")[0];
  const forte = av.fortes[0]?.item;
  const elogio = forte ? `Gostamos bastante da sua experiência com ${forte}.` : "Agradecemos o cuidado com o seu currículo.";
  const corpos = {
    entrevista: `${elogio} Queremos te convidar para a próxima etapa: uma entrevista de 45 minutos com o time de recrutamento. Responda este e-mail com dois horários que funcionam para você nesta semana.`,
    revisar: `${elogio} Seu currículo está em análise pelo nosso time e daremos um retorno em até 3 dias úteis.`,
    trocar: `${elogio} Analisando seu perfil, achamos que você combina ainda mais com a vaga de ${alternativa?.titulo}. Podemos considerar sua candidatura para ela?`,
    reprovar: `${elogio} Neste momento seguiremos com perfis que atendem a todos os requisitos obrigatórios da vaga (${av.lacunas.filter((l) => l.tipo === "obrigatório").map((l) => l.item).join(", ") || "requisitos técnicos"}). Vamos manter seu currículo no nosso banco de talentos e te avisar de novas oportunidades.`,
  };
  let email = `Olá, ${nome}!\n\nObrigado pelo interesse na vaga de ${vaga.titulo}. ${corpos[decisao.tipo]}\n\nUm abraço,\nEquipe de Recrutamento`;
  if (usandoClaude()) {
    try {
      const guia = ctx.indice.buscar("tom de voz mensagens candidatos", 4, (c) => c.docId === "guia-comunicacao").map((c) => c.texto).join(" ");
      const { dados } = await claudeJSON({
        sistema: `Você escreve e-mails de recrutamento em português do Brasil. Siga este guia: ${guia}`,
        pedido: `Escreva o e-mail para ${nome}, vaga ${vaga.titulo}. Decisão: ${decisao.texto}. Pontos fortes: ${av.fortes.map((f) => f.item).join(", ")}. Lacunas obrigatórias: ${av.lacunas.filter((l) => l.tipo === "obrigatório").map((l) => l.item).join(", ")}. ${alternativa ? "Vaga sugerida: " + alternativa.titulo : ""}\nDevolva {"email": "texto completo"}`,
      });
      if (dados.email) email = dados.email;
    } catch (e) { ctx.avisos.push(`Comunicador: Claude indisponível (${e.message}); usei o modelo local.`); }
  }
  ctx.email = email;
  return `Rascunho de e-mail (${decisao.tipo}) pronto, aguardando aprovação [guia-comunicacao].`;
}
