import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";

/**
 * 邮箱注册：邮箱 + 密码 + 手机号（必填）+ 验证码（ADR-025）。
 *
 * 验证码可以发到邮箱也可以发到手机，由 `channel` 指定 ——
 * 顾客自己选哪条通道能收到，不强迫他先有某个通道。
 */
const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  /** 注册必须绑手机号：它是后续「手机号 + 验证码登录」的主体。 */
  phone: z.string().min(11).max(20),
  channel: z.enum(["sms", "email"]).default("email"),
  code: z.string().length(6),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});
/**
 * 密码登录：identifier 可以是邮箱，也可以是手机号（淘宝两种都支持）。
 * 兼容旧字段 `email`：老客户端仍在用，不做硬切。
 */
const loginBody = z
  .object({ identifier: z.string().min(1).optional(), email: z.string().min(1).optional(), password: z.string() })
  .refine((b) => Boolean(b.identifier ?? b.email), { message: "请填写邮箱或手机号" });

/** 发验证码：短信或邮件两条通道。 */
const codeBody = z.object({
  channel: z.enum(["sms", "email"]).default("sms"),
  target: z.string().min(6).max(120),
  purpose: z.enum(["login", "register", "reset"]).default("login"),
});

/** 手机号 + 验证码登录（淘宝：注册即登录）。 */
const phoneLoginBody = z.object({ phone: z.string().min(6).max(20), code: z.string().length(6) });
const refreshBody = z.object({ refresh_token: z.string() });

/**
 * 忘记密码（ADR-027）。
 *
 * 第一步输账号（邮箱或手机号）发验证码，第二步填验证码 + 新密码。
 * 通道跟着账号类型走，不让顾客再选一次。
 */
const forgotPasswordBody = z.object({ identifier: z.string().min(1).max(120) });
const resetPasswordBody = z.object({
  identifier: z.string().min(1).max(120),
  code: z.string().length(6),
  new_password: z.string().min(8),
});

function tokenResponse(pair: { accessToken: string; refreshToken: string; accessExpiresIn: number }) {
  return {
    access_token: pair.accessToken,
    refresh_token: pair.refreshToken,
    token_type: "Bearer",
    expires_in: pair.accessExpiresIn,
  };
}

/** Store 认证端点（openapi 1040/1064/1088/1112）。 */
export function storeAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  /**
   * 店铺对顾客开放的注册方式（公开端点）。
   *
   * 店面据此决定「注册」页签渲染邮箱表单还是手机号表单 ——
   * 前端不该硬编码某一种，商店面向国内还是海外，由商家在后台决定。
   */
  app.get("/api/v1/store/auth/settings", async (_req, reply) => {
    reply.ok(await deps.services.auth.getSettings());
  });

  app.post(
    "/api/v1/store/auth/register",
    { schema: { body: registerBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof registerBody>;
      const res = await deps.services.auth.register({
        email: b.email,
        password: b.password,
        phone: b.phone,
        channel: b.channel,
        code: b.code,
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
      reply.ok(
        tokenResponse(
          await deps.services.auth.login({
            identifier: b.identifier ?? b.email!,
            password: b.password,
          }),
        ),
      );
    },
  );

  /**
   * 发送验证码。
   *
   * 开发环境响应会带 dev_code（AUTH_EXPOSE_DEV_CODE），生产不带 —— 这是自测与安全的折中。
   */
  app.post(
    "/api/v1/store/auth/codes",
    { schema: { body: codeBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof codeBody>;
      const res = await deps.services.auth.sendVerificationCode({
        channel: b.channel,
        target: b.target,
        purpose: b.purpose,
      });
      reply.ok({
        sent: res.sent,
        // 仅开发环境：生产下恒为 undefined
        ...(res.devCode ? { dev_code: res.devCode } : {}),
      });
    },
  );

  /**
   * 手机号 + 验证码登录。
   *
   * 手机号不存在时自动注册（淘宝做法）：顾客不区分「注册」和「登录」，
   * 第一次输码就是注册，之后每次输码就是登录。
   */
  app.post(
    "/api/v1/store/auth/login/phone",
    { schema: { body: phoneLoginBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof phoneLoginBody>;
      const pair = await deps.services.auth.loginWithPhoneCode({ phone: b.phone, code: b.code });
      reply.ok(tokenResponse(pair));
    },
  );

  app.post(
    "/api/v1/store/auth/password/forgot",
    { schema: { body: forgotPasswordBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof forgotPasswordBody>;
      const res = await deps.services.auth.requestPasswordReset({ identifier: b.identifier });
      reply.ok({
        sent: res.sent,
        channel: res.channel,
        ...(res.devCode ? { dev_code: res.devCode } : {}),
      });
    },
  );

  /**
   * 第二步：验证码 + 新密码。
   *
   * 不签发 token（204）：重设完让顾客用新密码登录一次，
   * 顺手验证「新密码确实记住了」，也避免旧设备被静默接管。
   */
  app.post(
    "/api/v1/store/auth/password/reset",
    { schema: { body: resetPasswordBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof resetPasswordBody>;
      await deps.services.auth.resetPassword({
        identifier: b.identifier,
        code: b.code,
        newPassword: b.new_password,
      });
      reply.code(204).send();
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
