import pino from "pino";
import { getRequestId } from "./request-id.js";
import { REDACT_CENSOR, SENSITIVE_PATHS } from "./redact.js";

export type Logger = pino.Logger;

export interface LoggerOptions {
  name?: string;
  level?: string;
  redactPaths?: string[];
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  return pino({
    name: opts.name ?? "mall",
    level: opts.level ?? process.env.LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: opts.redactPaths ?? SENSITIVE_PATHS,
      censor: REDACT_CENSOR,
    },
    mixin() {
      const requestId = getRequestId();
      return requestId ? { requestId } : {};
    },
  });
}

export const defaultLogger: Logger = createLogger();
