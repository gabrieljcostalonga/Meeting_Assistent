import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/** Credentials and preferences saved on THIS machine only (data/tokens.json, git-ignored). */
export interface StoredTokens {
  notion?: {
    accessToken: string;
    method: "oauth" | "internal";
    workspaceName?: string | null;
    parentPageId?: string;
    parentPageTitle?: string;
  };
  google?: {
    tokens: {
      access_token?: string | null;
      refresh_token?: string | null;
      expiry_date?: number | null;
      scope?: string;
      token_type?: string | null;
    };
    email?: string | null;
    folderId?: string;
    folderName?: string;
  };
  preferredDestination?: "notion" | "drive";
}

const file = () => path.join(config.dataDir, "tokens.json");

export function loadTokens(): StoredTokens {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) as StoredTokens;
  } catch {
    return {};
  }
}

export function saveTokens(update: (t: StoredTokens) => void): StoredTokens {
  const t = loadTokens();
  update(t);
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(t, null, 2), { mode: 0o600 });
  return t;
}
