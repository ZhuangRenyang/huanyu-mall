import nodemailer from "nodemailer";
import { notificationConfigInvalid, notificationSendFailed } from "../errors.js";
import type { EmailMessage } from "../types.js";

/** 一次发送所需的 SMTP 配置（由服务层从设置读出并解密密码）。 */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** 明文密码，仅在内存里存在这一瞬。 */
  password: string;
  fromName: string;
  fromEmail: string;
}

/**
 * SMTP 发信。
 *
 * 超时是这里最重要的一行：SMTP 服务器不可达时，一次连接最多 10 秒、一次会话最多 20 秒，
 * 绝不允许把派发器的整批拖成几分钟（ADR-016 代价一节）。
 */
export async function sendViaSmtp(cfg: SmtpConfig, msg: EmailMessage): Promise<void> {
  if (!cfg.host) throw notificationConfigInvalid("未填写 SMTP 服务器地址");
  if (!cfg.fromEmail) throw notificationConfigInvalid("未填写发件人邮箱");

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.password } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  try {
    await transporter.sendMail({
      from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromEmail,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw notificationSendFailed(reason.slice(0, 300));
  } finally {
    transporter.close();
  }
}
