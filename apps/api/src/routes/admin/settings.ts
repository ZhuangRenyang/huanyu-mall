import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ThemeSettingsDTO } from "@mall/theme";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

const themeBody = z.object({
  primary_color: z.string().optional(),
  gradient_color: z.string().optional(),
  accent_color: z.string().optional(),
  font_family: z.string().optional(),
  border_radius: z.string().optional(),
  shadow: z.string().optional(),
  logo_file_id: z.string().nullable().optional(),
  product_image_ratio: z.string().optional(),
  // 公告：空串按「没填」处理，避免 null 与 "" 两种空值混存（ADR-047）
  announcement: z
    .string()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
});

/**
 * 通用设置 PATCH：外观变量 + 店铺资料（ADR-045）。
 *
 * 不再用 z.record(unknown) 全放开：设置是低频但高影响的写入口，
 * 放开任意键等于让拼错的字段静默落库（读的时候才发现没生效）。
 */
const patchSettingsBody = themeBody
  .extend({
    store_name: z.string().trim().min(1).max(40).optional(),
    // 空串按「没填」处理：null 与 "" 两种空值混着存，读的时候要判两次
    support_phone: z
      .string()
      .max(30)
      .nullable()
      .optional()
      .transform((v) => (v && v.trim() ? v.trim() : null)),
    /*
     * 退货收件地址（ADR-053）：多行文本，空串按「没配」处理。
     * 上限 300 字：国内地址 + 收件人 + 电话，一行地址一般 60 字以内，
     * 留足转运仓备注的余量，又不至于让顾客看到一屏乱码。
     */
    return_address: z
      .string()
      .max(300)
      .nullable()
      .optional()
      .transform((v) => (v && v.trim() ? v.trim() : null)),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  // strict：拼错的键要报错，不能静默落库（设置是低频高影响的写入口）
  .strict();
const providerConfigBody = z.object({
  options: z.record(z.string(), z.unknown()),
  enabled_channels: z.array(z.string()).optional(),
});

/**
 * 顾客账号设置（ADR-025）。
 *
 * register_mode = email：邮箱 + 密码注册（Shopify 路线，独立站常用）
 * register_mode = phone：手机号 + 验证码，注册即登录（淘宝路线）
 * 两种都是成熟做法，面国内还是面海外由商家自己定 —— 所以是店铺设置，不是代码常量。
 */
const authSettingsBody = z.object({
  register_mode: z.enum(["email", "phone"]).optional(),
});

/** Admin 设置（openapi 1664/1703/1726）+ provider 配置读写。settings 需 admin 权限（staff → 403）。 */
export function adminSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];

  app.get("/api/v1/admin/settings", { preHandler: guard }, async (_req, reply) => {
    reply.ok({ settings: await deps.services.theme.getSettings() });
  });

  app.patch(
    "/api/v1/admin/settings",
    { preHandler: guard, schema: { body: patchSettingsBody } },
    async (req, reply) => {
      const before = await deps.services.theme.getSettings();
      const body = req.body as Partial<ThemeSettingsDTO>;
      /*
       * metadata 是合并而不是覆盖（ADR-079）：装修页只提交 home_modules 一项，
       * 整体覆盖会把其它写在 metadata 里的配置悄悄抹掉。
       */
      if (body.metadata !== undefined) {
        body.metadata = { ...(before.metadata ?? {}), ...(body.metadata ?? {}) };
      }
      const settings = await deps.services.theme.updateSettings(body);
      await deps.audit.record(
        auditEntry(req, {
          action: "settings.update",
          entityType: "settings",
          entityId: before.id,
          before,
          after: settings,
        }),
      );
      reply.ok({ settings });
    },
  );

  /**
   * 读取外观设置（含 logo 的公开 URL）。
   *
   * 之前只有 PUT，没有 GET：后台读外观设置会 404，而前端 catch 后静默返回默认值 ——
   * 商家改完保存成功、刷新又看到默认配色，以为没保存（ADR-046）。
   */
  /** 微页面（ADR-082）：标题 + 纯文本正文，空行分段。 */
  const pageBody = z
    .object({
      slug: z
        .string()
        .min(2)
        .max(60)
        .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "地址只能用小写字母、数字与连字符"),
      title: z.string().trim().min(1).max(80),
      content: z.string().max(20000).optional(),
      is_published: z.boolean().optional(),
    })
    .strict();

  app.get("/api/v1/admin/settings/pages", { preHandler: guard }, async (_req, reply) => {
    const items = await deps.services.theme.listMicroPages();
    reply.ok({ items, count: items.length });
  });

  app.post(
    "/api/v1/admin/settings/pages",
    { preHandler: guard, schema: { body: pageBody } },
    async (req, reply) => {
      const created = await deps.services.theme.createMicroPage(req.body as never);
      await deps.audit.record(
        auditEntry(req, {
          action: "theme.page.create",
          entityType: "micro_page",
          entityId: created.id,
          after: created,
        }),
      );
      reply.code(201).ok(created);
    },
  );

  app.patch(
    "/api/v1/admin/settings/pages/:id",
    { preHandler: guard, schema: { body: pageBody.partial() } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const updated = await deps.services.theme.updateMicroPage(id, req.body as never);
      await deps.audit.record(
        auditEntry(req, {
          action: "theme.page.update",
          entityType: "micro_page",
          entityId: id,
          after: updated,
        }),
      );
      reply.ok(updated);
    },
  );

  app.delete(
    "/api/v1/admin/settings/pages/:id",
    { preHandler: guard },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await deps.services.theme.deleteMicroPage(id);
      await deps.audit.record(
        auditEntry(req, { action: "theme.page.delete", entityType: "micro_page", entityId: id }),
      );
      reply.ok({ id });
    },
  );

  /**
   * 链接选择器（ADR-081）。
   *
   * 装修里的跳转必须是「能点开」的路径：让商家手打 URL，十次有三次拼错。
   * 这里按关键字返回商品/分类的展示名与**带语言与渠道前缀**的站内路径，
   * 商家点一下即可，不用知道 /zh-CN/cn 这类前缀规则。
   */
  app.get("/api/v1/admin/settings/link-targets", { preHandler: guard }, async (req, reply) => {
    const query = req.query as { type?: string; q?: string };
    const type =
      query.type === "category" ? "category" : query.type === "page" ? "page" : "product";
    const needle = (query.q ?? "").trim().toLowerCase();

    // 首选启用中的渠道：路径必须带 locale 与 channel，否则店面 404
    const channels = await deps.services.regionChannel.listChannels({ isActive: true });
    const channel = channels[0];
    const base = `/${channel?.default_locale ?? "zh-CN"}/${channel?.slug ?? "cn"}`;

    if (type === "product") {
      const res = await deps.services.product.listProducts({
        ...(needle ? { q: needle } : {}),
        limit: 10,
      });
      reply.ok({
        items: res.items.map((p) => ({
          id: p.id,
          label: p.title,
          href: `${base}/products/${p.handle}`,
        })),
      });
      return;
    }

    if (type === "page") {
      // 只给已发布的：链接到草稿等于给顾客一个 404
      const pages = (await deps.services.theme.listMicroPages()).filter((p) => p.is_published);
      reply.ok({
        items: pages
          .filter((p) => (needle ? p.title.toLowerCase().includes(needle) : true))
          .slice(0, 10)
          .map((p) => ({ id: p.id, label: p.title, href: `${base}/p/${p.slug}` })),
      });
      return;
    }

    const categories = await deps.services.product.listCategories(true);
    reply.ok({
      items: categories
        .filter((c) => (needle ? c.name.toLowerCase().includes(needle) : true))
        .slice(0, 10)
        .map((c) => ({
          id: c.id,
          label: c.name,
          href: `${base}/products?category=${encodeURIComponent(c.id)}`,
        })),
    });
  });

  /**
   * 轮播图（ADR-080）。
   *
   * 链接在服务层过白名单（站内 / 或 https），路由只做长度校验；
   * 图片走 file 模块的 file_id，和商品图同一套上传，不另建一套存储。
   */
  const bannerBody = z
    .object({
      image_file_id: z.string().min(1),
      link: z.string().max(500).nullable().optional(),
      sort_order: z.number().int().optional(),
      is_active: z.boolean().optional(),
    })
    .strict();

  app.get("/api/v1/admin/settings/banners", { preHandler: guard }, async (_req, reply) => {
    const items = await deps.services.theme.listBanners(false);
    const urls = await deps.services.file.getPublicUrls(items.map((b) => b.image_file_id));
    reply.ok({
      items: items.map((b) => ({ ...b, image_url: urls[b.image_file_id] ?? null })),
      count: items.length,
    });
  });

  app.post(
    "/api/v1/admin/settings/banners",
    { preHandler: guard, schema: { body: bannerBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof bannerBody>;
      const created = await deps.services.theme.createBanner(b);
      await deps.audit.record(
        auditEntry(req, {
          action: "theme.banner.create",
          entityType: "theme_banner",
          entityId: created.id,
          after: created,
        }),
      );
      reply.code(201).ok(created);
    },
  );

  app.patch(
    "/api/v1/admin/settings/banners/:id",
    { preHandler: guard, schema: { body: bannerBody.partial() } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const updated = await deps.services.theme.updateBanner(id, req.body as never);
      await deps.audit.record(
        auditEntry(req, {
          action: "theme.banner.update",
          entityType: "theme_banner",
          entityId: id,
          after: updated,
        }),
      );
      reply.ok(updated);
    },
  );

  app.delete(
    "/api/v1/admin/settings/banners/:id",
    { preHandler: guard },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await deps.services.theme.deleteBanner(id);
      await deps.audit.record(
        auditEntry(req, { action: "theme.banner.delete", entityType: "theme_banner", entityId: id }),
      );
      reply.ok({ id });
    },
  );

  app.get("/api/v1/admin/settings/theme", { preHandler: guard }, async (_req, reply) => {
    const theme = await deps.services.theme.getSettings();
    const logoUrl = theme.logo_file_id
      ? (await deps.services.file.getPublicUrls([theme.logo_file_id]))[theme.logo_file_id] ?? null
      : null;
    reply.ok({ theme: { ...theme, logo_url: logoUrl } });
  });

  app.put(
    "/api/v1/admin/settings/theme",
    { preHandler: guard, schema: { body: themeBody } },
    async (req, reply) => {
      const before = await deps.services.theme.getSettings();
      const theme = await deps.services.theme.updateSettings(req.body as Partial<ThemeSettingsDTO>);
      await deps.audit.record(
        auditEntry(req, {
          action: "theme.update",
          entityType: "theme",
          entityId: theme.id,
          before,
          after: theme,
        }),
      );
      reply.ok({ theme });
    },
  );

  app.get("/api/v1/admin/settings/auth", { preHandler: guard }, async (_req, reply) => {
    reply.ok(await deps.services.auth.getSettings());
  });

  app.put(
    "/api/v1/admin/settings/auth",
    { preHandler: guard, schema: { body: authSettingsBody } },
    async (req, reply) => {
      const before = await deps.services.auth.getSettings();
      const after = await deps.services.auth.updateSettings(
        req.body as z.infer<typeof authSettingsBody>,
      );
      await deps.audit.record(
        auditEntry(req, {
          action: "auth.settings.update",
          entityType: "auth_settings",
          entityId: "auth_default",
          before,
          after,
        }),
      );
      reply.ok(after);
    },
  );

  app.put(
    "/api/v1/admin/settings/payment-providers/:id",
    { preHandler: guard, schema: { body: providerConfigBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof providerConfigBody>;
      const before = await deps.services.payment.getProviderConfig(id);
      const view = await deps.services.payment.configureProvider({
        identifier: id,
        options: b.options,
        enabledChannels: b.enabled_channels,
      });
      // 落库的是掩码视图（options_masked），明文密钥不进审计表。
      await deps.audit.record(
        auditEntry(req, {
          action: "payment_provider.configure",
          entityType: "payment_provider",
          entityId: id,
          before,
          after: view,
        }),
      );
      reply.ok(view);
    },
  );

  app.get("/api/v1/admin/settings/payment-providers/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const view = await deps.services.payment.getProviderConfig(id);
    reply.ok(view);
  });
}
