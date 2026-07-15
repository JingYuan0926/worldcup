/** Minimal structured logger — timestamped, level-prefixed, no deps. */
type Level = "debug" | "info" | "warn" | "error";

const COLORS: Record<Level, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

function emit(level: Level, scope: string, msg: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  const color = process.stdout.isTTY ? COLORS[level] : "";
  const reset = process.stdout.isTTY ? RESET : "";
  const head = `${color}${ts} ${level.toUpperCase().padEnd(5)}${reset} [${scope}]`;
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console.log(head, msg, typeof extra === "string" ? extra : JSON.stringify(extra));
  } else {
    // eslint-disable-next-line no-console
    console.log(head, msg);
  }
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => {
      if (process.env.DEBUG) emit("debug", scope, msg, extra);
    },
    info: (msg: string, extra?: unknown) => emit("info", scope, msg, extra),
    warn: (msg: string, extra?: unknown) => emit("warn", scope, msg, extra),
    error: (msg: string, extra?: unknown) => emit("error", scope, msg, extra),
  };
}
