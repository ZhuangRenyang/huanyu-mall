import type { FastifyInstance } from "fastify";

/** Zod 单一事实来源：用 Zod schema 做请求校验（架构 §7.8）。校验失败 → 400/20001。 */
export function zodValidatorPlugin(app: FastifyInstance): void {
  app.setValidatorCompiler(({ schema }) => {
    const parse = (schema as { parse?: (data: unknown) => unknown }).parse;
    if (typeof parse !== "function") return () => true;
    return (data: unknown) => {
      try {
        return { value: parse(data) };
      } catch (err) {
        return { error: err as Error };
      }
    };
  });
}
