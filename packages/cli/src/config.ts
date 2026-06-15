// Typed configuration loader: read the environment, validate, and FAIL FAST on
// anything missing or malformed (a misconfigured server should never start and
// silently misbehave). Pure over an env object so it is unit-testable.
//
// Secrets (DATABASE_URL, RPC keys, signing keys) come from the platform's secret
// store as env vars — never from a committed file. See docs/operators/.

import type { LogLevel } from "@aleph/transport";

const LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

// Trim and treat empty/whitespace as absent (an unset env var via the platform
// can arrive as "").
function nonEmpty(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t === undefined || t === "" ? undefined : t;
}

export interface ServerConfig {
  port: number;
  host: string; // bind address (0.0.0.0 in a container)
  publicUrl?: string; // external base URL advertised in the Manifest / reported url
  databaseUrl?: string; // Postgres DSN; absent ⇒ in-memory (dev only)
  logLevel: LogLevel;
  peers: string[]; // registry federation peers
}

export function loadServerConfig(
  env: Record<string, string | undefined>,
  defaults: { port: number; host?: string },
): ServerConfig {
  const portRaw = env.PORT ?? String(defaults.port);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid PORT: ${portRaw} (expected an integer 1..65535)`);
  }

  const logLevel = (env.ALEPH_LOG_LEVEL ?? "info") as LogLevel;
  if (!LEVELS.includes(logLevel)) {
    throw new Error(`invalid ALEPH_LOG_LEVEL: ${env.ALEPH_LOG_LEVEL} (expected ${LEVELS.join("|")})`);
  }

  const publicUrl = nonEmpty(env.PUBLIC_URL);
  if (publicUrl !== undefined) {
    try {
      const u = new URL(publicUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("not http(s)");
    } catch {
      throw new Error(`invalid PUBLIC_URL: ${publicUrl} (expected an http(s) URL)`);
    }
  }

  const peers = (env.PEERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    port,
    host: env.HOST ?? defaults.host ?? "127.0.0.1",
    publicUrl,
    databaseUrl: nonEmpty(env.DATABASE_URL),
    logLevel,
    peers,
  };
}
