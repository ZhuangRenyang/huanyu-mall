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
| **Payment Provider** | **支付宝 / PayPal 达标**，微信 / Stripe 未达标 | 支付宝（RSA2 签名 + 回调验签 + 当面付/跳收银台 + 部分退款 + out_request_no 幂等）、PayPal（Orders v2 + Payments v2 + OAuth2 缓存 + 官方 webhook 验签 + 部分退款 + 幂等透传）均**真实对接且沙箱端到端跑通**；微信 / Stripe 仍是 `SandboxPaymentProvider` 薄实现 |
| **店面端结账链路** | **完成（live 模式）** | 原本结账 100% 是 mock（购物车在 sessionStorage、支付方式硬编码 `wechat` 这个后端不存在的标识）。现已接真实后端：加购同步后端 cart、运费/支付方式取自后端、提交走 `setShippingMethod → completeCart → createPaymentSession`、新增支付页渲染二维码并轮询订单状态。mock/live 双模式并存 |

**一期结论**：一期清单已全部落地并真机验证。**收真钱的代码链路已全线打通**（店面 → 后端 → 支付商 → webhook → 订单转 paid → 结果页）。

当前缺口已从"代码"转为"**资质与部署**"：

1. **沙箱环境不产生真实资金流动**（平台设计）。要收真钱必须拿到生产资质——
   支付宝个人账号即可（营业执照选填，网站未上线可传 demo 截图拿 30 天开发试用期），
   PayPal 必须 Business account，微信最低个体工商户。详见
   [`docs/05-delivery/真金白银收款资质与上线路径.md`](./05-delivery/真金白银收款资质与上线路径.md)。
2. **店面必须切 live 模式**（`NEXT_PUBLIC_API_MODE=live` + 重新 build 镜像），
   否则顾客点「去支付」只是本地造假订单。这是构建期注入，最易漏。
3. **生产回调地址必须固定**（现为临时隧道），且需固定域名 + HTTPS + ICP 备案。
4. 微信 / Stripe 的 Provider 实现仍待补（微信需商户号，Stripe 需境外主体）。

---

## 四、二期 / 三期状态

> **2026-11-11 范围收敛（ADR-014）**：不再按 CRMEB / 电商大盘的功能清单铺开。
> 准入三问：商家每周会用吗？三步内能完成吗？不做会丢单或违规吗？缺一不做。

| 期 | 项目 | 状态 |
|---|---|---|
| 二期 | Promotion 三件套 + Gift Card | ✅ 已完成（2026-11-10） |
| 二期 | 多仓履约深化 | ✅ 已完成（ADR-013：优先单仓、不够才拆） |
| 二期 | 税务深化（K3） | ✅ 已完成（ADR-018：按收货国家解析 + 后台可切换，默认关闭） |
| 二期 | 订单通知（邮件） | 待做 —— **保留**（下单/发货通知是基础体验） |
| 二期 | System Update 后台一键升级 | ✅ 已完成（ADR-017：宿主代理 + 更新源 + 自动回滚） |
| 二期 | Search（Meilisearch/Algolia） | 按需 —— 商品数 < 200 用 PostgreSQL，不引入搜索引擎 |
| 二期 | Translation 全量 | ❌ 暂缓（单市场单语言） |
| 二期 | CMS/博客 + 拖拽装修编辑器 | ❌ 不做（ADR-014；一套模板 + 设计变量够用） |
| 二期 | Notification + 对外 Webhook + API Key/Sales Channel | ❌ 暂缓（没有外部系统要对接） |
| 二期 | 多市场扩张 + B2B 基础 + 按 Channel 启停支付 | ❌ 暂缓（单商户单市场） |
| 二期 | AI Gateway + AI Support 基础版 | ❌ 不做（ADR-014） |
| 三期 | Loyalty + Store Credit / B2B 完整 / AI Support Plus / Digital Products / Subscription / 插件市场 | ❌ 不做（ADR-014） |
| — | 秒杀 / 拼团 / 砍价 / 分销 / 积分 / 签到 / 直播 / 抽奖 | ❌ **永久不做**（ADR-014） |

---

## 五、已识别的两处「与蓝图不一致」，需产品决策

### 1. 组件库：简报要求 shadcn/ui —— **已按用户决策迁移（2026-11-09）**

