// Camada de modelo de linguagem.
// - modo "local": regras determinísticas que imitam o LLM. Roda sem chave e sem custo (ideal para demo no GitHub Pages).
// - modo "claude": usa a API do Claude pelo SDK oficial da Anthropic, com a chave que a pessoa digita em Configurações.
//   A chave fica só no localStorage do navegador dela. Para produção, chame a API a partir de um backend.

const CFG_KEY = "recruta-com-ia:config";
export const MODELO_PADRAO = "claude-opus-5-5";

export function config() {
  try { return { modo: "local", apiKey: "", modelo: MODELO_PADRAO, velocidade: 1, ...JSON.parse(localStorage.getItem(CFG_KEY) || "{}") }; }
  catch { return { modo: "local", apiKey: "", modelo: MODELO_PADRAO, velocidade: 1 }; }
}
export const salvarConfig = (c) => localStorage.setItem(CFG_KEY, JSON.stringify({ ...config(), ...c }));
export const usandoClaude = () => { const c = config(); return c.modo === "claude" && !!c.apiKey; };

let cliente = null, chaveDoCliente = null;
async function obterCliente() {
  const { apiKey } = config();
  if (cliente && chaveDoCliente === apiKey) return cliente;
  const { default: Anthropic } = await import("https://esm.sh/@anthropic-ai/sdk");
  cliente = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  chaveDoCliente = apiKey;
  return cliente;
}

// Pede ao Claude uma resposta em JSON. Devolve o objeto, ou lança erro para o agente cair no modo local.
export async function claudeJSON({ sistema, pedido }) {
  const client = await obterCliente();
  const resp = await client.beta.messages.create({
    model: config().modelo || MODELO_PADRAO,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: `${sistema}\nResponda somente com um objeto JSON válido, sem texto antes ou depois e sem bloco de código.`,
    messages: [{ role: "user", content: pedido }],
  });
  if (resp.stop_reason === "refusal") throw new Error("O modelo recusou o pedido.");
  const texto = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const json = texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1);
  return { dados: JSON.parse(json), uso: resp.usage };
}
