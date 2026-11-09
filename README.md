# 全球商城 · Global Commerce

> 可对外交付的**单商户跨境商城**产品：自托管、零抽佣、数据自主、**一条命令装完**。
> TypeScript 全栈 · 模块化单体（Medusa 式严格自研）· 一套响应式代码覆盖 PC + 移动 H5

[![验收状态](https://img.shields.io/badge/真机闭环-已通过-16a34a?style=flat-square)](#真机实测)

---

## 这是什么

不是「给自己开一家店」，而是一个**可以交付给别人的商城产品**：

- **自托管 + 零抽佣**：不按 GMV 收费，不锁定商家数据
- **架构自主**：模块化单体，模块间零外键、只走 links 关联层与工作流编排；框架升级只改适配层
- **可换肤**：设计变量集中在后台，改外观不动商品/订单数据；同一套代码可换多套店面模板
- **全球化主轴**：Region（区域/币种）→ Channel（市场/渠道/定价/库存/税/支付），一期先落中国大陆 + CNY，模型预留多市场
- **国际化优先**：文案与 slug 可翻译，输出 hreflang

**一期范围**：Product / Pricing / Region+Channel / Cart / Order（含退款状态机）/ Payment（四家 Provider）/ Inventory / Fulfillment / Tax / Customer / Auth / Event Bus / File / Theme / Installer + 响应式店面 + 管理后台。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 语言 / 运行时 | TypeScript 7 · Node.js 26 LTS |
| 后端 | Fastify 5 · 自研 Module Registry + Workflow 引擎 + links 关联层 |
| 数据库 | PostgreSQL 18 · Drizzle ORM · 版本化增量迁移（破坏性变更 CI 拦截） |
| 缓存 / 队列 | Redis 8.10 · BullMQ |
| 前台 | Next.js 16（App Router，`/{locale}/{channel}/`）· React 19 · Tailwind CSS 4 |
| 后台 | React 19 + Vite + shadcn/ui |
| 图标 | Lucide（`lucide-react`，全项目唯一一套，禁 emoji 图标） |
| 部署 | Docker Compose · 一键安装（Ubuntu 22/24 · Debian 13 实测通过） |

版本锚点见 `docs/04-specs/SPEC.md` §4；选型理由见 `docs/decisions/ADR-001~010`。

---

## 快速开始

```bash
# 一条命令安装（必填配置恒为 0，所有参数有默认值）
bash deploy/install.sh
```

安装 10 步：环境探测 → Docker 检查 → 目录准备 → 密钥生成 → 自动调参 → 拉起依赖 → 执行迁移 → 首次种子 → 拉起应用 → 健康检查。

- 店面 `http://<host>/`
- 后台 `http://<host>/admin/`（默认管理员 `admin` / `123456`，可用 `--admin-email` / `--admin-password` 自定义；**不强制改密**）
- 数据与程序隔离：程序在 `MALL_DIR/app`，数据在 `MALL_DIR/data`，**换程序不碰数据**

完整部署、备份、恢复、模式切换见 **`docs/05-delivery/部署与验收.md`**。

---

## 目录结构

```
apps/
├── api/           Fastify 5 · Store API + Admin API（41 端点）
├── worker/        BullMQ 消费者
├── storefront/    Next.js 16 店面（PC + H5 同一套代码）
└── admin/         React 19 + Vite 管理后台
packages/
├── core/          内核：容器 / Workflow 引擎 / links / 事件 / DB / 金额 / 日志
├── types/         跨端共享类型与 Zod schema
├── ui/            组件库 + 可嵌入组件（购物车抽屉 / 商品画廊 / 规格选择器）
├── design-tokens/ 设计变量单一事实来源
├── sdk/           API 类型 + 运行时客户端（店面与后台共用）
├── workflows/     跨模块流程（cart-complete / order-cancel）
├── links/         关联层声明与迁移
└── modules/       13 个业务模块（product / pricing / order / payment / …）
deploy/            compose / Dockerfile / install.sh / tuning / backup / healthcheck
docs/              PRD · 架构 · UIUX · Spec · OpenAPI · ADR · 部署验收
```

---

## 真机实测

在真实 Linux 机器（Debian 13 / 7.8 GiB / Docker 29.8.2）上完成：

```
一键安装 10 步全绿  →  上架 [通过]  下单 ¥20600 [通过]  付款 status=paid [通过]
发货 库存 98/0/98 [通过]  店面 live 真数据 [通过]  后台 live 真 API [通过]
加固验收 18/18  [通过]  备份恢复真机演练 [通过]  坏备份拦截且数据库无损 [通过]
typecheck 24/24   测试 159 用例全过   build 21/21
```

过程中暴露并修复了 **33 个只有真机才现形的问题**（含「后台空白页」「镜像构建失败」「pgbouncer 认证不通」「nginx 固化容器 IP 导致全站 502」「备份恢复假闭环会清库」「migrator 镜像漂移导致迁移没加载」等）。完整清单与修法见 **`docs/05-delivery/部署与验收.md`** §5。

### 运维工具（Phase 4 生产化加固）

```bash
bash deploy/scripts/doctor.sh            # 一键体检：容器/DB/Redis/队列/迁移/磁盘/密钥强度/备份有效性
bash deploy/scripts/backup.sh            # 备份（排除 .env 与 secrets.json，带 SHA256 校验）
bash deploy/scripts/restore.sh --list    # 列出可用备份；--backup <标签> --dry-run 看影响范围
bash deploy/scripts/setup-https.sh --domain D --email E   # Let's Encrypt 签发 + 自动续期
bash deploy/scripts/verify-hardening.sh  # 加固能力验收（限流/审计/安全头/请求体限制）
bash deploy/scripts/verify-change-password.sh   # 改密端点验收（错误路径→成功→会话失效→审计）
bash deploy/scripts/e2e-regression.sh    # 交易闭环 15 步回归
```

破坏性操作一律先打印影响范围再要求确认，且全部支持 `--dry-run`。详见 `docs/05-delivery/部署与验收.md` §7.6。

---

## 开发

```bash
pnpm install
pnpm -r typecheck        # 类型检查
pnpm -r test             # 单元 / 集成测试
pnpm turbo run build     # 全量构建
pnpm dev                 # 本地开发
```

**三条架构门禁**（提交前必过，脚本在 `scripts/`）：

```bash
pnpm check:module-graph   # 模块依赖无环、分层正确（禁跨模块乱引）
pnpm check:migrations     # 迁移无破坏性变更（删表/删列/改类型一律拦）
pnpm check:icons          # 无 emoji 图标、非 lucide 图标一律拦
```

**数据源双模式**（同一份代码）：店面 `NEXT_PUBLIC_API_MODE`、后台 `VITE_API_MODE`，取 `mock`（零依赖演示）或 `live`（打真实 API）。注意这两个变量**构建期内联**，必须在 `docker build` 时设置。

---

## 文档

| 文档 | 内容 |
|---|---|
| [PRD](docs/01-prd/PRD.md) | 需求、竞品实测、RICE 优先级、28 条明确不做 |
| [架构](docs/02-architecture/ARCHITECTURE.md) | 13 条铁律落地、模块边界、links、Workflow 引擎、性能、已知坑 |
| [UIUX](docs/03-uiux/UIUX.md) · [页面规格](docs/03-uiux/page-specs.md) | 设计系统、13 页逐页规格、活力信任蓝 Token |
| [Spec](docs/04-specs/SPEC.md) | 规格契约：范围 / API / 表 / 页面 / Token / EARS 验收 / 已知坑 |
| [OpenAPI](docs/04-specs/openapi.yaml) · [DB Schema](docs/04-specs/db-schema.md) | 41 端点契约、76 张表字段级定义 |
| [ADR-001~010](docs/decisions/) | 10 条架构决策记录（MADR） |
| [部署与验收](docs/05-delivery/部署与验收.md) | 真机实测结论、30 个问题的修法、运维手册、已知限制 |
