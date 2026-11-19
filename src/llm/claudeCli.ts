import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import { z } from "zod";
import { AgendaSchema, type Agenda } from "../agent/schema.js";
import { LlmError, type LlmProvider } from "./provider.js";

// The CLI's validator does not resolve the draft-2020-12 meta-schema URI, so drop "$schema".
const { $schema: _metaSchema, ...agendaJsonSchema } = z.toJSONSchema(AgendaSchema) as Record<string, unknown>;
const AGENDA_JSON_SCHEMA = JSON.stringify(agendaJsonSchema);
const TIMEOUT_MS = 5 * 60 * 1000;

/** Returns the CLI version string, or null when the `claude` command is not available. */
export function detectClaudeCli(cliPath: string): string | null {
  try {
    const res = spawnSync(cliPath, ["--version"], {
      encoding: "utf8",
      timeout: 15000,
      shell: process.platform === "win32",
    });
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  } catch {
    /* not installed */
  }
  return null;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(cliPath: string, args: string[], stdin: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: process.env,
      // Neutral directory, so no project CLAUDE.md or settings leak into the prompt.
      cwd: os.tmpdir(),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new LlmError("O Claude Code CLI demorou demais para responder.", true));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new LlmError(`Não foi possível executar o Claude Code CLI: ${e.message}`, false));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

/** Pulls the first top-level JSON object out of a text answer. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("JSON não encontrado na resposta");
  return JSON.parse(candidate.slice(start, end + 1));
}

export class ClaudeCliProvider implements LlmProvider {
  readonly kind = "cli" as const;
  readonly label: string;
  readonly minIntervalSec = 90;
  /** Set to false after the installed CLI rejects the newer flags. */
  private useModernFlags = true;

  constructor(
    private cliPath: string,
    version: string,
    private model: string,
  ) {
    this.label = `Claude Code CLI com a sua conta (${model || "modelo padrão"}, v${version.split(" ")[0]})`;
  }

  async generateAgenda(systemPrompt: string, userPrompt: string): Promise<Agenda> {
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const extra =
        attempt === 0
          ? ""
          : "\n\nIMPORTANTE: responda APENAS com o objeto JSON da pauta, sem nenhum texto antes ou depois.";
      try {
        return await this.once(systemPrompt, userPrompt + extra);
      } catch (err) {
        if (err instanceof LlmError && !err.retryable) throw err;
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new LlmError(`Resposta inválida do Claude Code CLI: ${lastError}`, true);
  }

  private async once(systemPrompt: string, userPrompt: string): Promise<Agenda> {
    const schemaHint = `\n\nResponda somente com um objeto JSON que siga este JSON Schema:\n${AGENDA_JSON_SCHEMA}`;
    const base = ["-p", "--output-format", "json", ...(this.model ? ["--model", this.model] : [])];
    const modern = [
      ...base,
      "--system-prompt",
      systemPrompt,
      "--json-schema",
      AGENDA_JSON_SCHEMA,
      "--tools",
      "",
      "--no-session-persistence",
    ];

    let res: RunResult;
    if (this.useModernFlags) {
      res = await run(this.cliPath, modern, userPrompt);
      if (res.code !== 0 && /unknown option|unrecognized|error: option|json-schema/i.test(res.stderr + res.stdout)) {
        // Older CLI (or schema rejected): fall back to plain print mode with the instructions in the prompt.
        this.useModernFlags = false;
      }
    }
    if (!this.useModernFlags) {
      res = await run(this.cliPath, base, `${systemPrompt}${schemaHint}\n\n${userPrompt}`);
    }
    res = res!;

    if (res.code !== 0) {
      const msg = (res.stderr || res.stdout).trim().slice(0, 500);
      const notLogged = /log ?in|auth|credential|api key/i.test(msg);
      throw new LlmError(
        notLogged
          ? "O Claude Code CLI não está autenticado. Rode `claude` e use /login."
          : `Claude Code CLI terminou com erro: ${msg}`,
        !notLogged,
      );
    }

    const envelope = JSON.parse(res.stdout) as {
      is_error?: boolean;
      result?: string;
      structured_output?: unknown;
    };
    if (envelope.is_error) {
      const msg = envelope.result ?? "";
      if (/credits|switch to another model|not available|limit/i.test(msg)) {
        throw new LlmError(
          `Claude Code CLI: ${msg} Ajuste CLAUDE_CLI_MODEL no .env (ex.: sonnet) ou aguarde o limite do plano.`,
          false,
        );
      }
      throw new LlmError(`Claude Code CLI retornou erro: ${msg}`, true);
    }
    const raw = envelope.structured_output ?? extractJson(envelope.result ?? "");
    return AgendaSchema.parse(raw);
  }
}
