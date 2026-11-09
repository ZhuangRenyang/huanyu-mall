# Spec - 全球商城（Global Commerce） v1.0

> 生成日期：2026-11-08
> 基于：PRD v1.0（docs/01-prd/PRD.md） + 架构文档 v1.0（docs/02-architecture/ARCHITECTURE.md + ADR-001~010） + UIUX v1.0（docs/03-uiux/UIUX.md + design-tokens）
> 状态：已确认（Phase 1 用户已拍板全部分叉点）
> 本文档是规格契约：后续设计细化、开发、测试均以本文档为唯一依据。变更走「小改/大改」流程。

---

## 1. 产品定义

- **一句话描述**：一个可对外交付的**单商户跨境商城产品**（自托管、零抽佣、数据自主、一条命令安装），非给自己开一家店。
- **目标用户**：被 SaaS 抽佣磨到临界点的跨境卖家 / 国内 DTC 品牌卖家 / 建站服务商与独立开发者 / 有 TS 能力的技术型创业者（详见 PRD 画像 P1–P4）。
- **核心问题**：市面上不存在「开箱即用的自托管商城」——SaaS 解决装不起来但抽佣+数据托管+定价惩罚成功；开源自托管解决所有权但交付物是半成品。中间这条缝是本项目的位置。

## 2. MVP 范围（锁定——不在此列表的功能一律不做）

| 优先级 | 模块 / 交付物 | 验收标准摘要 | RICE |
|--------|------|-------------|------|
| P0 | Installer 一键安装（M16） | Ubuntu 22.04/24.04 干净机器 1 条命令装完并健康检查通过 | 5.00 |
| P0 | 响应式店面（M14） | 一套代码覆盖 PC + H5，13 页，移动优先结账 | 3.00 |
| P0 | 换肤地基 / Theme（M17） | 设计变量集中管理 + 后台可调，改外观不改代码 | 2.67 |
| P0 | 交易闭环四件套（M04 Cart / M05 Order / M06 Payment / M08 Fulfillment） | 上架→下单→付款→发货端到端跑通 | 3.75~4.00 |
| P0 | 版本化增量迁移纪律（M12 + 内核 db） | 迁移只增不删，CI AST lint 拦截破坏性变更 | — |
| P1 | Auth（M11） | 邮箱密码 + JWT + refresh 轮换 + 游客下单兜底 | 7.50 |
| P1 | Customer（M10） | 客户档案 + 地址簿；手机号仅软标识 | 6.67 |
| P1 | File（M13） | 本地存储 + 魔数白名单校验 + 图片派生（原图+webp） | 6.67 |
| P1 | Pricing（M02） | 按币种×Channel 定价，无汇率换算 | 5.00 |
| P1 | Region + Channel（M03） | 一期播 1 个 Channel（CN/CNY），模型保留多 Channel 能力 | 4.00 |
| P1 | Product（M01） | product type + attributes + variants 分离建模 | 3.75 |
| P1 | Inventory（M07） | 库存量 + 预留分离，保留 warehouse 维度但只启用 1 仓 | 3.00 |
| P1 | Tax（M09） | Channel 级单一扁平税率 + 含税价 + 快照冻结 | 2.00 |
| P1 | Event Bus（M12） | 进程内 EventBus + outbox + BullMQ（禁 in-memory） | 5.00 |
| P1 | 管理后台（M15） | 商品/订单/客户/设置四块 + 设计变量入口 | 3.75 |
| P1 | 可嵌入组件（M18） | 购物车抽屉/商品画廊/规格选择器，只接 props | 1.33 |

> 模块口径：14 个后端模块（`packages/modules/*`）+ 4 个非运行时交付物（M14 店面 / M15 后台 / M16 安装器 / M18 可嵌入组件）= 18 个 PRD 编号。详见架构 §8.1「模块口径澄清」。

## 3. 明确不做（Out-of-Scope — 锁定）

> 每条带原因，开发中有人提出这些功能直接拒绝。完整 28 条见 PRD §6「明确不做」。

