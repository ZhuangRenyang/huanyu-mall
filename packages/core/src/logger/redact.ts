/**
 * 敏感字段脱敏路径（pino redact）。
 * 覆盖令牌、密钥、密码、cookie 等；其余字段原样输出。
 */
export const SENSITIVE_PATHS: string[] = [
  "password",
  "*.password",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "authorization",
  "*.authorization",
  "apiKey",
  "*.apiKey",
  "secret",
  "*.secret",
  "secrets",
  "*.secrets",
  "cookie",
  "*.cookie",
  "set-cookie",
  "*.set-cookie",
  "x-publishable-key",
  "*.x-publishable-key",
];

export const REDACT_CENSOR = "******";
