import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { AgendaAgent } from "./agent/agendaAgent.js";
import { resolveProvider } from "./llm/index.js";
import {
  googleAuthUrl,
  googleCreateFolder,
  googleExchangeCode,
  googleListFolders,
  googleOAuthAvailable,
  saveToDrive,
} from "./integrations/google.js";
import {
  notionAuthUrl,
  notionConnectInternal,
  notionExchangeCode,
  notionListPages,
  notionOAuthAvailable,
  saveToNotion,
} from "./integrations/notion.js";
import { loadTokens, saveTokens } from "./integrations/tokenStore.js";
import { Session, sessions, type Destination } from "./session.js";

const llm = resolveProvider();
console.log(`[claude] ${llm.message}`);

const agent = llm.provider
  ? new AgendaAgent(llm.provider, (s) => (s.destination === "notion" ? saveToNotion(s) : saveToDrive(s)))
  : null;

const app = express();
app.use(express.json({ limit: "1mb" }));
const here = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.resolve(here, "../public")));
app.use(express.static(path.resolve(here, "../../public"))); // when running from dist/

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ---------- Status ----------

app.get("/api/status", (_req, res) => {
  const t = loadTokens();
  res.json({
    llm: { available: Boolean(llm.provider), kind: llm.provider?.kind ?? null, message: llm.message },
    notion: {
      connected: Boolean(t.notion),
      oauthAvailable: notionOAuthAvailable(),
      method: t.notion?.method ?? null,
      workspaceName: t.notion?.workspaceName ?? null,
      parentPage: t.notion?.parentPageId ? { id: t.notion.parentPageId, title: t.notion.parentPageTitle } : null,
    },
    google: {
      connected: Boolean(t.google),
      oauthAvailable: googleOAuthAvailable(),
      email: t.google?.email ?? null,
      folder: t.google?.folderId ? { id: t.google.folderId, name: t.google.folderName } : null,
    },
    preferredDestination: t.preferredDestination ?? null,
  });
});

app.post("/api/destination", (req, res) => {
  const d = req.body?.destination as Destination;
  if (d !== "notion" && d !== "drive") return void res.status(400).json({ error: "Destino inválido" });
  saveTokens((t) => (t.preferredDestination = d));
  res.json({ ok: true });
});

// ---------- OAuth state (CSRF protection) ----------

const pendingStates = new Set<string>();
const newState = () => {
  const s = randomBytes(16).toString("hex");
  pendingStates.add(s);
  setTimeout(() => pendingStates.delete(s), 10 * 60 * 1000);
  return s;
};
const checkState = (s: unknown) => typeof s === "string" && pendingStates.delete(s);

const finishPage = (res: Response, ok: boolean, msg: string) =>
  res.redirect(`/?auth=${ok ? "ok" : "erro"}&msg=${encodeURIComponent(msg)}`);

// ---------- Notion ----------

app.get("/auth/notion", (_req, res) => {
  if (!notionOAuthAvailable()) return void res.redirect("/?auth=erro&msg=OAuth%20do%20Notion%20n%C3%A3o%20configurado");
  res.redirect(notionAuthUrl(newState()));
});

app.get(
  "/auth/notion/callback",
  wrap(async (req, res) => {
    if (req.query.error) return finishPage(res, false, `Notion: ${req.query.error}`);
    if (!checkState(req.query.state)) return finishPage(res, false, "Estado OAuth inválido. Tente de novo.");
    await notionExchangeCode(String(req.query.code));
    finishPage(res, true, "Notion conectado!");
  }),
);

app.post(
  "/api/notion/token",
  wrap(async (req, res) => {
    const token = String(req.body?.token ?? "").trim();
    if (!token) return void res.status(400).json({ error: "Informe o token" });
    try {
      await notionConnectInternal(token);
    } catch {
      return void res.status(400).json({ error: "Token do Notion inválido." });
    }
    res.json({ ok: true });
  }),
);

app.get(
  "/api/notion/pages",
  wrap(async (req, res) => res.json(await notionListPages(String(req.query.q ?? "")))),
);

app.post("/api/notion/parent", (req, res) => {
  const { id, title } = req.body ?? {};
  if (!id) return void res.status(400).json({ error: "Página inválida" });
  saveTokens((t) => {
    if (t.notion) Object.assign(t.notion, { parentPageId: String(id), parentPageTitle: String(title ?? "") });
  });
  res.json({ ok: true });
});

app.post("/api/notion/disconnect", (_req, res) => {
  saveTokens((t) => delete t.notion);
  res.json({ ok: true });
});

