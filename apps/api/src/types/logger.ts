/** 应用日志最小结构（pino.Logger 与 FastifyBaseLogger 均满足），供 service / plugin 依赖注入。 */
export interface AppLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}
