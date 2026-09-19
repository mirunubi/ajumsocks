import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apiUrl, publishableKey, readStatusEnv } from "./local-keys.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readStatusEnv();
const url = apiUrl(env);
const key = publishableKey(env);

const contents = `VITE_SUPABASE_URL=${url}
VITE_SUPABASE_PUBLISHABLE_KEY=${key}
`;

mkdirSync(join(root, "app"), { recursive: true });
writeFileSync(join(root, "app", ".env"), contents, "utf8");
console.log("wrote app/.env (URL + publishable key only)");
