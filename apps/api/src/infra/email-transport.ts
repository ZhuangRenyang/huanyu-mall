import type { EmailPort } from "@mall/auth";
import type { INotificationModuleService } from "@mall/notification";
import type { VerificationPurpose } from "@mall/auth";

/**
 * 邮件验证码通道（外部 IO）。
 *
 * 复用通知模块已配置的 SMTP —— 商家在「设置 → 通知」里填过一次，
 * 验证码邮件和订单邮件走同一份配置，不要求他配两遍。
 *
 * 原则与短信通道一致：**宁可不发，也不假发**。
 *   - 生产没配 SMTP → 抛错，接口明确告诉顾客「邮件通道未配置」；
 *   - 开发没配 SMTP → 打到日志（配合 AUTH_EXPOSE_DEV_CODE，前端直接拿到验证码自测）。
 */

const PURPOSE_LABEL: Record<VerificationPurpose, string> = {
  register: "注册",
  login: "登录",
  reset: "重置密码",
};

export interface EmailProvider {
  name: string;
  send: EmailPort["send"];
}

/** 日志里不打完整邮箱：日志也会被人看到。 */
function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "***";
  const head = name.slice(0, 1);
  return `${head}${"*".repeat(Math.max(1, Math.min(4, name.length - 1)))}@${domain}`;
}

function renderCodeMail(code: string, purpose: VerificationPurpose): {
  subject: string;
  html: string;
  text: string;
} {
  const label = PURPOSE_LABEL[purpose];
  const subject = `【商城】${label}验证码：${code}`;
  const text = `你的${label}验证码是 ${code}，5 分钟内有效。\n如果不是你本人操作，请忽略本邮件。`;
  // 纯内联样式、不引外部资源：邮箱客户端多半会拦外链，样式写了也白写
  const html =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#111">' +
    `<p style="margin:0 0 12px">你的${label}验证码是</p>` +
    `<p style="margin:0 0 12px;font-size:28px;letter-spacing:6px;font-weight:600">${code}</p>` +
    '<p style="margin:0;color:#666">5 分钟内有效。如果不是你本人操作，请忽略本邮件。</p>' +
    "</td></tr></table>";
  return { subject, html, text };
}

export function createEmailProvider(
  notification: INotificationModuleService,
  env: NodeJS.ProcessEnv = process.env,
): EmailProvider {
  const isProduction = env.NODE_ENV === "production";

  return {
    name: "smtp",
    async send({ email, code, purpose }) {
      const settings = await notification.getSettings();
      if (!settings.smtp_host) {
        if (isProduction) {
          // 生产不静默降级：商家以为发出去、顾客永远收不到，比直接报错更糟
          throw new Error("邮件通道未配置：请先在 设置 → 通知 里填写 SMTP");
        }
        console.log(`[email] ${maskEmail(email)} purpose=${purpose} code=${code}`);
        return;
      }
      const mail = renderCodeMail(code, purpose);
      await notification.sendMail({ to: email, ...mail });
    },
  };
}
