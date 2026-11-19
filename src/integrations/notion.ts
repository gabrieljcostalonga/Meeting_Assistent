import notion from "@notionhq/client";
import type { Client as NotionClient } from "@notionhq/client";

// @notionhq/client is CommonJS: named ESM imports fail at runtime under Node.
const { Client, isFullPage } = notion;
type Client = NotionClient;
import { config } from "../config.js";
import type { Session } from "../session.js";
import { agendaToNotionBlocks } from "./render.js";
import { loadTokens, saveTokens } from "./tokenStore.js";

const redirectUri = () => `${config.baseUrl}/auth/notion/callback`;

export const notionOAuthAvailable = () => Boolean(config.notion.clientId && config.notion.clientSecret);

export function notionAuthUrl(state: string): string {
  const u = new URL("https://api.notion.com/v1/oauth/authorize");
  u.searchParams.set("client_id", config.notion.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("owner", "user");
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("state", state);
  return u.toString();
}

export async function notionExchangeCode(code: string) {
  const res = await new Client().oauth.token({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: config.notion.clientId,
    client_secret: config.notion.clientSecret,
  });
  saveTokens((t) => {
    t.notion = { accessToken: res.access_token, method: "oauth", workspaceName: res.workspace_name };
  });
}

/** Internal integration: the user pastes a token created at notion.so/my-integrations. */
export async function notionConnectInternal(token: string) {
  const client = new Client({ auth: token });
  const me = await client.users.me({}); // throws if the token is invalid
  saveTokens((t) => {
    t.notion = { accessToken: token, method: "internal", workspaceName: me.name ?? null };
  });
}

function client(): Client {
  const n = loadTokens().notion;
  if (!n) throw new Error("Notion não está conectado.");
  return new Client({ auth: n.accessToken });
}

function pageTitle(page: Parameters<typeof isFullPage>[0]): string {
  if (!isFullPage(page)) return "(sem título)";
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title") return prop.title.map((t) => t.plain_text).join("") || "(sem título)";
  }
  return "(sem título)";
}

/** Pages the integration can see (the user picks them on Notion's consent screen / "Connections"). */
export async function notionListPages(query = "") {
  const res = await client().search({
    query,
    filter: { property: "object", value: "page" },
    page_size: 50,
  });
  return res.results.map((r) => ({ id: r.id, title: pageTitle(r) }));
}

async function clearChildren(c: Client, pageId: string) {
  let cursor: string | undefined;
  const ids: string[] = [];
  do {
    const res = await c.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
    ids.push(...res.results.map((b) => b.id));
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  for (const id of ids) await c.blocks.delete({ block_id: id });
}

async function appendAll(c: Client, pageId: string, blocks: ReturnType<typeof agendaToNotionBlocks>) {
  for (let i = 0; i < blocks.length; i += 100) {
    await c.blocks.children.append({ block_id: pageId, children: blocks.slice(i, i + 100) });
  }
}

/** Creates the meeting page under the chosen parent page, or rewrites it on later saves. */
export async function saveToNotion(session: Session) {
  const n = loadTokens().notion;
  if (!n?.parentPageId) throw new Error("Escolha a página do Notion onde as pautas serão criadas.");
  const c = client();
  const blocks = agendaToNotionBlocks(session.agenda, { date: session.createdAt });
  const title = [{ type: "text" as const, text: { content: session.agenda.titulo.slice(0, 2000) } }];

  if (session.exportRef) {
    await c.pages.update({ page_id: session.exportRef.id, properties: { title: { title } } });
    await clearChildren(c, session.exportRef.id);
    await appendAll(c, session.exportRef.id, blocks);
    return;
  }
  const page = await c.pages.create({
    parent: { page_id: n.parentPageId },
    properties: { title: { title } },
    children: blocks.slice(0, 100),
  });
  await appendAll(c, page.id, blocks.slice(100));
  session.exportRef = { id: page.id, url: "url" in page ? page.url : `https://www.notion.so/${page.id.replace(/-/g, "")}` };
}