- 简报第 69 行：「组件库：shadcn/ui + Tailwind CSS——前台与管理后台共用一套设计语言」
- **决策**：用户明确要求「必须迁 shadcn/ui」，已执行完毕（详见 `docs/decisions/ADR-011.md`）
- **迁移形态**：采用 shadcn/ui 的**实现体系** —— Radix primitives + `class-variance-authority` + `tailwind-merge` + CSS 变量语义；组件源码存放于 `@mall/ui` 供前后台共用
- **有意保留**：不采用 shadcn 默认皮肤（配色走 `@mall/design-tokens`）；`Button` 等对外 API 与尺寸（32/44/52px）不变；`Skeleton` 继续用带 300ms 延迟的 `.skeleton` 类（shadcn 的 `animate-pulse` 是降级）
- **实际收益**：后台自写的 `focus-modal.tsx` / `sheet.tsx` 已删除并收编为 `Dialog` / `Sheet`（补上焦点陷阱）；设置页手写 tablist 换成 `Tabs`（补方向键导航与 `aria-controls`）；`field.tsx` 底层换 `Input`/`Select`/`Textarea` + `Label`
- **遗留项（已登记 ADR-011，不要当作已解决）**：`CartDrawer` 仍依赖 `@mall/ui` 内部 `Button`（容器带移动端定制，未硬换 —— Radix 的 `forceMount` 会对整页加 `aria-hidden`，不可用）；彻底解耦需 headless + 插槽，留待模板系统阶段。Radix 使 admin bundle 增长至 459 kB（gzip 145 kB），前台引入需关注 LCP 预算
- **配套门禁**（没有这三项，"迁移完成"只是口头结论）：`@mall/ui` 的 jsdom 测试（35 用例，覆盖焦点移入 / Escape / aria 关联）、Token 纪律测试（禁硬编码颜色与自造 z-index）、计算样式级视觉快照（`pnpm exec tsx packages/ui/scripts/visual-snapshot.ts`，16 个表面 / 0 条未登记差异）

### 2. 支付 Provider 深度不足 → 已收敛为「资质 + 部署」缺口

- 简报第 28 行要求「一期交付四个 Provider……全部先用沙箱/测试模式联调，部署方有商户号后在后台填密钥启用」
- 现状（2026-11-10 更新）：
  - **支付宝 ✅**：真实对接 + 沙箱端到端跑通（RSA2 签名、回调验签、当面付 precreate、跳收银台 page.pay、部分退款、out_request_no 幂等）
  - **PayPal ✅**：真实对接 + 沙箱端到端跑通（Orders v2、Payments v2、OAuth2 token 缓存、官方 `verify-webhook-signature`、部分退款、幂等透传）
  - **微信 ⏳**：仍是 `SandboxPaymentProvider` 薄实现。微信支付 V3 沙箱已停服，真实联调需商户号（最低个体工商户）。按简报「无商户不阻塞上线」结项。
  - **Stripe ⏳**：仍是薄实现，需境外主体。测试密钥可自助获取，无阻塞。
- **剩余缺口不是代码，是资质与部署**：
  1. 各平台生产资质（详见 `docs/05-delivery/真金白银收款资质与上线路径.md`）
  2. 店面切 live 模式（构建期注入，最易漏）
  3. 固定公网回调地址（现为临时隧道）+ 域名 HTTPS + ICP 备案

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

**代码侧收款链路已全线打通**（店面 live 模式 → 后端 → 支付商 → webhook → 订单转 paid → 结果页），
支付宝与 PayPal 的沙箱端到端均已验证。

接下来的顺序（**不再是"写代码"，而是"拿资质 + 切生产"**）：

1. **【要你决策】资质路线** —— 建议先办个体工商户执照（一张纸同时解锁支付宝不限额 + 微信准入 + PayPal 企业账号）。
   支付宝可**现在就去开放平台创建「网页应用」**：网站未上线就传 3 张 demo 截图拿 **30 天开发试用期**，
   这期间就能用小额真单跑通全链路。
2. **【要你决策】固定公网回调地址** —— 现为 cloudflared 临时隧道，会断；生产需固定域名 + HTTPS + ICP 备案
   （「电脑网站支付」的网站链接必须已备案）。
3. **切生产** —— 按 `docs/05-delivery/真金白银收款资质与上线路径.md` 的命令切 provider 配置
   （`mode=live`，不改代码、不重新部署）+ 切店面 live 模式（**需重新 build 镜像**）。
4. **小额真单验收** —— 页面显示金额 == 实际扣款金额；回调可达；重复回调不重复扣款；退款能退。
5. 之后再按简报第 59 行进入二期第一项（Promotion 三件套 + Gift Card）。
6. 微信 / Stripe Provider 的真实实现可并行推进（微信需商户号，Stripe 需境外主体，均不阻塞前面几步）。