| 不做的功能 | 原因 | 何时考虑 |
|------------|------|----------|
| 多商户 / Marketplace | 宪章级定案，数据模型无商户维度 | 永不 |
| 原生 App / 上架应用商店 | 全周期只做 Web（PC + H5） | 永不 |
| 微信小程序 / 公众号商城等非 Web 平台 | 全周期只做 Web 端，小程序非 Web 平台（用户已确认不做） | 永不 |
| 短信验证码 / 短信服务商 | 违反「必填配置恒为 0」；手机号仅软标识 | 二期（后台配置化后） |
| 电子发票开具 | 依赖第三方开票平台，破 0 配置 | 二期，一期写免责提示 |
| 物流承运商 API 轨迹同步 | 一期手工填快递公司+单号 | 二期 |
| 外部税计算 Provider | 一期扁平税率足够 | 二期（欧盟 VAT 等） |
| S3/对象存储真实接入 | 一期本地存储，S3 只留接口+后台配置 | 二期（填账号即启用） |
| 多语言全量翻译 | 一期只播 zh-CN | 二期 |
| 拖拽装修编辑器 / CMS / 多模板 | 简报明列二期 | 二期 |
| Search 接 Meilisearch | 一期 PG 内置搜索兜底 | 二期 |
| Promotion / 优惠券 / 积分 / 分销 | 简报明列二期 | 二期 |
| 部分退款 / 退货 | 一期只开全额退款；状态机完整做 | 二期（视客群退货特征） |
| 多仓履约 / 跨仓调拨 | 一期单仓，保留 warehouse 维度 | 二期 |
| AI Gateway / AI 客服 | 简报明列二期 | 二期 |

## 4. 技术架构（锁定 — 含版本锚定）

> 版本为架构师 Phase 1 联网实测结果，开发启动日再核对一次，只允许向上取同 major 补丁版。

| 层 | 技术 | 锁定版本 | 锁定原因 |
|----|------|----------|----------|
| 运行时 | Node.js | 26.13.0（LTS Lithium） | v24 已转 maintenance |
| 语言 | TypeScript | 7.0.2（可回退 5.9.x） | 生态兼容 POC 先行 |
| 后端框架 | Fastify | 5.12.8 | API 进程 HTTP 层 |
| 前台 | Next.js + React + Tailwind | 16.4.5 / 19.3.1 / 4.3.5 | 店面，一套代码双端 |
| 后台 | React + Vite | 19.3.1 | Medusa Admin 形态 |
| ORM | Drizzle | 0.45.4（禁 1.0 RC） | SQL-first，迁移唯一事实 |
| 数据库 | PostgreSQL | 18.6 | Medusa 原生库 |
| 缓存/队列 | Redis + BullMQ | 8.10.3 / 6.7.2 | 缓存 + 事件总线 + worker |
| 校验 | Zod | 4.6.7 | 请求校验 + OpenAPI 唯一来源 |
| 图标库 | lucide-react | 1.70.0 | 全项目唯一图标库 |
| Monorepo | pnpm + turbo | 12.18.0 / 2.11.10 | 依赖单点锁定 + catalog |
| 认证 | JWT 15min + refresh 轮换 + Redis 黑名单 | — | 可撤销 + 零配置 |
| 部署 | Docker Compose | Ubuntu 22.04/24.04 LTS | 一键安装 |

**架构铁律 13 条**（详见架构 §1.2，全部落地）：模块化单体 / 模块间无外键走 links / 跨模块只走 Workflow+compensation / 扩展只走 Module·Workflow Hook·Subscriber·Plugin / Provider 化 / 事件两层 / Region+Channel 主轴 / 商品建模 / 一键安装 / 版本化迁移 / 升级适配层 / AI 统一接入 / 前台后端解耦。

**关键技术决策（ADR-001~010）**：自研 Module Registry（DI）/ 自研顺序步骤 Workflow 引擎 + 补偿栈 + journal + 重放 / links 中间表 + 声明式 registry / 进程内 EventBus + outbox + BullMQ / Drizzle / pnpm+turbo+catalog / JWT 轮换 / Provider 插件包声明 + DB 存加密配置 + 按 Channel 启用 / 迁移 CI AST lint 禁破坏性 / lucide-react。

## 5. API 端点清单（锁定——开发唯一依据）

> 完整 OpenAPI 3.0 由 `packages/types` 的 Zod schema 生成（架构 §7.8），Phase 2 产出 `openapi.yaml`。

