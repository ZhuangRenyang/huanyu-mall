import { z } from "zod";

/**
 * 统一响应封装（架构 §7.3）。
 * `code` 是稳定契约，`message` 可翻译可改。
 */
export const EnvelopeSchema = z.object({
  code: z.number().int(),
  data: z.unknown().nullable(),
  message: z.string(),
});

export const FieldErrorSchema = z.object({
  field: z.string(),
  code: z.string().optional(),
  message: z.string(),
});

export const EnvelopeWithMetaSchema = EnvelopeSchema.extend({
  requestId: z.string().optional(),
  details: z.array(FieldErrorSchema).optional(),
});

export type FieldError = z.infer<typeof FieldErrorSchema>;

export type Envelope<T = unknown> = {
  code: number;
  data: T | null;
  message: string;
  requestId?: string;
  details?: FieldError[];
};

/** 成功响应构造（纯函数，供接入层组装）。 */
export function ok<T>(data: T): Envelope<T> {
  return { code: 0, data, message: "" };
}
