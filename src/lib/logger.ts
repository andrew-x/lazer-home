type Meta = Record<string, unknown>;
type Level = "info" | "warn" | "error";

/**
 * Tiny structured logger: JSON lines in production, readable in dev.
 * Swap the body for pino (or your platform's logger) without touching callers.
 */
function emit(level: Level, event: string, meta?: Meta) {
  if (process.env.NODE_ENV === "production") {
    console[level](
      JSON.stringify({ level, event, ...meta, at: new Date().toISOString() }),
    );
  } else {
    console[level](`[${level}] ${event}`, meta ?? "");
  }
}

export const logger = {
  info: (event: string, meta?: Meta) => emit("info", event, meta),
  warn: (event: string, meta?: Meta) => emit("warn", event, meta),
  error: (event: string, meta?: Meta) => emit("error", event, meta),
};
