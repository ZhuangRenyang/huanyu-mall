import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

const uploadBody = z.object({
  filename: z.string(),
  content_type: z.string(),
  data_base64: z.string(),
});

/** Admin 文件上传 1 端点（openapi 1757）。一期用 JSON+base64（真实 multipart 待接 @fastify/multipart）。 */
export function adminFileRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("files")];

  app.post(
    "/api/v1/admin/files",
    {
      preHandler: guard,
      schema: { body: uploadBody },
      // 图片上传单独放宽到 20MB，与 nginx client_max_body_size 20m 对齐；
      // 其余接口走全局 1MB 上限（见 config.security.bodyLimitBytes）。
      bodyLimit: deps.config.security.uploadBodyLimitBytes,
    },
    async (req, reply) => {
      const b = req.body as z.infer<typeof uploadBody>;
      const file = await deps.services.file.upload({
        filename: b.filename,
        contentType: b.content_type,
        data: Buffer.from(b.data_base64, "base64"),
      });
      const url = await deps.services.file.getPublicUrl(file.id);
      // 只留元数据，不把文件内容写进审计表。
      await deps.audit.record(
        auditEntry(req, {
          action: "file.upload",
          entityType: "file",
          entityId: file.id,
          after: {
            id: file.id,
            filename: file.filename,
            content_type: file.content_type,
            size_bytes: file.size_bytes,
          },
        }),
      );
      reply.code(201).ok({ ...file, url });
    },
  );
}
