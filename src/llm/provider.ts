import type { Agenda } from "../agent/schema.js";

export interface LlmProvider {
  /** "api" (Anthropic API key) or "cli" (Claude Code CLI logged in with the user's account) */
  readonly kind: "api" | "cli";
  readonly label: string;
  /** Minimum seconds between incremental updates for this provider. */
  readonly minIntervalSec: number;
  generateAgenda(systemPrompt: string, userPrompt: string): Promise<Agenda>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
