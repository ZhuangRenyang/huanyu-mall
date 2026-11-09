import type { FastifyReply, FastifyRequest } from "fastify";
import { errors } from "@mall/core";
import type { AuthContext } from "@mall/auth";
import type { AppDeps } from "../deps.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

function bearer(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice(7);
}

export interface AuthHelpers {
  customerAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  adminAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  requirePermission: (permission: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export function makeAuthHelpers(deps: AppDeps): AuthHelpers {
  const customerAuth = async (req: FastifyRequest): Promise<void> => {
    const token = bearer(req);
    if (!token) return; // 店面匿名可读
    const ctx = await deps.services.auth.verifyAccessToken(token);
    if (ctx.scope !== "customer") throw errors.forbidden("customer scope required");
    req.auth = ctx;
  };

  const adminAuth = async (req: FastifyRequest): Promise<void> => {
    const token = bearer(req);
    if (!token) throw errors.unauthenticated();
    const ctx = await deps.services.auth.verifyAccessToken(token);
    if (ctx.scope !== "admin") throw errors.forbidden("admin scope required");
    req.auth = ctx;
  };

  const requirePermission = (permission: string) => async (req: FastifyRequest): Promise<void> => {
    deps.services.auth.assertPermission(req.auth!, permission);
  };

  return { customerAuth, adminAuth, requirePermission };
}

/** 解析店面 channel：x-publishable-key → id/slug，否则第一个启用渠道。 */
export async function resolveChannelId(
  deps: AppDeps,
  req: FastifyRequest,
): Promise<string> {
  const key = (req.headers["x-publishable-key"] as string | undefined) ?? undefined;
  const channels = await deps.services.regionChannel.listChannels({ isActive: true });
  if (key) {
    const bySlug = channels.find((c) => c.slug === key || c.id === key);
    if (bySlug) return bySlug.id;
  }
  if (channels[0]) return channels[0].id;
  throw errors.notFound("no active channel");
}
