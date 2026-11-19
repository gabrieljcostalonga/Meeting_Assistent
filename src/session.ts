import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { emptyAgenda, type Agenda } from "./agent/schema.js";

export type Destination = "notion" | "drive";

export interface TranscriptChunk {
  text: string;
  at: number;
}

export interface ExportRef {
  id: string;
  url: string;
}

export type SessionStatus = "gravando" | "finalizando" | "finalizada";

export class Session {
  readonly id = randomUUID();
  readonly createdAt = new Date();
  chunks: TranscriptChunk[] = [];
  /** Index of the first chunk not yet sent to Claude. */
  processed = 0;
  agenda: Agenda;
  status: SessionStatus = "gravando";
  updating = false;
  lastRunAt = Date.now();
  lastError: string | null = null;
  exportRef: ExportRef | null = null;
  private clients = new Set<Response>();

  constructor(
    public title: string,
    public destination: Destination,
    public liveSync: boolean,
  ) {
    this.agenda = emptyAgenda(title);
  }

  addChunk(text: string) {
    const clean = text.trim();
    if (clean) this.chunks.push({ text: clean, at: Date.now() });
  }

  pendingWords(): number {
    return this.chunks
      .slice(this.processed)
      .reduce((n, c) => n + c.text.split(/\s+/).filter(Boolean).length, 0);
  }

  static formatChunks(chunks: TranscriptChunk[], start: Date): string {
    return chunks
      .map((c) => {
        const s = Math.floor((c.at - start.getTime()) / 1000);
        const mm = String(Math.floor(s / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        return `[${mm}:${ss}] ${c.text}`;
      })
      .join("\n");
  }

  subscribe(res: Response) {
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
    this.sendTo(res, "state", this.snapshot());
  }

  broadcast(event: string, data: unknown) {
    for (const res of this.clients) this.sendTo(res, event, data);
  }

  private sendTo(res: Response, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  snapshot() {
    return {
      id: this.id,
      title: this.title,
      destination: this.destination,
      liveSync: this.liveSync,
      status: this.status,
      updating: this.updating,
      agenda: this.agenda,
      lastError: this.lastError,
      exportRef: this.exportRef,
      words: this.chunks.reduce((n, c) => n + c.text.split(/\s+/).filter(Boolean).length, 0),
    };
  }
}

export const sessions = new Map<string, Session>();
