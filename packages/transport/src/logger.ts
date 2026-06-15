// A tiny dependency-free structured logger: one JSON object per line, with
// levels, bound context (child loggers), and SECRET REDACTION by policy. The
// interface mirrors pino's so a production deployment can swap in pino (or any
// JSON logger) behind the same shape without touching call sites.
//
// Default level is "silent" so importing a node/registry never spams output;
// production sets a level (or ALEPH_LOG_LEVEL) or injects its own logger.

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  // A child logger that merges `bindings` into every line (e.g. a per-request
  // logger bound to { trace, did }).
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  // Where a formatted line goes; default stdout. Injectable for tests.
  sink?: (line: string) => void;
  // Clock, injectable for deterministic tests.
  now?: () => number;
}

// Keys whose VALUES must never be logged. Conservative and name-based: secrets
// and bearer-like material. Note `sig` is NOT redacted — signatures are public.
const SECRET_KEY =
  /(private[_-]?key|privatekey|secret|passphrase|password|mnemonic|seed|authorization|bearer|apikey|api[_-]key|token)/i;
const REDACTED = "[REDACTED]";

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? (process.env.ALEPH_LOG_LEVEL as LogLevel | undefined) ?? "silent";
  const threshold = LEVEL_RANK[level] ?? LEVEL_RANK.silent;
  const sink = opts.sink ?? ((line: string) => process.stdout.write(line + "\n"));
  const now = opts.now ?? Date.now;
  const bindings = opts.bindings ?? {};

  function emit(lvl: Exclude<LogLevel, "silent">, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[lvl] < threshold) return;
    const line = redact({ ts: now(), level: lvl, msg, ...bindings, ...fields }) as Record<string, unknown>;
    sink(JSON.stringify(line));
  }

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (childBindings) => createLogger({ level, sink, now, bindings: { ...bindings, ...childBindings } }),
  };
}
