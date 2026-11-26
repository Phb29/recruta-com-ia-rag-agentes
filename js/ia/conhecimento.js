// Base de conhecimento da empresa (fictícia). É isso que o RAG consulta.
// Em produção viria de um Confluence, Google Drive, ATS ou banco de dados.
export const DOCUMENTOS = [
  {
    id: "pol-avaliacao",
    titulo: "Política de avaliação justa e LGPD",
    tipo: "política",
    texto: `Toda triagem deve ser feita sem considerar idade, gênero, estado civil, religião, foto, endereço completo ou origem. Esses dados devem ser removidos antes da avaliação (avaliação cega).
A avaliação considera apenas competências técnicas, experiência comprovada e aderência aos requisitos da vaga.
Dados pessoais do candidato só podem ser usados para o processo seletivo e devem ser apagados em até 6 meses se não houver contratação (LGPD, art. 6º - finalidade e necessidade).
Nenhuma reprovação pode ser enviada automaticamente: uma pessoa do time de recrutamento precisa aprovar toda decisão de reprovação.`,
  },
  {
    id: "pol-senioridade",
    titulo: "Critérios de senioridade",
    tipo: "política",
    texto: `Júnior: até 2 anos de experiência na área, executa tarefas com apoio e revisão frequente.
Pleno: de 3 a 5 anos de experiência, entrega com autonomia, domina as ferramentas principais da vaga.
Sênior: 6 anos ou mais de experiência, define soluções, orienta outras pessoas e já liderou projetos ou times.
Candidatos com experiência abaixo da faixa podem seguir no processo se cumprirem todos os requisitos obrigatórios; nesse caso registrar a ressalva na avaliação.`,
  },
  {
    id: "pol-processo",
    titulo: "Etapas do processo seletivo e prazos",
    tipo: "processo",
    texto: `Etapa 1 - Triagem de currículo: retorno ao candidato em até 3 dias úteis.
Etapa 2 - Entrevista comportamental com recrutamento (45 minutos).
Etapa 3 - Teste técnico ou entrevista técnica com o time da vaga.
Etapa 4 - Proposta: enviada em até 2 dias úteis após a aprovação do gestor.
Candidatos com aderência igual ou maior que 75% devem ser chamados para entrevista. Entre 50% e 74% vão para revisão humana. Abaixo de 50% recebem sugestão de reprovação, sempre revisada por uma pessoa.
Se o candidato tiver perfil melhor para outra vaga aberta, o recrutamento deve sugerir a troca de vaga antes de reprovar.`,
  },
  {
    id: "guia-entrevista",
    titulo: "Guia de entrevista por competência",
    tipo: "guia",
    texto: `Use perguntas no formato STAR (Situação, Tarefa, Ação, Resultado).
Para requisitos técnicos que o candidato possui, peça um exemplo real de projeto e o maior problema que resolveu com aquela tecnologia.
Para lacunas, pergunte como a pessoa aprenderia o assunto e se já teve contato indireto com ele.
Para vagas de liderança ou sênior, inclua pergunta sobre mentoria e decisão técnica difícil.
Para suporte e atendimento, inclua simulação de atendimento com cliente irritado.
Evite perguntas pessoais sobre família, planos de filhos, idade ou religião.`,
  },
  {
    id: "guia-comunicacao",
    titulo: "Tom de voz nas mensagens aos candidatos",
    tipo: "guia",
    texto: `Mensagens devem ser cordiais, diretas e personalizadas, citando a vaga e pelo menos um ponto forte real do candidato.
Em convites para entrevista, informar a próxima etapa e a duração.
Em retornos negativos, agradecer, explicar de forma geral o motivo (por exemplo, requisitos obrigatórios) e convidar para o banco de talentos.
Nunca usar linguagem robótica nem prometer contratação.`,
  },
  {
    id: "beneficios",
    titulo: "Benefícios e modelo de trabalho",
    tipo: "política",
    texto: `Benefícios: plano de saúde e odontológico, vale-refeição de R$ 1.200, auxílio home office de R$ 150, Gympass, PLR anual e 5 dias de folga no aniversário.
Vagas remotas aceitam pessoas de qualquer estado do Brasil. Vagas híbridas exigem 2 dias por semana no escritório.
Contratação CLT para todas as vagas listadas.`,
  },
];

// Sinônimos e variações usadas para expandir a busca (parte do "R" do RAG).
export const SINONIMOS = {
  k8s: "kubernetes", eks: "kubernetes", gke: "kubernetes",
  pyspark: "spark", "apache spark": "spark",
  springboot: "spring boot", "spring data": "spring boot",
  js: "javascript", ts: "typescript",
  postgres: "sql", postgresql: "sql", mysql: "sql", oracle: "sql", "sql server": "sql",
  "github actions": "ci/cd", "gitlab ci": "ci/cd", jenkins: "ci/cd", pipeline: "ci/cd",
  junit: "testes automatizados", mockito: "testes automatizados", jest: "testes automatizados", cypress: "testes automatizados", tdd: "testes automatizados",
  prometheus: "observabilidade", grafana: "observabilidade", zabbix: "observabilidade",
  "api rest": "api rest", apis: "api rest", rest: "api rest", microsserviços: "api rest",
  wcag: "acessibilidade", sass: "css", css3: "css", html5: "html",
  "call center": "atendimento ao cliente", atendimento: "atendimento ao cliente",
  dns: "redes", ip: "redes", "wi-fi": "redes",
  s3: "aws", glue: "aws", emr: "aws",
  rabbitmq: "mensageria", kafka: "kafka",
};
