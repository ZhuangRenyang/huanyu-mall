# 00 · 蓝图对齐与开发纪律

> **权威来源**：本文档的规则全部来自项目简报《全球商城项目简报》。
> **冲突处理**：本文件与其它文档冲突时，以项目简报为准；简报与正文（PRD/架构文档）冲突时，以简报声明为"以该节为准"的正文条款为准。
> **本文档的作用**：把蓝图变成**可逐条核对的清单**，让"不要乱开发"变成可验证的事实，而不是一句口号。
>
> 最后核对时间：2026-11-09 · 核对方式：读代码 + 跑门禁脚本，不采信口头结论

---

## 一、技术路线（三家分工，缺一不可）

| 角色 | 参考对象 | 只取什么 | 授权 |
|---|---|---|---|
| 骨架 | Medusa | 模块拆分、Workflow + compensation、links 关联、Plugin 打包、Provider 接口 | MIT，可参考可复用（企业版 RBAC/SSO 除外） |
| 建模 | Saleor | Channel 多市场、product types + attributes、仓库分配、促销三件套、Webhook 体系 | BSD-3，可参考可复用（保留版权声明）；**不采用 GraphQL-only** |
| 功能清单 | BeikeShop | 只取功能与产品形态、后台易用性 | **OSL-3.0 + 附加条款：禁止复制任何代码/样式/素材** |

**红线**：任何从参考仓库取用的代码必须登记来源（见 `docs/decisions/`）。BeikeShop 只许"看功能"，不许"抄实现"。

---

## 二、13 条架构铁律 × 现状核对

状态说明：`符合` = 有实现且有证据；`部分` = 有基础但未达标；`缺失` = 未开始（需按分期计划补，**不代表遗漏**）。

| # | 铁律 | 状态 | 证据 / 差距 |
|---|---|---|---|
| 1 | 模块化单体，模块自有数据模型与服务层 | **符合** | `packages/modules/` 下 13 个模块：region-channel / product / pricing / tax / customer / file / auth / inventory / cart / order / payment / fulfillment / theme |
| 2 | 模块间禁止数据库外键，跨模块走 links | **符合** | `pnpm check:module-graph` → PASS（13 模块，依赖图无环且分层正确）；`packages/core/src/links/define-link.ts` |
| 3 | 跨模块流程只走 Workflow，每步必须有 compensation | **符合** | `packages/core/src/workflow/`：engine / journal / retry / registry；`examples/cart-complete.ts`；`order.service.ts` 使用补偿 |
| 4 | 扩展只通过 Module / Workflow Hooks / Subscriber / Plugin 四种机制 | **部分** | Module ✓、Subscriber ✓（`core/src/event/subscriber-registry.ts`）；**Workflow Hooks 缺失**、**Plugin（npm 包）机制缺失**（`apps/api` 里的 "plugin" 是 Fastify 插件，不是业务插件机制） |
| 5 | 外部能力一律 Provider 化 | **部分** | Payment ✓（abstract + registry + 4 家 provider + signature）；File 已在类型/配置层预留 `"local" \| "s3"` 但**只有 local 实现**；Notification ✗、Search ✗（均属二期）；Tax 按一期要求"预留 Provider" ✓ |
| 6 | 事件分两层：进程内 Event Bus + 对外 Webhook 投递层 | **部分** | 进程内 Event Bus **质量高于底线**：`EventBus` + `InProcessEventBus` + `outbox.ts` + `OutboxRelay`（事务性发件箱）；**对外 Webhook 投递层（订阅/签名/重试/死信）属二期，未开始** |
| 7 | 全球化主轴：Region（币种）+ Channel（市场）+ `/{locale}/{channel}/` | **符合** | `apps/storefront/app/[locale]/[channel]/` 下 products / cart / checkout / orders / account 五个子路由；`region-channel` 模块 |
| 8 | 商品建模：product type 定义属性集，attributes 可复用可筛选可翻译，规格与属性分开 | **符合** | `packages/modules/product/src/models/`：`attributes.ts` + `catalog.ts` |
| 9 | 一键安装：一条命令完成安装部署，零必填配置 | **符合** | `deploy/install.sh` 10 步；真机（Debian 13 / Docker 29.8.2）实测全绿；`MALL_DIR` 程序与数据分离 |
| 10 | 版本化迁移、只允许向前兼容增量；数据卷独立于程序目录 | **符合** | `pnpm check:migrations` → PASS（20 个迁移无破坏性变更）；CLAUDE.md 中 P0 禁令 |
| 11 | 框架可便捷升级：lockfile + 统一版本目录 + 适配层 | **符合** | `pnpm-workspace.yaml` 的 `catalog:` 统一版本目录；根 `package.json` 无直接依赖版本漂移 |
| 12 | AI 走统一接入层（LangChain.js + pgvector，厂商可切换） | **缺失（二期）** | 全仓无 `langchain` / `pgvector` / `embedding` 命中 —— 属二期第 7–10 周范围，**当前不做** |
| 13 | 前台不写业务逻辑，只通过标准 API 取数 | **符合** | storefront 仅依赖 `@mall/sdk`（+ `@mall/ui` / `@mall/design-tokens`），无业务模块依赖 |

