import type { LlmProvider } from "../llm/provider.js";
import { LlmError } from "../llm/provider.js";
import { Session } from "../session.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";

/** Update when this many new words have accumulated (after a short minimum gap)... */
const WORDS_TRIGGER = 300;
const MIN_GAP_SEC = 15;
const TICK_MS = 5000;

export type Exporter = (session: Session) => Promise<void>;

/**
 * Keeps the meeting agenda up to date while the meeting runs.
 * Each cycle sends Claude the current agenda plus only the NEW transcript,
 * so the request stays small however long the meeting is.
 */
export class AgendaAgent {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private provider: LlmProvider,
    private exporter: Exporter,
  ) {}

  start(session: Session) {
    const timer = setInterval(() => void this.tick(session), TICK_MS);
    this.timers.set(session.id, timer);
  }

  private async tick(session: Session) {
    if (session.status !== "gravando" || session.updating) return;
    const pending = session.pendingWords();
    if (pending === 0) return;
    const sinceLast = (Date.now() - session.lastRunAt) / 1000;
    const due =
      sinceLast >= this.provider.minIntervalSec ||
      (pending >= WORDS_TRIGGER && sinceLast >= MIN_GAP_SEC);
    if (due) await this.runIncremental(session);
  }

  /** Runs one incremental update right away (also used by the "Atualizar agora" button). */
  async runIncremental(session: Session) {
    if (session.updating || session.processed >= session.chunks.length) return;
    const upTo = session.chunks.length;
    const text = Session.formatChunks(session.chunks.slice(session.processed, upTo), session.createdAt);
    const ok = await this.call(session, buildUserPrompt(session.agenda, text, "incremental"));
    if (ok) {
      session.processed = upTo;
      if (session.liveSync) await this.safeExport(session);
    }
  }

  /** Final consolidation over the whole transcript, then save to the destination. */
  async finish(session: Session) {
    const timer = this.timers.get(session.id);
    if (timer) clearInterval(timer);
    this.timers.delete(session.id);

    session.status = "finalizando";
    session.broadcast("state", session.snapshot());
    while (session.updating) await new Promise((r) => setTimeout(r, 500));

    if (session.chunks.length > 0) {
      const full = Session.formatChunks(session.chunks, session.createdAt);
      const ok = await this.call(session, buildUserPrompt(session.agenda, full, "final"));
      if (ok) session.processed = session.chunks.length;
    }
    await this.safeExport(session);
    session.status = "finalizada";
    session.broadcast("state", session.snapshot());
  }

  private async call(session: Session, userPrompt: string): Promise<boolean> {
    session.updating = true;
    session.broadcast("state", session.snapshot());
    try {
      const agenda = await this.provider.generateAgenda(SYSTEM_PROMPT, userPrompt);
      if (!agenda.titulo.trim()) agenda.titulo = session.title;
      session.agenda = agenda;
      session.lastError = null;
      return true;
    } catch (err) {
      session.lastError =
        err instanceof LlmError ? err.message : `Erro ao atualizar a pauta: ${(err as Error).message}`;
      console.error("[agente]", session.lastError);
      return false;
    } finally {
      session.updating = false;
      session.lastRunAt = Date.now();
      session.broadcast("state", session.snapshot());
    }
  }

  async safeExport(session: Session) {
    try {
      await this.exporter(session);
    } catch (err) {
      session.lastError = `Falha ao salvar no destino: ${(err as Error).message}`;
      console.error("[export]", err);
    }
    session.broadcast("state", session.snapshot());
  }
}
