import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";

const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});
/** 登录标识：邮箱或管理员名（内置管理员登录标识为 admin）。顾客注册仍要求合法邮箱。 */
const loginBody = z.object({ email: z.string().min(1), password: z.string() });
const refreshBody = z.object({ refresh_token: z.string() });

function tokenResponse(pair: { accessToken: string; refreshToken: string; accessExpiresIn: number }) {
  return {
    access_token: pair.accessToken,
    refresh_token: pair.refreshToken,
    token_type: "Bearer",
    expires_in: pair.accessExpiresIn,
  };
}

/** Store 认证 4 端点（openapi 1040/1064/1088/1112）。 */
export function storeAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    "/api/v1/store/auth/register",
    { schema: { body: registerBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof registerBody>;
      const res = await deps.services.auth.register({
        email: b.email,
        password: b.password,
        profile: { firstName: b.first_name, lastName: b.last_name },
      });
      reply.code(201).ok({ identity_id: res.identityId, customer_id: res.customerId });
    },
  );

  app.post(
    "/api/v1/store/auth/login",
    { schema: { body: loginBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof loginBody>;
      reply.ok(tokenResponse(await deps.services.auth.login({ email: b.email, password: b.password })));
    },
  );

  app.post(
    "/api/v1/store/auth/refresh",
    { schema: { body: refreshBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof refreshBody>;
      reply.ok(tokenResponse(await deps.services.auth.refresh(b.refresh_token)));
    },
  );

  app.post(
    "/api/v1/store/auth/logout",
    { schema: { body: refreshBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof refreshBody>;
      await deps.services.auth.logout(b.refresh_token);
      reply.code(204).send();
    },
  );
}
