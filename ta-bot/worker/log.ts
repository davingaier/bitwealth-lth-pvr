type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = "info";

export function setLogLevel(level: Level) {
  threshold = level;
}

function emit(level: Level, component: string, msg: string, data?: Record<string, unknown>) {
  if (ORDER[level] < ORDER[threshold]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, component, msg, ...data });
  if (level === "error") console.error(line);
  else console.log(line);
}

export function logger(component: string) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => emit("debug", component, msg, data),
    info: (msg: string, data?: Record<string, unknown>) => emit("info", component, msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => emit("warn", component, msg, data),
    error: (msg: string, data?: Record<string, unknown>) => emit("error", component, msg, data),
  };
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