**Store API（17 个）**：
```
GET    /api/v1/store/bootstrap                       # channel、locale、币种、导航、设计变量
GET    /api/v1/store/products                        # 列表：q/category/attribute/sort/limit/offset
GET    /api/v1/store/products/{handle}               # 详情：变体+价格+图+属性+库存状态
GET    /api/v1/store/categories
POST   /api/v1/store/carts
GET    /api/v1/store/carts/{id}
POST   /api/v1/store/carts/{id}/line-items
PATCH  /api/v1/store/carts/{id}/line-items/{lineId}
DELETE /api/v1/store/carts/{id}/line-items/{lineId}
POST   /api/v1/store/carts/{id}/shipping-methods
GET    /api/v1/store/shipping-options?country=CN&cart_id=...
GET    /api/v1/store/payment-providers?cart_id=...
POST   /api/v1/store/payment-sessions
POST   /api/v1/store/payment-sessions/{id}/authorize  # 授权会话，创建 payment 记录
POST   /api/v1/store/payments/{id}/capture           # 扣款，幂等键必填
POST   /api/v1/store/carts/{id}/complete             # 幂等键必填，返回 order
GET    /api/v1/store/orders/{id}                     # customer 归属或游客 token
POST   /api/v1/store/webhooks/payment/{provider}     # 验签后入队，立即 200
POST   /api/v1/store/auth/{register|login|refresh|logout}
```

**Admin API（21 个，按 PRD 四块）**：
```
POST   /api/v1/admin/auth/login | refresh | logout
GET    /api/v1/admin/products                     POST /api/v1/admin/products
GET    /api/v1/admin/products/{id}                PATCH/DELETE /api/v1/admin/products/{id}
POST   /api/v1/admin/products/{id}/variants       PATCH /api/v1/admin/variants/{id}
PUT    /api/v1/admin/variants/{id}/prices
GET    /api/v1/admin/orders                       GET /api/v1/admin/orders/{id}
POST   /api/v1/admin/orders/{id}/cancel
POST   /api/v1/admin/orders/{id}/refunds          # 一期只全额
POST   /api/v1/admin/orders/{id}/fulfillments
POST   /api/v1/admin/fulfillments/{id}/shipments  # 手填承运商+单号
GET    /api/v1/admin/customers                    GET /api/v1/admin/customers/{id}
GET    /api/v1/admin/inventory-items              PUT /api/v1/admin/inventory-levels/{id}
GET    /api/v1/admin/settings                     PATCH /api/v1/admin/settings
PUT    /api/v1/admin/settings/theme               # 设计变量
PUT    /api/v1/admin/settings/payment-providers/{id}  # 填密钥并启用
POST   /api/v1/admin/files                        # 上传 multipart
```

**统一规范**：响应 `{code, data, message}`；分页 limit 默认 20/上限 100，offset 上限 10000；错误码规范见架构 §7.4；幂等键仅 POST 且有副作用端点（`Idempotency-Key: UUID v4`）。

## 6. 数据库表清单（锁定）

> 表前缀即模块私有；字段级 Schema 在 Phase 2 产出。核心字段见架构 §2 模块表。

| 模块 | 核心表 |
|------|--------|
| Product | product, product_variant, product_type, product_type_attribute, attribute, attribute_value, variant_attribute_value, product_image, product_category, product_category_link |
| Pricing | price_set, price, price_list, price_list_rule |
| Region+Channel | region, region_country, channel, channel_locale |
| Cart | cart, cart_line_item, cart_line_item_adjustment, cart_shipping_method |
| Order | order, order_line_item, order_item_snapshot, order_shipping_method, order_status_history |
| Payment | payment_collection, payment_session, payment, payment_transaction, refund, payment_provider_config, provider_webhook_event |
| Inventory | inventory_item, stock_location, inventory_level, reservation_item |
| Fulfillment | shipping_zone, shipping_option, shipping_option_price_rule, fulfillment, fulfillment_item, shipment |
| Tax | tax_rate, tax_rate_rule |
| Customer | customer, customer_address, customer_group |
| Auth | auth_identity, auth_credential, provider_identity, refresh_token, admin_user, rbac_role, rbac_user_role |
| Event Bus | event_outbox, subscriber_checkpoint, job_dead_letter |
| File | file, file_variant |
| Theme | theme_settings, theme_revision |

**links 关联表（13 张，跨模块关系唯一通道，禁外键）**：product_channel、variant_price_set、price_list_channel、inventory_item_variant、stock_location_channel、shipping_option_channel、payment_provider_channel、tax_rate_channel、order_payment_collection、order_fulfillment、cart_customer、order_customer、product_image_file。删除语义三选一（restrict/dismiss/cascade，见架构 §4.3）。

## 7. 页面清单（锁定）

> 路由结构 `/{locale}/{channel}/...`，一期 locale=zh-CN，channel=cn。

