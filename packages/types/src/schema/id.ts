import { z } from "zod";

/** ULID（Crockford base32，26 字符）。 */
export const UlidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

/** 模块实体 id：`<prefix>_<ulid>`。 */
export const EntityIdSchema = z.string().regex(/^[a-z][a-z0-9_]*_[0-9A-HJKMNP-TV-Z]{26}$/);

export type EntityId = z.infer<typeof EntityIdSchema>;
