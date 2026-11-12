import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * 商品分类（ADR-028）。
 *
 * 对应淘宝「商品 → 商品分类」：分类是商品域的组织方式，决定顾客怎么逛
 * （分类导航 → 分类页 → 商品），不是标签、也不是营销分组。
 *
 * 只做两级：一级 + 二级。淘宝的多级类目对自建店铺是过度设计，
 * 商家真正需要的是「能建、能排序、能停用、看得见每类有多少货」。
 */
const createCategoryBody = z.object({
  name: z.string().min(1).max(40),
  /** URL 标识；不填按名称生成（中文名生成不了可读 slug，会退回短码）。 */
  handle: z.string().min(1).max(60).optional(),
  parent_id: z.string().nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

const updateCategoryBody = createCategoryBody.partial();

export function adminCategoryRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("products")];
  const categories = () => deps.services.product;

  app.get("/api/v1/admin/categories", { preHandler: guard }, async (_req, reply) => {
    const items = await categories().listCategories();
    reply.ok({ items, count: items.length });
  });

  app.post(
    "/api/v1/admin/categories",
    { preHandler: guard, schema: { body: createCategoryBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createCategoryBody>;
      const created = await categories().createCategory({
        name: b.name,
        ...(b.handle !== undefined ? { handle: b.handle } : {}),
        ...(b.parent_id !== undefined ? { parentId: b.parent_id } : {}),
        ...(b.sort_order !== undefined ? { sortOrder: b.sort_order } : {}),
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "category.create",
          entityType: "category",
          entityId: created.id,
          after: created,
        }),
      );
      reply.code(201).ok(created);
    },
  );

  app.patch(
    "/api/v1/admin/categories/:id",
    { preHandler: guard, schema: { body: updateCategoryBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof updateCategoryBody>;
      const before = (await categories().listCategories()).find((c) => c.id === id) ?? null;
      const updated = await categories().updateCategory(id, {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.handle !== undefined ? { handle: b.handle } : {}),
        ...(b.parent_id !== undefined ? { parentId: b.parent_id } : {}),
        ...(b.sort_order !== undefined ? { sortOrder: b.sort_order } : {}),
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "category.update",
          entityType: "category",
          entityId: id,
          before,
          after: updated,
        }),
      );
      reply.ok(updated);
    },
  );

  /**
   * 删除分类。
   *
   * 有商品或有子分类时服务层直接拒绝 —— 软删后商品会挂在「不存在的分类」下，
   * 店面的分类导航会指向空页，比报错更难排查。
   */
  app.delete("/api/v1/admin/categories/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = (await categories().listCategories()).find((c) => c.id === id) ?? null;
    await categories().deleteCategory(id);
    await deps.audit.record(
      auditEntry(req, {
        action: "category.delete",
        entityType: "category",
        entityId: id,
        before,
      }),
    );
    reply.code(204).send();
  });
}
