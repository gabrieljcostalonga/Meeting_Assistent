import { Readable } from "node:stream";
import { google } from "googleapis";
import { config } from "../config.js";
import type { Session } from "../session.js";
import { agendaToHtml } from "./render.js";
import { loadTokens, saveTokens } from "./tokenStore.js";

/** drive.file = the app only sees files and folders it created itself. */
const SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DOC_MIME = "application/vnd.google-apps.document";

export const googleOAuthAvailable = () => Boolean(config.google.clientId && config.google.clientSecret);

function oauthClient() {
  const c = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    `${config.baseUrl}/auth/google/callback`,
  );
  const stored = loadTokens().google;
  if (stored) c.setCredentials(stored.tokens);
  // Persist refreshed access tokens (the refresh token only comes the first time).
  c.on("tokens", (tokens) => {
    saveTokens((t) => {
      if (t.google) t.google.tokens = { ...t.google.tokens, ...tokens };
    });
  });
  return c;
}

export function googleAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function googleExchangeCode(code: string) {
  const c = oauthClient();
  const { tokens } = await c.getToken(code);
  c.setCredentials(tokens);
  let email: string | null = null;
  if (tokens.id_token) {
    const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
    email = ticket.getPayload()?.email ?? null;
  }
  saveTokens((t) => {
    t.google = { tokens, email };
  });
}

function drive() {
  if (!loadTokens().google) throw new Error("Google Drive não está conectado.");
  return google.drive({ version: "v3", auth: oauthClient() });
}

/** Folders the app created (drive.file cannot see the user's other folders). */
export async function googleListFolders() {
  const res = await drive().files.list({
    q: `mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: "files(id,name)",
    pageSize: 100,
  });
  return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name! }));
}

export async function googleCreateFolder(name: string) {
  const res = await drive().files.create({
    requestBody: { name, mimeType: FOLDER_MIME },
    fields: "id,name",
  });
  return { id: res.data.id!, name: res.data.name! };
}

/** Creates a Google Doc for the meeting in the chosen folder, or replaces its content. */
export async function saveToDrive(session: Session) {
  const g = loadTokens().google;
  if (!g?.folderId) throw new Error("Escolha a pasta do Google Drive onde as pautas serão salvas.");
  const d = drive();
  const media = {
    mimeType: "text/html",
    body: Readable.from([agendaToHtml(session.agenda, { date: session.createdAt })]),
  };
  const name = session.agenda.titulo || session.title;

  if (session.exportRef) {
    await d.files.update({ fileId: session.exportRef.id, requestBody: { name }, media });
    return;
  }
  const res = await d.files.create({
    requestBody: { name, mimeType: DOC_MIME, parents: [g.folderId] },
    media,
    fields: "id,webViewLink",
  });
  session.exportRef = {
    id: res.data.id!,
    url: res.data.webViewLink ?? `https://docs.google.com/document/d/${res.data.id}/edit`,
  };
}
