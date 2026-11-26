// Teste sem navegador: roda a orquestração em todos os candidatos de exemplo.
// Uso: node tests/orquestracao.test.mjs
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k] };
mem["recruta-com-ia:config"] = JSON.stringify({ velocidade: 1000 }); // sem atraso de animação

const { VAGAS_SEED, CANDIDATOS_SEED } = await import("../js/data.js");
const { criarIndice } = await import("../js/ia/rag.js");
const { orquestrar } = await import("../js/ia/orquestrador.js");

const indice = criarIndice(VAGAS_SEED);
let falhas = 0;
const checar = (cond, msg) => { if (!cond) { falhas++; console.log("  FALHOU:", msg); } };

const res = {};
for (const c of CANDIDATOS_SEED) {
  const ia = await orquestrar(c, { vagas: VAGAS_SEED, indice });
  res[c.id] = ia;
  console.log(`${c.nome.padEnd(20)} ${String(ia.score).padStart(3)}%  conf ${ia.confianca}%  ${ia.refeito ? "↻" : " "}  ${ia.decisao.texto}`);
  checar(ia.score >= 0 && ia.score <= 100, "score fora de 0-100");
  checar(ia.contexto.length >= 3, "RAG trouxe poucos trechos");
  checar(!/31 anos|casad|Recife/.test(ia.cvAnonimo), "dado pessoal vazou para os agentes");
  checar(ia.email.includes(c.nome.split(" ")[0]), "e-mail sem o nome");
  checar(ia.perguntas.length >= 2, "poucas perguntas");
  ia.avaliacao.fortes.forEach((f) => checar(f.evidencia, `ponto forte sem evidência: ${f.item}`));
}
checar(res.c7.avaliacao.lacunas.some((l) => l.item === "angular"), "'nunca trabalhei com Angular' não pode contar como Angular");
checar(res.c10.decisao.tipo === "trocar", "Pedro deveria receber sugestão de outra vaga");
checar(res.c2.refeito, "currículo curto do Rafael deveria disparar nova busca");
checar(res.c9.decisao.etapa === "Reprovado" && res.c9.status === "pendente", "reprovação deve ficar pendente de aprovação humana");
const r = indice.buscar("k8s observabilidade", 3, (ch) => ch.tipo === "vaga");
checar(r[0]?.vagaId === "v5", "busca 'k8s' deveria achar a vaga de DevOps");
console.log(falhas ? `\n${falhas} falha(s)` : "\nTodos os testes passaram.");
process.exit(falhas ? 1 : 0);