// ---------- Google Drive ----------

app.get("/auth/google", (_req, res) => {
  if (!googleOAuthAvailable()) return void res.redirect("/?auth=erro&msg=OAuth%20do%20Google%20n%C3%A3o%20configurado");
  res.redirect(googleAuthUrl(newState()));
});

app.get(
  "/auth/google/callback",
  wrap(async (req, res) => {
    if (req.query.error) return finishPage(res, false, `Google: ${req.query.error}`);
    if (!checkState(req.query.state)) return finishPage(res, false, "Estado OAuth inválido. Tente de novo.");
    await googleExchangeCode(String(req.query.code));
    finishPage(res, true, "Google Drive conectado!");
  }),
);

app.get("/api/google/folders", wrap(async (_req, res) => res.json(await googleListFolders())));

app.post(
  "/api/google/folders",
  wrap(async (req, res) => {
    const folder = await googleCreateFolder(String(req.body?.name || "Pautas de Reunião"));
    saveTokens((t) => {
      if (t.google) Object.assign(t.google, { folderId: folder.id, folderName: folder.name });
    });
    res.json(folder);
  }),
);

app.post("/api/google/folder", (req, res) => {
  const { id, name } = req.body ?? {};
  if (!id) return void res.status(400).json({ error: "Pasta inválida" });
  saveTokens((t) => {
    if (t.google) Object.assign(t.google, { folderId: String(id), folderName: String(name ?? "") });
  });
  res.json({ ok: true });
});

app.post("/api/google/disconnect", (_req, res) => {
  saveTokens((t) => delete t.google);
  res.json({ ok: true });
});

// ---------- Meeting sessions ----------

function getSession(req: Request, res: Response): Session | null {
  const s = sessions.get(String(req.params.id));
  if (!s) res.status(404).json({ error: "Reunião não encontrada" });
  return s ?? null;
}

app.post("/api/sessions", (req, res) => {
  if (!agent) return void res.status(503).json({ error: llm.message });
  const destination = req.body?.destination as Destination;
  if (destination !== "notion" && destination !== "drive")
    return void res.status(400).json({ error: "Escolha onde salvar a pauta." });
  const t = loadTokens();
  if (destination === "notion" && !t.notion?.parentPageId)
    return void res.status(400).json({ error: "Conecte o Notion e escolha a página onde salvar." });
  if (destination === "drive" && !t.google?.folderId)
    return void res.status(400).json({ error: "Conecte o Google Drive e escolha a pasta onde salvar." });

  const title = String(req.body?.title || `Reunião ${new Date().toLocaleString("pt-BR")}`).slice(0, 200);
  const s = new Session(title, destination, Boolean(req.body?.liveSync));
  sessions.set(s.id, s);
  agent.start(s);
  res.json(s.snapshot());
});

app.get("/api/sessions/:id/events", (req, res) => {
  const s = getSession(req, res);
  if (!s) return;
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  s.subscribe(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);
  res.on("close", () => clearInterval(ping));
});

app.post("/api/sessions/:id/transcript", (req, res) => {
  const s = getSession(req, res);
  if (!s) return;
  if (s.status !== "gravando") return void res.status(409).json({ error: "A reunião já foi encerrada." });
  s.addChunk(String(req.body?.text ?? ""));
  res.json({ ok: true, pendingWords: s.pendingWords() });
});

app.post(
  "/api/sessions/:id/update",
  wrap(async (req, res) => {
    const s = getSession(req, res);
    if (!s || !agent) return;
    void agent.runIncremental(s);
    res.json({ ok: true });
  }),
);

app.post("/api/sessions/:id/settings", (req, res) => {
  const s = getSession(req, res);
  if (!s) return;
  if (typeof req.body?.liveSync === "boolean") s.liveSync = req.body.liveSync;
  s.broadcast("state", s.snapshot());
  res.json(s.snapshot());
});

app.post(
  "/api/sessions/:id/save",
  wrap(async (req, res) => {
    const s = getSession(req, res);
    if (!s || !agent) return;
    await agent.safeExport(s);
    res.json(s.snapshot());
  }),
);

app.post(
  "/api/sessions/:id/finish",
  wrap(async (req, res) => {
    const s = getSession(req, res);
    if (!s || !agent) return;
    if (s.status !== "gravando") return void res.json(s.snapshot());
    await agent.finish(s);
    res.json(s.snapshot());
  }),
);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Bound to localhost only: the server holds your Notion/Google tokens.
app.listen(config.port, "127.0.0.1", () => {
  console.log(`Agente de Pautas rodando em ${config.baseUrl}`);
});
