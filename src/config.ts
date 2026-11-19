import "dotenv/config";

export type LlmMode = "auto" | "api" | "cli";

const port = Number(process.env.PORT ?? 3000);

export const config = {
  port,
  baseUrl: process.env.BASE_URL ?? `http://localhost:${port}`,
  llmMode: (process.env.LLM_MODE ?? "auto") as LlmMode,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  claudeCliPath: process.env.CLAUDE_CLI_PATH ?? "claude",
  /** Model alias for the CLI mode; "sonnet" works within Pro plan limits. Empty = CLI default. */
  claudeCliModel: process.env.CLAUDE_CLI_MODEL ?? "sonnet",
  notion: {
    clientId: process.env.NOTION_CLIENT_ID ?? "",
    clientSecret: process.env.NOTION_CLIENT_SECRET ?? "",
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  },
  dataDir: process.env.DATA_DIR ?? "data",
};
