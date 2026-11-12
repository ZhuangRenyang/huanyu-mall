import type { SmsPort } from "@mall/auth";

/**
 * 短信通道解析（外部 IO，可替换）。
 *
 * 原则：**宁可不发，也不假发**。
 *   - 生产（NODE_ENV=production）没配 SMS_PROVIDER → 不注册通道，
 *     发码接口直接报「短信通道未配置」。绝不静默降级成日志发送 ——
 *     那会让商家以为验证码发出去了，顾客却永远收不到。
 *   - 开发/演示默认 console：验证码打到日志，配合 auth 的 exposeDevCode
 *     前端能直接拿到验证码自测。
 *
 * 接真实服务商时在这里加分支（阿里云 / 腾讯云），并把 access key 放 .env。
 */
export interface SmsProvider {
  name: string;
  send: SmsPort["send"];
}

function consoleProvider(): SmsProvider {
  return {
    name: "console",
    async send({ phone, code, purpose }) {
      // 不打印完整手机号：日志也会被人看到
      const masked = `${phone.slice(0, 3)}****${phone.slice(-4)}`;
      console.log(`[sms] ${masked} purpose=${purpose} code=${code}`);
    },
  };
}

export function resolveSmsProvider(env: NodeJS.ProcessEnv = process.env): SmsProvider | null {
  const configured = env.SMS_PROVIDER;
  const fallback = env.NODE_ENV === "production" ? undefined : "console";
  const provider = configured ?? fallback;
  if (!provider) return null;
  if (provider === "console") return consoleProvider();
  // 配了不认识的通道：宁可启动即报错，也不要静默不发送
  throw new Error(`未知的短信通道 SMS_PROVIDER=${provider}（已支持：console）`);
}
