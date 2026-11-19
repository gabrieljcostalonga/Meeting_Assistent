import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AgendaSchema, type Agenda } from "../agent/schema.js";
import { LlmError, type LlmProvider } from "./provider.js";

export class AnthropicProvider implements LlmProvider {
  readonly kind = "api" as const;
  readonly label: string;
  readonly minIntervalSec = 45;
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey });
    this.label = `API da Anthropic (${model})`;
  }

  async generateAgenda(systemPrompt: string, userPrompt: string): Promise<Agenda> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        // On a policy refusal the API re-runs the request on a suitable fallback model.
        fallbacks: "default",
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt }],
        output_config: { effort: "medium", format: betaZodOutputFormat(AgendaSchema) },
      });

      if (response.stop_reason === "refusal") {
        throw new LlmError("O modelo recusou a solicitação.", false);
      }
      if (response.stop_reason === "max_tokens") {
        throw new LlmError("A resposta foi cortada por limite de tokens.", true);
      }
      if (!response.parsed_output) {
        throw new LlmError("Resposta sem pauta estruturada.", true);
      }
      return response.parsed_output;
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (err instanceof Anthropic.AuthenticationError) {
        throw new LlmError("Chave da API Anthropic inválida (ANTHROPIC_API_KEY).", false);
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new LlmError("Limite de requisições atingido; tentando no próximo ciclo.", true);
      }
      if (err instanceof Anthropic.APIConnectionError) {
        throw new LlmError("Falha de conexão com a API; tentando no próximo ciclo.", true);
      }
      if (err instanceof Anthropic.APIError) {
        const retryable = (err.status ?? 0) >= 500;
        throw new LlmError(`Erro da API (${err.status}): ${err.message}`, retryable);
      }
      throw err;
    }
  }
}