**铁律结论**：13 条中 **9 条符合、3 条部分、1 条按计划缺失**。偏离集中在铁律 4（两种扩展机制）、铁律 5（S3/通知/搜索 provider）、铁律 6（对外 Webhook），均属**二期范围或可延后项**，但铁律 4 的两个机制是"扩展不改核心"的承诺基础，建议在一期收尾或二期初补齐。

---

## 三、一期 MVP 清单 × 现状

| 模块 | 状态 | 备注 |
|---|---|---|
| Product（属性建模） | 完成 | 符合铁律 8 |
| Pricing（按币种/Channel，不做自动汇率） | 完成 | |
| Region + Channel | 完成 | |
| Cart | 完成 | |
| Order（含退款状态机） | 完成 | 状态机 + 退款已跑通 |
| Inventory（量与预留分离、多仓、分配策略） | 完成 | 预留分离已验证（94/5/89 三态） |
| Fulfillment（zone / 运费方案 / 承运商 Provider） | 完成 | |
| Tax（税区/税率/含税价，预留 Provider） | 完成 | 一期扁平税率 |
| Customer | 完成 | |
| Auth | 完成 | 含管理员改密端点（Phase 4 补强） |
| Event Bus | 完成 | 含 outbox |
| File（本地开箱可用） | 完成 | S3 为二期可选增强 |
| 响应式店面（移动优先） | 完成 | Next.js App Router |
| 管理后台基础 | 完成 | React + 自建 `@mall/ui` |
| Installer 一键安装 | 完成 | 真机 10 步全绿 |
| 换肤地基（设计变量集中 + 后台可调） | 完成 | `theme` 模块 + `@mall/design-tokens` |
| **Payment 四个 Provider** | **未达标** | 微信 49 / 支付宝 43 / Stripe 43 / PayPal 46 行 —— 属**薄实现**：接口已填充、参数组装基本可用，但未达简报要求的"**沙箱/测试模式联调通过**"标准（缺 webhook 验签、退款对账、Stripe 的 Apple Pay/Google Pay/Klarna 渠道、幂等与重放防护等） |

**一期结论**：除支付 Provider 深度外，一期清单已全部落地并真机验证。按简报第 57 行的完成标志（"干净机器一条命令安装 + 上架→下单→付款→发货双端全程跑通"），**当前唯一缺口是"付款"这一步走的仍是 fake provider**，故一期尚未正式验收通过。

---

## 四、二期 / 三期状态

| 期 | 项目 | 状态 |
|---|---|---|
| 二期 | Promotion 三件套 + Gift Card | 未开始 |
| 二期 | 多仓履约深化 + 税务深化 | 未开始 |
| 二期 | Search（Meilisearch/Algolia）+ Translation 全量 | 未开始 |
| 二期 | CMS/博客 + 拖拽装修编辑器（PC/H5 双预览） | 未开始 |
| 二期 | Notification + 对外 Webhook + API Key/Sales Channel | 未开始 |
| 二期 | 多市场扩张 + B2B 基础 + 按 Channel 启停支付 | 未开始 |
| 二期 | AI Gateway + AI Support 基础版 | 未开始 |
| 二期 | System Update 后台一键升级 | 未开始 |
| 三期 | Loyalty + Store Credit / B2B 完整 / AI Support Plus / Digital Products / Subscription / 插件市场 | 未开始 |

---

## 五、已识别的两处「与蓝图不一致」，需产品决策

### 1. 组件库：简报要求 shadcn/ui —— **已按用户决策迁移（2026-11-09）**

