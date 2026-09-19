import { execSync } from "node:child_process";

export function readStatusEnv() {
  const output = execSync("npx supabase status -o env", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  const env = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=("?)(.*)\2$/);
    if (match) env[match[1]] = match[3];
  }
  return env;
}

export function apiUrl(env = readStatusEnv()) {
  return env.API_URL || env.SUPABASE_URL;
}

export function publishableKey(env = readStatusEnv()) {
  const key = env.PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error("PUBLISHABLE_KEY missing from supabase status. Use the new sb_publishable_ key.");
  }
  if (key.startsWith("sb_secret_") || /service_role/i.test(key)) {
    throw new Error("Refusing Secret / BYPASSRLS credential as a publishable key.");
  }
  return key;
}

export function secretKey(env = readStatusEnv()) {
  const key = env.SECRET_KEY || env.SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error("SECRET_KEY missing from supabase status. Use the new sb_secret_ key.");
  }
  if (key.startsWith("sb_publishable_")) {
    throw new Error("Refusing publishable key as a secret.");
  }
  return key;
}
