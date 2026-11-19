import { config } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { ClaudeCliProvider, detectClaudeCli } from "./claudeCli.js";
import type { LlmProvider } from "./provider.js";

export interface LlmStatus {
  provider: LlmProvider | null;
  message: string;
}

/**
 * Picks how to reach Claude on THIS machine, at startup:
 * - api:  ANTHROPIC_API_KEY
 * - cli:  `claude` command logged in with the user's account (Pro/Max)
 * - auto: api when a key exists, otherwise cli
 */
export function resolveProvider(): LlmStatus {
  const { llmMode, anthropicApiKey, anthropicModel, claudeCliPath, claudeCliModel } = config;

  if (llmMode !== "cli" && anthropicApiKey) {
    const p = new AnthropicProvider(anthropicApiKey, anthropicModel);
    return { provider: p, message: `Usando ${p.label}.` };
  }
  if (llmMode === "api") {
    return { provider: null, message: "LLM_MODE=api, mas ANTHROPIC_API_KEY não está definida no .env." };
  }

  const version = detectClaudeCli(claudeCliPath);
  if (version) {
    const p = new ClaudeCliProvider(claudeCliPath, version, claudeCliModel);
    return { provider: p, message: `Usando ${p.label}.` };
  }
  return {
    provider: null,
    message:
      "Nenhum acesso ao Claude encontrado. Defina ANTHROPIC_API_KEY no .env ou instale o Claude Code CLI e faça login (`claude` → /login).",
  };
}