- 简报第 69 行：「组件库：shadcn/ui + Tailwind CSS——前台与管理后台共用一套设计语言」
- **决策**：用户明确要求「必须迁 shadcn/ui」，已执行完毕（详见 `docs/decisions/ADR-011.md`）
- **迁移形态**：采用 shadcn/ui 的**实现体系** —— Radix primitives + `class-variance-authority` + `tailwind-merge` + CSS 变量语义；组件源码存放于 `@mall/ui` 供前后台共用
- **有意保留**：不采用 shadcn 默认皮肤（配色走 `@mall/design-tokens`）；`Button` 等对外 API 与尺寸（32/44/52px）不变；`Skeleton` 继续用带 300ms 延迟的 `.skeleton` 类（shadcn 的 `animate-pulse` 是降级）
- **实际收益**：后台自写的 `focus-modal.tsx` / `sheet.tsx` 已删除并收编为 `Dialog` / `Sheet`（补上焦点陷阱）；设置页手写 tablist 换成 `Tabs`（补方向键导航与 `aria-controls`）；`field.tsx` 底层换 `Input`/`Select`/`Textarea` + `Label`
- **遗留项（已登记 ADR-011，不要当作已解决）**：`CartDrawer` 仍依赖 `@mall/ui` 内部 `Button`（容器带移动端定制，未硬换）；彻底解耦需 headless + 插槽，留待模板系统阶段。Radix 使 admin bundle 增长至 459 kB（gzip 145 kB），前台引入需关注 LCP 预算

### 2. 支付 Provider 深度不足（一期唯一硬缺口）

- 简报第 28 行要求「一期交付四个 Provider……全部先用沙箱/测试模式联调，部署方有商户号后在后台填密钥启用」
- 现状：四个 Provider 均为 43–49 行的薄实现
- 阻塞点：**需要沙箱/测试凭据才能真联调**
  - Stripe / PayPal：可自助注册测试账号，无障碍
  - 微信支付 / 支付宝：需要商户号或官方沙箱环境（支付宝沙箱可自助开通；微信支付沙箱需商户号）

---

## 六、开发纪律（本次定案，每次开工前对照）

1. **一次只做当前一步**：按简报第九节的顺序推进，验收通过再做下一步。
2. **不跨期抢跑**：一期未验收通过，不开二期功能代码（除铁律 4 的两个扩展机制可提前补）。
3. **改动前置闸门**：任何一步若需改动已定的数据模型或架构铁律，**先停下来评估并记录 ADR**，不要让后续步骤建立在未验收的地基上。
4. **每步完成的定义**：代码 + 迁移（如需）+ 单测 + typecheck + 真机验证 + 文档同步，缺一不算完成。
5. **参考仓库的使用方式**：先看参考仓库的数据模型与接口划分，再用 TypeScript 按铁律重写；**学结构，不逐行翻译**；取用代码必须登记来源。
6. **结算口径**：新增能力必须同时更新本文档第二/三节的核对表，保持"蓝图 ↔ 实现"可追溯。
7. **任务完成度纪律（2026-11-09 补定，因实际踩坑）**：
   - **一件事做到 100% 再开下一件**。并行的前提是"两件事都已经各自闭环"，而不是"两件事都刚开头"。同时开两条未完成的工作线，结果必然是两条都是半截，使用者无法判断哪个能用。
   - **"完成"的判据不是"代码写完了"**，而是：门禁全绿（typecheck / test / build / 图标扫描）+ 该删的死代码已删 + 文档已同步 + 验收证据可复现。
   - **分阶段实施时，阶段之间不允许对外宣布"已完成"**——只有全部阶段走完才算。中间态只能描述为"进行到第 N/M 阶段"。
   - **中断交接必须报状态**：任何成员在任务中断时（网络、超时、被叫停），必须报告"已完成到哪个文件、哪一步、哪些是半成品"。接手方**必须核实磁盘实际状态**后才能继续，不得假设。
   - **半成品的中间态比未开工更危险**：例如"initiate 已真实化但 capture 还是假的"会造成"看起来接了支付、实际只接了一半"的错觉。因此宁可一个字不动，也不要留下这种状态。

---

## 七、下一步（严格按简报口径，等你点单）

一期收尾只剩一项：**把四个支付 Provider 从薄实现加深到"沙箱可联调"**。

建议的验收顺序（与简报第 57 行一致）：
1. Stripe 与 PayPal（可自助拿测试号，先打通，能自证 Provider 接口正确）
2. 支付宝沙箱（可自助开通）
3. 微信支付（需商户号，最后做；无商户号时以"接口就绪 + 沙箱文档就绪"结项，不阻塞上线）
4. 四家都完成后，重跑一期验收：干净机器一条命令安装 → 上架 → 下单 → **真实沙箱付款** → 发货，双端跑通

之后再按简报第 59 行进入二期第一项（Promotion 三件套 + Gift Card）。