| 页面 | 路由 | 核心组件 | 对应 API | Token 主题 |
|------|------|----------|----------|------------|
| 首页 | / | 商品网格（非通用 Hero）、分类导航 | bootstrap + products | 品牌蓝 + 中性灰 |
| 商品列表 PLP | /products | 筛选、排序、热搜词、骨架屏 | products | 同上 |
| 商品详情 PDP | /products/{handle} | 商品画廊、规格选择器、加购 | products/{handle} | 同上 |
| 购物车 | /cart | 购物车抽屉、行编辑 | carts/{id} | 同上 |
| 结账 | /checkout | 4 步：联系方式/地址/配送/支付+确认 | shipping-options, payment-providers, complete | 移动优先 |
| 支付结果 | /checkout/result | 结果态、可重入 | orders/{id} | 语义色 |
| 订单查询 | /orders | 订单列表 + 详情 | orders/{id} | 同上 |
| 账户 | /account | 登录/注册、地址簿 | auth, customer | 同上 |
| 404 | * | 空态 + 二次转化位 | — | 同上 |
| 后台登录 | /admin/login | 登录表单 | admin/auth/login | 后台主题 |
| 商品管理 | /admin/products | 商品/变体/定价 CRUD | admin/products/* | 后台主题 |
| 订单管理 | /admin/orders | 订单列表、发货、退款 | admin/orders/* | 后台主题 |
| 设置 | /admin/settings | 设计变量、支付 Provider 配置 | admin/settings/* | 后台主题 |

## 8. 设计 Token（锁定）

> 权威来源 `docs/03-uiux/design-tokens.json` + `.css`，前端 import 引用，禁硬编码（仅 #fff/#000 例外）。

- **品牌色（活力信任蓝）**：primary `#1666D9`（白字 5.33:1 AA，hover #1454B4，active #124594）；gradient `#5B8DEF`（蓝系渐变，禁与紫粉组合）
- **辅助色**：accent-orange `#FF6B35`（仅非文本：徽章/圆点/图标/装饰）；促销价文字用深档 `#C2410C`（白底 4.96:1）
- **中性灰阶**：微冷 hue 265，#FAFAFB 底 / #17171B 主文本 / #71717F 次级文本
- **字体**：拉丁 Archivo + 中文 Noto Sans SC，字号成阶（以 design-tokens.css 的 `--font-family-sans` 为真源）
- **图标库**：Lucide（lucide-react 1.70.0），尺寸 16/20/24px 三档
- **主题**：浅色；对标 Vercel Commerce（骨架）+ Saleor storefront（交易细节）+ Medusa Admin（后台形态）
- **动效**：150–300ms，禁弹跳缓动 `cubic-bezier(0.68,-0.55,0.265,1.55)`

## 9. 验收标准（锁定——QA 唯一依据，EARS 格式）

| 编号 | 功能 | EARS 验收标准 | 优先级 |
|------|------|--------------|--------|
| AC-01 | 一键安装 | While 在 Ubuntu 22.04/24.04 干净机器执行 1 条 install 命令，系统**必须**自动完成 compose 拉起 + 迁移 + 建管理员 + 健康检查，打印访问地址与初始密码 | P0 |
| AC-02 | 商品上架 | While 管理员通过 Admin API 创建商品（type+attribute+variant+定价+库存），系统**必须**返回 201 且商品可被 Store API 检索 | P0 |
| AC-03 | 商品浏览 | When 用户访问 /store/products，系统**必须**返回 channel 可售商品列表（含变体价格与库存状态，variant 级） | P0 |
| AC-04 | 加购 | When 用户 POST carts/{id}/line-items，系统**必须**校验变体可售与库存可用量并更新购物车金额 | P0 |
| AC-05 | 下单+补偿 | When 用户 complete cart，系统**必须**经 workflow 创建订单 + 预留库存；If 任一步失败，系统**必须**执行 compensation 回滚到基线 | P0 |
| AC-06 | 支付回调 | When 支付 Provider 回调到达，系统**必须**验签（失败 401 不落库）+ 幂等去重 + 更新支付与订单状态 | P0 |
| AC-07 | 发货 | When 管理员创建 fulfillment + shipment（手填承运商+单号），系统**必须**将库存预留 commit 为出库 | P0 |
| AC-08 | 全额退款 | When 管理员发起全额退款，系统**必须**走退款状态机并回调支付 Provider 退款接口 | P0 |
| AC-09 | 游客下单 | While 用户未注册，系统**必须**支持游客下单，手机号仅软标识（不校验） | P0 |
| AC-10 | 性能预算 | While 真实移动网络下访问首页/商品页/结账页，LCP **必须** < 2.5s，CLS < 0.1 | P0 |
| AC-11 | 迁移纪律 | While 提交任何迁移，CI **必须**经 AST lint 拦截删表/删列/改类型等破坏性变更 | P0 |
| AC-12 | 图标合规 | While 扫描前端产物，系统**必须**检测到 0 个 emoji 功能图标、0 个非 lucide 图标 | P0 |
| AC-13 | 换肤 | When 管理员在后台修改设计变量（主色等），店面**必须**在代码不变的情况下外观改变 | P1 |
| AC-14 | 账户 | While 用户注册/登录，系统**必须**返回 JWT（15min）+ refresh token，refresh 轮换且并发单飞 | P1 |

## 10. 边界与约束

- 不支持 IE；响应式断点由设计 Token 定义（移动优先）
- 一期只承诺 **x86_64**（ARM64 未验证，见 R11）
- 支付一期按**沙箱/仿真**验收，真实资金联调为上线前置（依赖商户资质）
- 一键安装**命令恒为 1 条、必填配置恒为 0**（服务商类能力一律后台配置化，一期不接真实服务商，支付四家沙箱除外）
- 数据独立：`data/`（uploads/runtime/backup）为独立数据卷，程序替换不动数据

## 11. 内嵌已知坑（从架构 §16 拉取，写成硬约束）

| # | 坑 | 硬约束 |
|---|----|--------|
| 1 | 金额浮点误差 | 全链路 `amount_minor: bigint`，换算只在 core/money 用 ISO 4217 exponent 表，禁 parseFloat |
| 2 | 时区错 8 小时 | 全链路 timestamptz + UTC，渲染层才转 locale |
| 3 | PgBouncer prepared statement 冲突 | 连接池统一走 core/db，禁业务自建 pg.Pool |
| 4 | 软删+唯一索引冲突 | 唯一索引带 `WHERE deleted_at IS NULL` 部分索引 |
| 5 | in-memory 丢在途流程 | event bus / workflow journal / 队列必须落 Redis/Postgres，一期禁 in-memory |
| 6 | ARM64 迁移挂起 | 迁移双架构冒烟，否则明示仅 x86_64 |
| 7 | Tailwind v4 无 config | 走 CSS @theme 变量 + design-tokens，禁建 tailwind.config.js |
| 8 | 支付回调不验签丢钱 | 验签失败 401 不落库 + provider_webhook_event 去重 + 幂等 + 人工补单入口 |
| 9 | 未翻译 key 回显 | i18n fallback 链 zh-CN→默认→key，禁显示 key.not.found |
| 10 | 上传文件伪造 | content-type + 魔数双校验，白名单 jpg/png/webp/avif/gif，随机文件名 |
| 11 | 支付金额单位各异 | 只在 Provider 边界转换，业务层只见 bigint |
| 12 | Next.js 16 动态参数是 Promise | params/searchParams 一律 await |
| 13 | refresh token 并发竞态 | 轮换 + 单飞，旧 token 入 Redis 黑名单 |
| 14 | TS 7 生态兼容 | POC 先行，不通过回退 5.9.x |
| 15 | 幂等键过期重放 | 保留 ≥ 网关幂等窗口，清理前确认无在途 workflow |

## 12. 端到端验证步骤

```bash
# 1. 一条命令安装（无 Docker 环境用 --dry-run 验证脚本逻辑）
curl -fsSL https://get.example.com/install.sh | bash
# 期望：10 步全绿，打印管理员标识 + 初始密码 + 访问地址（默认 admin / 123456）

# 2. 健康检查
curl -s http://localhost/api/v1/health
# 期望：db=ok, redis=ok, queue=ok, migrations=<latest>, disk=ok

# 3. 建可卖商品（admin login → 建 product type + attribute + product + variant + 定价 + 库存）

# 4. 店面下单（FakePaymentProvider 兜底，无商户号也能跑）
# 首页看到商品 → 加购 → 结账（4 步）→ 支付会话 → 模拟回调 → 订单 created + 库存预留

# 5. 后台发货 → 库存预留 commit → 订单 delivered

# 6. 关键错误流：重复支付回调 → 幂等不重复扣款；下单中途失败 → compensation 回滚库存
```

## 13. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-11-08 | 初版生成 | Phase 1 三文档已确认，进 Phase 1.5 | 全量 |

---

> 变更流程：小改（不新增 API/表、不影响 >2 页面、不改核心流程）→ 更新本表继续开发；大改 → 回 Phase 0 重走需求澄清。开发中发现 Spec 未覆盖的需求，一律走变更流程，禁止私自加功能。
