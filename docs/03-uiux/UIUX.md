# 商城 · UI/UX 设计规范（Phase 1）

> 设计师：颜好看 | 日期：2026-11-08 | 版本：v1.0
> 输入：`全球商城项目简报.md`（第十节 界面与体验规范 / 第十二节 模板可更换要点）、`docs/decisions/OPEN-DECISIONS.md`
> 配套产出：`design-tokens.json`（机器可读）、`design-tokens.css`（可直接 import）
> 三轴刻度：**DESIGN_VARIANCE = 6** / **MOTION_INTENSITY = 3** / **VISUAL_DENSITY = 3（店面）· 7（后台）**
> 寄存器判定：店面 = Brand 偏 Product（商品图是主角，UI 退让）；后台 = 纯 Product（熟悉感优先）
> 平台轴：responsive-web（PC + H5 同一套代码，移动优先），`/{locale}/{channel}/…` 路由

---

## 1. 设计方向声明

**把店面做成一本商品目录册，不是海报。UI 退成纸与墨：底色近白、正文墨灰，唯一彩色是品牌蓝 `#1666D9`——它只做按钮、链接与价格高亮；促销价与角标用活力橙 `#FF6B35`，每屏彩色 ≤3 处。节奏靠编辑式非对称网格与长留白，不靠插画与渐变堆砌。后台共用同一套变量，只收紧间距与圆角，密度 3→7。换一套 token 即换一个品牌。**

一句话区分其他模板：**竞品的差异在配色，本模板的差异在版式**——商品图按 4:5 裁切、网格用 `7fr 5fr` 非对称分割、价格用等宽数字右对齐成列。即使把主色换成任何颜色，这套骨架依然认得出来。

**明确不做什么**（防 AI 模板味）：
- 不做「大标题 + 副标题 + 居中 CTA + 抽象 3D 图形」的通用 Hero。首页第一屏直接是商品网格与当季分类入口。
- 不做整站橙色促销风（电商默认色 `#F97316` 铺满全屏）——橙色只作强调点缀，不作为主题色。也不做黑白极简风（已被 Saleor Paper 占据）。
- 不做紫色→粉色渐变、发光边框、毛玻璃三位一体。
- 不做 emoji 当图标、不做每节都挂一行小型大写 `ABOUT / PROCESS` 的编号标签。

---

## 2. 对标品牌：抄什么 / 不抄什么

| 对标源 | 具体抄什么（模式 / 结构） | 明确不抄什么 |
|---|---|---|
| **Vercel Commerce**<br>`vercel/commerce`（仓库已归档，迁移至 `vercel/shop`） | 抄它的 **Tailwind v4 CSS-first 组织方式**：没有 `tailwind.config.ts`，主题全在 `app/globals.css` 的 `@theme` 里；抄它把 `focus-visible:ring-2 + ring-offset` 写成 `a / input / button` 的**全局基线**而不是逐组件加；抄它用 `@plugin "@tailwindcss/container-queries"` 让**商品卡按卡片自身宽度响应**而不是按视口断点 | 不抄它的纯灰无品牌色（本项目必须有可换的主色）；不抄它的 shadcn 默认皮肤（会和一堆 AI 项目撞脸） |
| **Saleor Storefront（Paper）**<br>`saleor/storefront` | 抄它的 **token 组织**：`brand.css` 一个文件切成「颜色 / 字体 / 形状 / 容器宽度 / 固定栏高度 / 区块节奏 / 阴影 / 动效 / 骨架」九个注释分区；抄 `--radius` 派生 `--radius-button` `--radius-card` 的**一个值控全站圆角**；抄 `--container-prose/-content/-wide` 具名宽度替代 `max-w-7xl` 魔数；抄 `--header-height + --chrome-offset` 让吸顶计算只有一个来源；抄 `--skeleton-delay: 300ms`（**骨架屏延迟出现**，避免快网络闪一下）；抄 PDP 的 PPR 结构：静态壳里放标题/属性/JSON-LD，图库与规格选择走 Suspense 岛屿；抄路由级 `loading.tsx` 骨架 | 不抄它的纯黑白 primary（要可换肤）；不抄它的 Fraunces 编辑衬线可选主题（中文衬线在 16px 下可读性差） |
| **shadcn/ui** | 抄整套 **CSS 变量命名与语义配对**：`background/foreground`、`card/card-foreground`、`muted/muted-foreground`、`border/input/ring`、`sidebar-*`、`chart-*`；抄 `--radius` 用 `calc()` 派生 7 档；抄 `.dark` 覆盖同名 token 的做法；抄 `@theme inline` 只做引用不做值复制（否则 `.dark` 覆盖穿透不了） | **不抄它 `--accent` 的语义**——shadcn 的 `accent` 是「hover/选中面」。本项目品牌蓝是 `--primary`、橙色强调是 `--accent-orange`，都不占用 `--accent`（见 §13 已知坑） |
| **Medusa Admin / `@medusajs/ui`** | 抄它的**后台形态**：左侧可折叠 Sidebar + 页面级 `Container` 分块；抄组件选择——`Drawer` 做侧滑表单（新建商品不跳页）、`FocusModal` 做集中任务（批量改价）、`DataTable` 做列表（筛选/排序/分页内建）、`toast` 做操作反馈；抄它把商品与订单放在导航最前两位 | 不抄传统 ERP 密集表格风（简报点名禁止）；不抄它把 brand color 交给第三方预设 |
| **Shopify Dawn**（只参考模式） | 抄它的**购物车抽屉交互契约**：图标上 `role="button"` + `aria-haspopup="dialog"`；Esc 关闭；点遮罩关闭；**`transitionend` 之后才 trapFocus**（早一步焦点会跳）；`body.overflow-hidden`；关闭时把焦点**还给触发元素**；面板 `translateX(100%)` 滑入；桌面宽 40rem、`max-width: calc(100vw - 3rem)`；关闭按钮 `min-width/height: 4.4rem`（=44px）；遮罩 `rgba(fg, 0.5)` | 不搬 Liquid 架构、不搬它的 CSS 选择器命名、不抄它的圆角与配色 |

> 授权说明：Vercel Commerce（MIT）、Medusa（MIT）、Saleor（BSD-3）可参考代码；BeikeShop 为 OSL-3.0 且有附加条款，**本文件不引用其任何代码 / 样式 / 素材**，只作为功能摆设的对照清单。

---

## 3. 配色基调

**结构配比**：中性 86% / 品牌蓝 ≤8% / 强调橙 ≤4% / 语义色 ≤2%。**每屏彩色（`--primary` + `--accent-orange`）可见使用 ≤3 处。**

三色语义角色（用户定稿）：
| 色 | Token | 角色 | 禁止 |
|---|---|---|---|
| **活力信任蓝** `#1666D9` | `--primary` | 品牌主色：主按钮、链接、选中态、焦点环、当前步骤点 | 不用作大面积背景；不用作标题正文 |
| **渐变蓝** `#5B8DEF` | `--gradient` | 次级强调、渐变过渡（`linear-gradient(135deg, var(--primary), var(--gradient))`，蓝→蓝） | 严禁与紫/粉色组合成 Indigo→Pink；白字仅 3.23:1，只做装饰/大字，禁止正文 |
| **活力橙** `#FF6B35` | `--accent-orange` | 促销价（用深档 `--accent-orange-deep`）、徽章底、圆点、图标、次要 CTA 底 | 白底文字仅 2.83:1，**连大字都不达标** → 文字一律用深档；橙底配深色文字，禁止白字 |

### 3.1 中性阶（微冷，hue 265，chroma ≤0.008 — 刻意避开奶油/米色的 AI 味色带）

| Token | Hex | 角色 | 对比度校验 |
|---|---|---|---|
| `--neutral-0` | `#FFFFFF` | 卡片 / 抽屉 / 弹窗底 | — |
| `--neutral-25` | `#FAFAFB` | 页面底（`--background`） | — |
| `--neutral-50` | `#F4F4F6` | 次级面 / 表头 / hover 面（`--secondary` `--muted` `--accent`） | — |
| `--neutral-100` | `#E9E9ED` | 默认边框（`--border`） | — |
| `--neutral-200` | `#DADAE0` | 强边框 / 输入框（`--border-strong` `--input`） | — |
| `--neutral-300` | `#BEBEC7` | 禁用态文字、占位图标 | — |
| `--neutral-400` | `#9A9AA6` | 深色模式次级文本 | — |
| `--neutral-500` | `#71717F` | 次级文本（`--muted-foreground`） | on `#FAFAFB` = **4.60:1**（达标，这是下限，不得再浅） |
| `--neutral-600` | `#55555F` | 图标默认色 | on `#FAFAFB` = 7.5:1（达标） |
| `--neutral-700` | `#3D3D46` | 按钮 active 态 | — |
| `--neutral-800` | `#26262C` | 按钮 hover 态 | — |
| `--neutral-900` | `#17171B` | 主文本 + **主 CTA 底色**（`--foreground` `--primary`） | on `#FAFAFB` = **17.1:1**（达标） |
| `--neutral-950` | `#0E0E11` | 深色模式页面底 | — |

### 3.2 品牌主色：活力信任蓝（完整色阶）

| Token | Hex | 角色 | 对比度（白字） |
|---|---|---|---|
| `--primary-50` | `#EAF2FD` | 蓝底弱化面（选中背景、信息提示底） | — |
| `--primary-100` | `#D6E7FB` | hover 面（浅） | — |
| `--primary-200` | `#ADCDF7` | 骨架/分隔强调 | — |
| `--primary-300` | `#7CAEF0` | 深色模式强调 | — |
| `--primary-400` | `#4A8DE8` | 深色模式链接 | — |
| `--primary-500` | `#2B76E0` | 深色模式 primary | 3.9:1（仅大字/非文本） |
| `--primary-600` | `#1666D9` | **品牌基准**：主按钮 / 链接 / 选中态 / 焦点环 | **5.33:1** 达标 AA |
| `--primary-700` | `#1454B4` | hover 态 | 7.10:1 达标 |
| `--primary-800` | `#124594` | active 态 | 9.11:1 达标 |
| `--primary-900` | `#0F3A77` | 深色文本/图表 | — |

**语义 token**：`--primary` → `--primary-600`；`--primary-hover` → `--primary-700`；`--primary-active` → `--primary-800`；`--primary-subtle` → `--primary-50`（`--primary-subtle-foreground` → `--primary-700`）。

### 3.3 渐变 / 次级强调

| Token | Hex | 允许 | 约束 |
|---|---|---|---|
| `--gradient` | `#5B8DEF` | 次级强调、渐变过渡（与 `--primary` 同色系渐变） | 白字仅 **3.23:1** → 只做装饰带/大字号/图形，**禁止正文与正文级按钮文字** |

允许的渐变范式（唯二，其余禁止）：`linear-gradient(135deg, var(--primary), var(--gradient))` 与 `linear-gradient(90deg, var(--primary-600), var(--primary-400))`。**严禁** 品牌蓝与任何紫、粉色系组合成 Indigo→Pink 渐变（发光边框 + 毛玻璃三位一体的 AI 模板套路同样禁止）。

### 3.4 强调橙：活力橙（促销价 / 高亮 / 次要 CTA）

| Token | Hex | 允许出现的场景 | 对比度 |
|---|---|---|---|
| `--accent-orange` = `--accent-orange-500` | `#FF6B35` | 徽章底、圆点、图标、装饰、次要 CTA 底 | 白底 = **2.83:1**（连 3:1 大字都不过 → **仅非文本**）；其上文字用 `--neutral-900` = **6.30:1** 达标 |
| `--accent-orange-deep` = `--accent-orange-700` | `#C2410C` | **促销价文字专用**、划线价旁「省 ¥XX」 | 白底 = **4.96:1** 达标 AA |
| `--accent-orange-subtle` | `#FFF3EC` | 促销区背景带（面积 ≤1 屏 15%） | — |
| `--accent-orange-subtle-foreground` | `#C2410C` | `--accent-orange-subtle` 上的文字 | 4.96:1 达标 |

**禁止**：橙底白字（2.83:1 不达标）；`#FF6B35` 直接作为文字色放在浅底上（需降级到 `--accent-orange-deep`）；橙与 `--destructive` 红同屏相邻（混淆报错语义）。

### 3.5 语义色

| Token | Hex | 用途 | 对比度（白字） |
|---|---|---|---|
| `--success` | `#15803D` | 支付成功、库存充足、订单已发货 | 5.02:1（达标） |
| `--warning` | `#B45309` | 库存紧张、待付款提醒、沙箱模式提示 | 5.03:1（达标） |
| `--destructive` | `#B91C1C` | 表单校验失败、删除、支付失败 | 6.47:1（达标） |
| `--info` | `#1666D9` | 中性提示（运费说明、跨境时效），即品牌蓝，不引入第二种蓝 | 5.33:1（达标） |

**注意**：`--success`（`#15803D` 深绿）与微信支付品牌绿 `#07C160` 不同层级、不同用途，不会混淆——支付渠道 Logo 用官方色，不套 `--success`。

### 3.6 硬编码例外白名单

仅允许 `#FFFFFF`、`#000000`（本设计实际不用纯黑）、`1px` 线宽、`rgba()` 遮罩（但遮罩已封成 `--drawer-overlay` 类 token）。**其他任何裸色值出现即为缺陷。**

---

## 4. 字体方案（中英混排）

### 4.1 字体栈

```css
--font-sans: "Archivo", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB",
             "Microsoft YaHei", system-ui, sans-serif;
--font-display: var(--font-sans);   /* 同一族，靠字重/字号建层级，不靠换族 */
--font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
```

**选型理由**：Archivo 是高 x-height 的工业感 grotesque，字腔偏方、数字窄，与中文 Noto Sans SC 的字面密度接近，混排时基线不打架；它既不是 Inter（被 AI 项目用烂）、也不是 Geist（Saleor Paper 已占用），有印刷品标签的机械感，匹配「目录册」定位。**只用一个 sans 族**：跨族配对在中文场景会放大字重与字面的不匹配。

**加载策略**（对应 §12 性能预算）：
- Archivo 只取 `latin` 子集 + `wght 400;500;600`，`display: swap`，`preload` 一份。
- Noto Sans SC 取 `400;500;600`，`unicode-range` 由 Google Fonts 自动切片，`display: swap`；**首屏只 preload 400 与 600 两个中文子集**，500 走按需。
- JetBrains Mono 只取 `latin` + `wght 400`，**不 preload**（它只出现在订单详情与后台，首屏用不到）。
- 字体加载期间用 `size-adjust` 对齐回落的 `PingFang SC` 度量，避免 CLS（见 §12）。

### 4.2 字号阶（成阶，不是任选数字）

| Token | 值 | 行高 | 字距 | 用途 |
|---|---|---|---|---|
| `text-eyebrow` | 11px | 1.2 | **0.08em** | 全大写小标签（`NEW ARRIVAL` / `跨境直邮`），全大写必须 ≥0.06em |
| `text-xs` | 12px | 1.5 | 0.01em | 角标、库存提示、图注 |
| `text-sm` | 14px | 1.6 | 0 | 辅助说明、表格单元格、地址行 |
| `text-base` | 16px | 1.6 | 0 | **正文基准（移动端）**，低于 16px 的正文视为缺陷 |
| `text-lg` | 18px | 1.5 | 0 | 商品卡标题、列表主行 |
| `text-xl` | 20px | 1.4 | -0.01em | PDP 价格、区块小标题 |
| `text-2xl` | 24px | 1.3 | -0.01em | 二级标题 |
| `text-3xl` | 28px | 1.25 | -0.015em | 一级标题（移动端） |
| `text-4xl` | 32px | 1.2 | -0.02em | 一级标题（桌面端） |
| `text-5xl` | 40px | 1.15 | -0.02em | 编辑式大标题 |
| `text-display` | `clamp(32px, 1.5rem + 2.5vw, 48px)` | 1.1 | -0.025em | 首页唯一主标题 / 支付结果页金额 |

字重仅三级：**400 正文 / 500 小标题与按钮 / 600 页面标题与价格**。中文在 600 以上不再叠加（Noto Sans SC 的 700 在 16px 下会糊笔画）。

### 4.3 排版硬规则

- 正文中文每行 **25–37 字**（`--container-prose` = 42rem 保证不超）；英文 50–75 字符。
- 金额一律 `font-family: var(--font-mono); font-variant-numeric: tabular-nums`，右对齐成列。货币符号用小一号（`¥` 16px + 数字 20px）。
- 中文标点用全角，数字与中文之间**加 4px 视觉间距**（用 `letter-spacing` 或 span 包裹，不用空格字符）。
- 标题 `text-wrap: balance`，正文 `text-wrap: pretty`。
- 禁止两端对齐（`text-align: justify`）——中文会拉出难看的字间隙。

---

## 5. 间距体系

**4px 基准网格**。只允许下列 12 档，`--space-{n}` 的 n = px 值 ÷ 4：

| Token | px | 语义场景 |
|---|---|---|
| `--space-1` | 4 | 图标与文字之间、徽章内边距 |
| `--space-2` | 8 | 同组元素（label 与输入框）、相邻按钮最小间距 |
| `--space-3` | 12 | 表格单元格、列表行内 |
| `--space-4` | 16 | **移动端页面左右留白**、卡片内边距下限 |
| `--space-5` | 20 | 卡片内边距（默认） |
| `--space-6` | 24 | **桌面端页面左右留白**、卡片间距 |
| `--space-8` | 32 | 区块内子块间距 |
| `--space-10` | 40 | 段落之间 |
| `--space-12` | 48 | 区块间距（移动端） |
| `--space-16` | 64 | 区块间距（桌面端） |
| `--space-20` | 80 | 大区块间距（桌面） |
| `--space-24` | 96 | 编辑式满幅段落的上下留白 |

**区块纵向节奏**（clamp，无断点跳变）：
```css
--section-space-sm: clamp(2rem, 1.6rem + 2vw, 3rem);   /* 32 → 48px  紧凑区块 */
--section-space-md: clamp(3rem, 2.2rem + 4vw, 5rem);   /* 48 → 80px  常规区块 */
--section-space-lg: clamp(4rem, 3rem + 6vw, 7rem);     /* 64 → 112px 编辑式大段 */
```

**禁止**：`5/7/13/15/22/30/35` 这类非标值；禁止用 `gap-1.5` 这种半档；禁止为单个页面发明新间距。

---

## 6. 圆角与阴影档位

### 6.1 圆角（4 档 + full，一个 `--radius` 控全站）

| Token | 值 | 场景 |
|---|---|---|
| `--radius-xs` | 4px | 徽章、标签、复选框 |
| `--radius-sm` | 6px | 小按钮、缩略图、输入框内附件 |
| `--radius-md` | 8px | **按钮、输入框、Select（默认）** |
| `--radius-lg` | 12px | 卡片、商品图容器、抽屉内面板 |
| `--radius-xl` | 16px | 弹窗、底部 ActionSheet 上沿 |
| `--radius-full` | 9999px | 头像、购物车数字气泡、圆形图标按钮 |

**硬上限**：卡片圆角 **不超过 12px**。`--radius = 8px` 是换肤可调项（后台可 4–12 区间调），改这一个值全站跟随。**禁止 ≥24px**（过度圆滑 = AI 味）。

### 6.2 阴影（3 档，静置态默认不用阴影，用 1px 边框）

| Token | 值 | 场景 |
|---|---|---|
| `--shadow-sm` | `0 1px 2px 0 rgba(23,23,27,.06)` | 吸底结算条、吸顶 header 滚动后 |
| `--shadow-md` | `0 4px 12px -2px rgba(23,23,27,.10)` | 下拉、Popover、Toast、Select 面板 |
| `--shadow-lg` | `0 12px 32px -8px rgba(23,23,27,.16)` | 抽屉、Modal、移动端 ActionSheet |

**禁止**：`1px solid` 边框 + `box-shadow` blur ≥16px 同时出现在同一元素（幽灵卡片）；禁止彩色阴影；深色模式用亮度递进表达层级，不叠阴影。

---

## 7. 动效规范

**MOTION_INTENSITY = 3**：只有功能动效，无装饰动画。全站收敛基准 **150ms**。

| Token | 值 | 场景 |
|---|---|---|
| `--duration-instant` | 100ms | 按钮按下缩放、复选框勾选 |
| `--duration-fast` | **150ms** | hover 变色、焦点环出现、输入框边框变焦（**收敛基准值**） |
| `--duration-base` | 200ms | 购物车抽屉滑入、下拉展开、Toast 进出 |
| `--duration-slow` | 300ms | 结账步骤切换、商品图淡入（**绝对上限**） |

**允许的 easing（只有这三个）**：
```css
--ease-standard:   cubic-bezier(0.2, 0, 0, 1);   /* 入场：抽屉、下拉、Toast */
--ease-exit:       cubic-bezier(0.4, 0, 1, 1);   /* 退场 */
--ease-emphasized: cubic-bezier(0.2, 0, 0, 1);   /* 强调：步骤切换 */
```

**明令禁止**：
- 弹跳缓动 `cubic-bezier(0.68, -0.55, 0.265, 1.55)`（及任何 `overshoot` 曲线）。
- 动画 `width` / `height` / `top` / `left`（强制走 `transform` 与 `opacity`；除 `height: auto` 折叠面板可用 `grid-template-rows: 0fr → 1fr`）。
- 超过 300ms 的动效（骨架屏脉冲是唯一例外，1600ms 且非位移）。
- 同一时刻超过 3 个元素同时动。
- 纯装饰动效：无触发源的浮动、呼吸、粒子。

**必须支持 `prefers-reduced-motion`**：全局把 `transition-duration` 压到 `0.01ms`，骨架屏改静态色块。

**具体三个关键动效的规格**：
| 动效 | 时长 / 曲线 | 属性 |
|---|---|---|
| 购物车抽屉 | 200ms / `--ease-emphasized` | `translateX(100%) → 0`；遮罩 `opacity 0 → 1` |
| 结账步骤切换 | 300ms / `--ease-emphasized` | 新步骤 `opacity 0→1` + `translateY(8px)→0`；旧步骤直接卸载不做出场 |
| 加购乐观更新 | 150ms / `--ease-standard` | 数字气泡 `scale(1)→scale(1.15)→scale(1)`，仅 1 次 |

---

## 8. 图标库方案（锁定）

### 8.1 选型：**Lucide**（`lucide-react` / 静态 SVG）

**为什么是 Lucide**：
1. **规格严格自洽**：24×24 canvas、**2px 描边**、round cap / round join、1px 安全区、2px 元素最小间距。这是一套有书面设计规范（`lucide.dev/contribute/icons/design-principles`，14 条硬规则）的图标集，能保证 200+ 个图标摆在一起视觉重量一致——这正是「看不出是 AI 做的」的关键。
2. **shadcn/ui 默认搭档**：本项目采用 **shadcn/ui 实现体系**（Radix primitives + cva + tailwind-merge + CSS 变量语义），组件源码存放于 `@mall/ui` 供前台与后台共用；**不采用 shadcn 默认皮肤**，配色走 `@mall/design-tokens`（见 ADR-011）。其默认图标库为 Lucide，与本节锁定的图标方案一致，零额外集成成本、不会出现两套图标混用。
3. **tree-shakable**：`import { ShoppingBag } from "lucide-react"` 只打包用到的图标，不拖累首屏 JS 预算。
4. **前后台覆盖完整**：店面需要 `ShoppingBag / Search / Truck / ShieldCheck / CreditCard`，后台需要 `Package / ClipboardList / Settings / Store / TrendingUp`，同一套语义体系，不出现「前台圆角细线、后台实心块面」的割裂。
5. **可着色可缩放**：`stroke="currentColor"`，直接吃 `--foreground` / `--muted-foreground`，随主题与字重同步。

**不选其他库的原因**：Heroicons 只有 24/20/16 三档且 solid 与 outline 混用；Phosphor 有 6 种 weight 容易滥用成装饰；Radix Icons 只有 15×15 单一尺寸；Feather 已停止维护。

### 8.2 尺寸规范（全项目三档，不可新增）

| 档位 | 尺寸 | `stroke-width` | 使用场景 |
|---|---|---|---|
| **inline** | **16px** | **1.75** | 行内元信息：地址前的 MapPin、库存提示前的 Clock、表格单元格内的状态图标、标签后缀 |
| **button** | **20px** | **2** | 按钮内图标、输入框前后缀（搜索框 Search、密码框 Eye/EyeOff）、Select 的 ChevronDown |
| **standalone** | **24px** | **2** | 顶部导航（Search / ShoppingBag / User / Menu）、移动端 TabBar、独立图标按钮、空态插画位、Toast 前缀 |

> 16px 时用 1.75 描边而非 2：2px 在 16px 下视觉过重、小字旁会压字；这是比例补偿，不算违反「统一描边」。

代码约定：
```tsx
// 唯一允许的调用形态，禁止直接 <svg> 手写路径
<Search className="size-5" strokeWidth={2} aria-hidden="true" />
<MapPin className="size-4" strokeWidth={1.75} aria-hidden="true" />
// 纯图标按钮必须给可读名，且触摸区扩到 44x44
<button aria-label="打开购物车" className="grid size-11 place-items-center">
  <ShoppingBag className="size-6" strokeWidth={2} aria-hidden="true" />
</button>
```

### 8.3 为什么绝对不用 emoji 当功能图标

1. **渲染不可控**：iOS / Android / Windows / Linux 各一套字形，同一份代码在四个平台长四个样，无法做视觉验收。
2. **不可着色**：emoji 是彩色字形，无法跟随 `--foreground`，也就无法做 hover / 禁用 / 深色模式三态。
3. **不可缩放**：栅格字形在 16px 与大屏 2x 下清晰度不一致，且无描边粗细概念。
4. **语义噪音**：屏幕阅读器会把 emoji 读成「火箭」「闪亮」等，污染可访问树（`aria-label` 也盖不住）。
5. **设计一致性零**：emoji 的圆角、描边、透视角度各不相同，混排即视觉崩塌。

**结论**：任何位置需要图标，一律从 Lucide 按语义取名，写在文档里写作 `搜索图标（Search，20px）`，不写符号。

### 8.4 关键图标映射表（一期用到的全部）

| 语义 | Lucide 名 | 尺寸 | 出现位置 |
|---|---|---|---|
| 搜索 | `Search` | 20 / 24 | 顶部导航、PLP 搜索框 |
| 购物车 | `ShoppingBag` | 24 | 顶部导航（带数字气泡） |
| 账户 | `User` | 24 | 顶部导航 |
| 菜单 | `Menu` | 24 | 移动端顶部 |
| 关闭 | `X` | 20 / 24 | 抽屉、Toast、筛选弹层 |
| 返回 | `ChevronLeft` / `ArrowLeft` | 24 | 移动端页面头、结账步骤 |
| 展开 | `ChevronDown` / `ChevronRight` | 20 | 折叠面板、列表行右侧 |
| 筛选 | `SlidersHorizontal` | 20 | PLP 筛选按钮 |
| 排序 | `ArrowUpDown` | 20 | PLP 排序 |
| 数量减 / 加 | `Minus` / `Plus` | 20 | 购物车数量步进器 |
| 删除 | `Trash2` | 20 | 购物车行、地址簿 |
| 收藏 | `Heart` | 24 | PDP（预留二期） |
| 配送 | `Truck` | 16 / 24 | PDP 承诺条、结账配送方式 |
| 关税 / 保障 | `ShieldCheck` | 16 | PDP 跨境承诺、结账信任条 |
| 支付 | `CreditCard` | 20 / 24 | 结账支付方式 |
| 微信支付 | 官方品牌 SVG（非 Lucide） | 24 | 支付方式选择行（品牌 Logo 必须用官方资产） |
| 支付宝 | 官方品牌 SVG（非 Lucide） | 24 | 同上 |
| 包裹 / 发货 | `Package` / `PackageCheck` | 24 | 订单状态、后台 |
| 地址 | `MapPin` | 16 / 24 | 地址簿、结账 |
| 成功 | `Check` / `CircleCheck` | 20 / 24 | 支付成功、表单通过 |
| 警告 | `CircleAlert` | 16 / 20 | 库存紧张、沙箱提示 |
| 错误 | `CircleX` | 20 | 表单失败、支付失败 |
| 信息 | `Info` | 16 | 运费说明、时效说明 |
| 加载 | `Loader2`（`animate-spin`） | 20 | 按钮 loading 态 |
| 复制 | `Copy` | 16 | 订单号、单号 |
| 外链 | `ExternalLink` | 16 | 物流查询跳转 |
| 图片缺失 | `ImageOff` | 24 | 商品图占位 |
| 重试 | `RefreshCw` | 20 | 错误态重试按钮 |
| 视图切换 | `LayoutGrid` / `List` | 20 | PLP 网格 / 列表切换 |
| 后台：概览 | `LayoutDashboard` | 20 | Admin 侧边栏 |
| 后台：商品 | `Package` | 20 | Admin 侧边栏 |
| 后台：订单 | `ClipboardList` | 20 | Admin 侧边栏 |
| 后台：客户 | `Users` | 20 | Admin 侧边栏 |
| 后台：设置 | `Settings` | 20 | Admin 侧边栏 |
| 后台：退出 | `LogOut` | 20 | Admin 用户菜单 |
| 后台：密码可见 | `Eye` / `EyeOff` | 20 | Admin 登录 |

---

## 9. 页面清单与版式说明（一期 13 页）

路由前缀统一为 `/{locale}/{channel}/`（如 `/zh-CN/cn/`），下表省略前缀。

### 前台 9 页

#### 9.1 首页 `/{locale}/{channel}`
- **信息层级**：① 顶部通告条（跨境时效/包邮门槛，单行，可关闭）→ ② Header（Logo / 分类导航 / 搜索 / 购物车）→ ③ **商品网格首屏**（当季主推，8–12 个 SKU）→ ④ 分类入口（非金刚区九宫格，用 3 条横向编辑式图文条，比例 16:9 + 1 行标题）→ ⑤ 商品瀑布（4:5 卡片）→ ⑥ 服务承诺条（正品 / 直邮 / 7 天可退，横排 3 项带图标）→ ⑦ Footer。
- **首屏硬约束**：**不做通用 Hero**。第一屏纵向预算内必须出现至少 4 个真实商品（含真实图、真实价）。允许顶部一条 3:1 活动横条，但高度 ≤120px（移动端 ≤88px），且其下立刻接商品网格。
- **关键组件**：`ProductCard`（4:5 图 + 2 行标题 + 价格 + 促销角标）、`SectionHeader`（标题 + 「查看全部」右箭头）、`AnnouncementBar`、`Header`、`Footer`、`TrustBar`。
- **移动端差异**：Header 压成 56px（Logo + 搜索 + 购物车，分类进汉堡菜单）；商品网格 2 列（`gap-3`）；分类横条改横向滚动 snap（隐藏滚动条）；Footer 折叠为手风琴。

#### 9.2 商品列表 PLP `/c/[slug]`（搜索结果 `/search` 复用同一版式）
- **信息层级**：① 面包屑（移动端只显示上一级）→ ② 分类名 + 商品数 → ③ **筛选/排序工具条（吸顶）** → ④ 商品网格 → ⑤ 分页（桌面）/ 无限滚动 + 「加载更多」兜底（移动端）。
- **版式**：桌面 4 列（`--container-content` 内，`gap-6`）；平板 3 列；移动 2 列（`gap-3`）。卡片严格 4:5 图 + 等高文本区（`line-clamp-2` 标题固定 2 行高，防参差）。
- **筛选形态**：桌面 = 左侧 240px 侧栏（可折叠分组，复选 + 价格区间）；移动 = 底部 ActionSheet（`--radius-xl` 上沿，**「查看 N 件商品」吸底按钮**）+ 顶部已选条件 chips（可单个 ×）。
- **关键组件**：`FilterSidebar`、`FilterSheet`、`SortSelect`、`ActiveFilterChips`、`ProductCard`、`ProductGridSkeleton`、`Pagination`。
- **移动端差异**：无侧栏；筛选与排序收进工具条两个按钮；已选 chips 横向滚动；「加载更多」按钮 44px 高。
- **空态**：无结果时不用「没有找到商品」，写 `这个筛选条件下暂时没有商品` + `清除筛选条件` 按钮 + 3 个推荐商品。

#### 9.3 商品详情 PDP `/p/[slug]`
- **信息层级**：① 图库（主图 4:5 + 缩略图条，桌面左侧 sticky）→ ② 标题（`text-3xl`）→ ③ 价格区（现价 `text-xl` 墨色 / 促销价 `--accent-orange-deep` + 划线原价 + 省额）→ ④ 规格选择（颜色 swatch / 尺码按钮）→ ⑤ 库存与时效（`Truck` + `ShieldCheck` 两行，16px）→ ⑥ 加购 / 立即购买 → ⑦ 跨境信息（清关时效、税费说明）→ ⑧ 商品描述（富文本，`--container-prose`）→ ⑨ 参数表 → ⑩ 相关推荐。
- **桌面两栏**：左 `7fr` 图 / 右 `5fr` 信息，信息栏 `position: sticky; top: var(--chrome-offset)`。这是全站唯一的非对称栅格，**首页商品网格必须是对称列，只有 PDP 用 7:5**。
- **关键组件**：`Gallery`（键盘左右切换、缩略图 `<button>` + `aria-current`）、`VariantPicker`（swatch 44×44 触摸区）、`QuantityStepper`、`AddToCartBar`、`PriceBlock`、`SkuSpecTable`、`TrustRow`。
- **移动端差异**：图库改横向 snap 轮播 + 圆点指示；规格选择与加购收进 **吸底条**（`--bottom-bar-height` 72px + `--safe-area-bottom`，左侧价格右侧「加入购物车」）；描述与参数折叠（默认只开描述）；缩略图条换成「1 / 6」计数。
- **规格不可选态**：soldout 的尺码用删除线 + `--muted-foreground` + `aria-disabled`，点击时在按钮下方出现 14px `--destructive` 文案「该规格已售罄，试试其他尺码」，不弹 Toast。

#### 9.4 购物车（页面 `/cart` + 全局抽屉）
- **抽屉优先**：加购成功后**打开购物车抽屉**而不跳页（Shopify Dawn 模式），保持用户在 PDP。
- **抽屉信息层级**：标题「购物车（3）」+ 关闭 → 商品行列表（1:1 图 64px / 标题 2 行 / 规格 / 数量步进 / 单价 / 删除）→ 小计 → 运费说明（「满 ¥199 免运费」）→ 主 CTA「去结算」→「继续购物」文字链。
- **抽屉交互契约（照抄 Dawn 的可访问部分）**：触发图标 `role="button"` + `aria-haspopup="dialog"`；Esc 关闭；点遮罩关闭；**`transitionend` 后才 `trapFocus`**；`body.overflow-hidden`；关闭后焦点回到触发图标；桌面宽 440px / 移动 `calc(100vw - 48px)`（留 48px 遮罩可点）；关闭按钮触摸区 44×44。
- **页面版式**：桌面 `8fr 4fr`（左明细 / 右 sticky 汇总卡）；移动单列 + 吸底结算条。
- **关键组件**：`CartDrawer`、`CartLineItem`、`QuantityStepper`、`OrderSummaryCard`、`PromoCodeInput`（一期只留位不实现）、`FreeShippingProgress`（进度条用 `--primary`，仅此一处）。
- **移动端差异**：抽屉近全屏；页面版汇总卡移到列表下方（不吸底），吸底只留总额 + 去结算。
- **空态**：`购物车还是空的` / 辅助行 `看看本周新到的商品` + 主按钮 `去逛逛` + 下方 4 个推荐商品（把空态变成二次转化位，不留白）。

#### 9.5 结账 `/checkout`（移动优先，分步）
见 §10 专项。桌面：左 `8fr` 表单 / 右 `4fr` 只读订单摘要（sticky）。移动：单列，步骤头吸顶，操作吸底。

#### 9.6 支付结果 `/checkout/result`
- **三种状态**（用 query 或独立子路由区分，刷新保持）：
  - 成功：`CircleCheck` 48px（`--success`）+ `订单已支付` + 订单号（等宽 + 复制按钮）+ 金额（`text-display`）+ 「查看订单」主按钮 + 「继续购物」次按钮 + 预计发货时间。
  - 处理中（微信/支付宝异步回调未回）：`Loader2` + `正在确认支付结果` + 自动轮询提示「每 3 秒自动刷新，也可以手动刷新」+ 手动刷新按钮。**不得让用户以为失败**。
  - 失败：`CircleX` + 具体原因（如「银行卡余额不足」「支付超时」）+ 「重新支付」主按钮 + 「联系客服」文字链 + **订单号常显**（便于客服定位）。
- **关键组件**：`ResultHero`、`CopyableCode`、`OrderMiniCard`。
- **移动端差异**：无，本页本就单列。

#### 9.7 订单查询 `/order/[id]`（落地页 `/order/lookup`）
- 免登录：单号 + 手机号后四位 / 邮箱二选一验证。表单 2 字段，`--container-narrow` 居中（这是全站少数允许居中的页面，因为只有一件事）。
- **信息层级**：状态时间轴（已下单 → 已付款 → 已发货 → 已签收，4 步竖排，当前步 `--primary` 圆点）→ 商品行 → 金额明细 → 收货地址 → 物流单号（`Copy` + `ExternalLink` 跳承运商）。
- **关键组件**：`OrderTimeline`、`OrderLineItem`、`AmountBreakdown`、`AddressBlock`。
- **移动端差异**：时间轴竖排改横向 4 点 + 当前步文字；金额明细折叠。

#### 9.8 账户 `/account`（登录 / 订单列表 / 地址簿）
- 登录：手机号（软标识，游客下单兜底）为主；短信验证码为**条件路径**（依赖 Q3 裁决的短信服务商，未配置时隐藏验证码，仅手机号登录）或邮箱 + 密码二选一（Auth Provider 待定）。**表单有可见 label，不只 placeholder**。
- 订单列表：状态 Tab（全部 / 待付款 / 待发货 / 已发货 / 已完成）+ 订单卡列表（单号 + 时间 + 2 个商品缩略图 + 总额 + 主操作按钮）。
- 地址簿：卡片列表 + 「新增地址」；地址表单用原生 `select` 做省市区（一期不做级联组件）。
- **移动端差异**：Tab 横向滚动；订单卡下方操作按钮全宽 44px；地址表单分两屏（收件人+电话 / 地址明细），降低单屏字段数到 ≤4。

#### 9.9 404 / 错误页 `/not-found`、`/error`
- 404：`ImageOff` 24px → 文案 `这个页面不见了` → 辅助 `链接可能已失效，或者商品已经下架` → 主按钮 `回到首页` + 次按钮 `搜索商品`（带输入框）+ 4 个推荐商品。
- 500：`CircleAlert` + `页面出了点问题` + `已记录，请稍后重试` + `重新加载` 按钮 + 错误 ID（等宽小字，便于报障）。
- **关键**：两页都不显示技术堆栈。

### 后台 4 页

#### 9.10 后台登录 `/admin/login`
- 居中卡片 `--container-narrow` 内 400px；Logo + `登录管理后台` + 邮箱 + 密码（`Eye`/`EyeOff` 切换）+ 记住我 + 登录按钮。
- 错误：字段下方 14px `--destructive` 文案；连续 3 次失败出现图形验证码位（预留）。
- **不显示**「默认账号 admin/admin」这类提示。

#### 9.11 商品管理 `/admin/products`（列表 + 抽屉表单）
- **导航形态**：左侧 Sidebar 240px 可折叠（`LayoutDashboard` / `Package` / `ClipboardList` / `Users` / `Settings`），当前项 `--sidebar-accent` 底 + 左侧 2px `--primary` 竖条。
- **列表密度（VISUAL_DENSITY = 7）**：**不用卡片盒子**。表头 `--muted` 底 40px；行高 52px，行间 1px `--border`；列：勾选框 / 缩略图 1:1 40px / 标题（2 行截断）/ SKU（等宽）/ 价格 / 库存 / 状态徽章 / 操作。批量操作条在勾选后从表头滑出。
- **新建/编辑不跳页**：`Drawer` 右侧滑出 560px，两段式（基本信息 / 价格库存），底部固定操作条。
- **关键组件**：`DataTable`、`StatusBadge`、`Drawer`、`BulkActionBar`、`EmptyState`、`Pagination`。
- **移动端差异**：后台**不保证移动可用**，但 1024px 以下 Sidebar 收成图标条、表格允许横向滚动（`overflow-x-auto` + 首列 sticky）。这是明确的范围声明，写在这里避免前端自己发挥。

#### 9.12 订单管理 `/admin/orders`（列表 + 详情）
- 列表同上密度规范；列：订单号（等宽）/ 客户 / 时间 / 商品数 / 金额 / 支付状态 / 履约状态 / 操作。
- 详情：左右两栏（左 8：商品行 + 金额明细 + 时间轴；右 4：客户卡 + 地址卡 + 支付信息 + 操作区），**操作区浮动在右下**（发货 / 退款 / 取消），危险操作二次确认用 `FocusModal` 并要求输入订单号后四位。
- **关键组件**：`OrderStatusPill`、`FulfillmentForm`（Drawer）、`RefundModal`、`Timeline`。

#### 9.13 设置 `/admin/settings`（含换肤可调项）
- 分组 Tab：店铺信息 / **外观（换肤）** / 支付方式 / 配送与运费 / 税务 / 币种与市场 / 通知。
- **外观面板**是本项目「模板产品」定位的核心 UI：见 §13 的可调项清单。每个可调项右侧必须有 **实时预览块**（不改代码即可看到主色/圆角/商品图比例效果），底部「保存并预览」+「恢复默认」。
- **关键组件**：`SettingsTabs`、`ColorPickerField`（限色板内选择，不给自由十六进制，防运营调出低对比度）、`RadiusSlider`（4/6/8/10/12 五档）、`AspectRatioRadio`（1:1 / 4:5 / 3:4）、`ThemePreviewCard`、`DangerZone`。

---

## 10. 移动优先结账流

**形态决策**：**分步（4 步），不是单页**。理由：单页在移动端首屏就要展示地址+配送+支付+备注 12+ 字段，工作记忆超载（>7 项用户放弃），且跨境场景字段更多（身份证、清关）。分步每步 ≤4 个字段。桌面端同样分步（保持一致），但表单区与摘要区左右并置。

**通用规则**：
- 步骤头吸顶（`--header-height`），4 个步骤点 + 进度线，当前步 `--primary` 实心，已完成步 `Check` 图标，未达步 `--neutral-300`。
- 操作按钮**吸底**：高 52px，全宽，`底 + --safe-area-bottom`；「返回」在吸底条左侧（图标按钮 44×44），不占主按钮空间。
- **校验时机**：`blur` 时校验单字段 → 点「下一步」时校验整步并聚焦第一个错误字段。**不在输入过程中实时报错**（会打断输入）。
- **错误展示位置**：字段错误 = 输入框**正下方 14px** `--destructive` 文案 + 输入框边框变 `--destructive`；整步错误（如库存不足）= 吸底条**上方**插入一条 `--destructive-subtle` 背景的横幅，含「去修改」锚点按钮。**绝不把错误只放在页面顶部**。
- 每步数据本地持久化（`sessionStorage`），返回上一步不丢；刷新页面回填。

### 步骤 1：联系方式
> 验证码为**条件字段**（依赖 Q3 裁决的短信服务商）：默认「手机号仅作软标识、不验证码」，保持一键安装 0 必填配置；后台配置了短信服务商后才出现验证码字段与「发送验证码」按钮。

| 字段 | 必填 | 校验 | 错误文案位置 |
|---|---|---|---|
| 手机号 | 是 | 中国大陆 `1[3-9]\d{9}`（跨境单允许选国家码 + 长度 6–15） | 字段下方 + 输入框红边 |
| 邮箱（可选） | 否 | `type=email` 格式 | 字段下方 |
| 验证码 | 条件（后台启用短信后变必填） | 6 位数字，60s 可重发（重发倒计时在按钮上） | 字段下方；码错时报「验证码不正确或已过期」 |

### 步骤 2：收货地址
| 字段 | 必填 | 校验 | 备注 |
|---|---|---|---|
| 收件人姓名 | 是 | 1–30 字符 | — |
| 国家/地区 | 是 | 下拉，默认 Channel 绑定国家 | 改国家会重算运费与税费 |
| 省 / 市 / 区 | 是 | 三级原生 select | 一期不做级联动画 |
| 详细地址 | 是 | 5–200 字符，多行 | `textarea` 2 行 |
| 邮编 | 视国家 | 中国 6 位数字；国际宽松 | — |
| 身份证号 | 跨境必填 | 18 位，末位可 X | **必须显示用途说明**：`用于海关清关，不会用于其他用途`（`Info` 图标 + 12px `--muted-foreground`） |

「保存为常用地址」复选框在字段末尾。错误统一在字段下方；地址无法匹配时在**地址字段组底部**给一条 `--warning` 提示，不阻断提交。

### 步骤 3：配送方式
- 卡片列表（单选），每项：承运商名 + 时效（「7–12 个工作日」）+ 运费（免运费显示 `免运费`，不用 ¥0.00）+ 右侧 radio。
- 选中态：卡片边框 `--primary` 1px + `--muted` 底，**不用彩色**。
- 空态（该地区无可用方式）：`当前地址暂不支持配送` + `更换地址` 按钮。
- 加载：3 个骨架卡片，高 72px，`--skeleton-delay` 300ms 后出现。
- 切换配送方式时运费/总价变化：**金额用 `--duration-fast` 做数字滚动**（不是整块刷新）。

### 步骤 4：支付方式 + 确认
- 支付方式分组（一期）：`微信支付` / `支付宝` / `Stripe`（银行卡、Apple Pay、Google Pay）/ `PayPal`，**按 Channel 与地区过滤**，无可用项时整组不渲染并给一行说明。
- 每个方式是 1 行 radio 卡：官方品牌 Logo 24px + 名称 + 右侧 radio。选中后下方展开说明（如微信支付提示「将跳转至微信完成支付」）。
- 同样折叠展示订单摘要（可展开）：商品行 + 小计 + 运费 + 税费 + 总计。
- 主 CTA 文案按方式变：`微信支付 ¥199.00`（金额进按钮，避免用户再找一次总数）。
- 提交中：按钮进入 loading（`Loader2` 旋转 + 文案 `正在跳转…`），**全表单 `pointer-events: none`**，防重复提交；超时 15s 未跳转则显示「支付页面加载失败，重试 / 换个方式」。

**步骤返回与数据一致性**：改地址 → 回到步骤 3 时重算运费；改配送方式 → 回到步骤 4 时重算总额；任何影响金额的变更都在摘要素上用一次 `--duration-fast` 高亮闪一下（背景 `--warning-subtle` → 透明），让用户知道数字变了。

---

## 11. 加载与反馈规范

### 11.1 骨架屏 vs Spinner 的使用边界（不要混用）

| 场景 | 用什么 | 理由 |
|---|---|---|
| 首屏 / 路由切换后有固定版式的区块（商品网格、PDP 图库、订单列表、后台表格） | **骨架屏**，形状必须**逐像素模仿真实布局**（含图片块、标题行、价格行） | 保住布局尺寸 → 零 CLS；用户能预判内容结构 |
| 区块内的小范围数据（价格、库存、评价数） | **内联占位**（灰色圆角条，宽度按字符数预置） | 不动版 |
| 用户主动触发的短操作（加购、提交表单、保存、发验证码） | **按钮内 `Loader2` + 文案变「处理中…」**，按钮宽度不变 | 反馈绑定在触发点上，用户视线不动 |
| 页面级未知时长的等待（结账跳转第三方支付） | 按钮 loading + 全页 `pointer-events:none` + 15s 超时兜底 | 不给用户「页面卡死」的错觉 |
| 长列表增量加载 | 底部 3 行骨架 + 「加载更多」按钮（超时或失败可重试） | — |
| **禁止** | 全屏居中大 Spinner 遮罩、整页白屏、`window.alert` | 三者都会让用户以为断网 |

**骨架屏硬规格**：`--skeleton-base #E9E9ED` ↔ `--skeleton-shine #F4F4F6` 1600ms 脉冲；**延迟 300ms 才出现**（`--skeleton-delay`），快网络下不闪；`prefers-reduced-motion` 下改静态色块。

### 11.2 乐观更新与回滚

- **加购**：点击 → 立即（0ms）购物车数字 +1 并弹一次 `scale` 动效 → 打开抽屉显示新行（行本身用 `opacity 0→1`，150ms）→ 后台确认后静默对齐真实数量；**失败时**：数字回退（`--destructive` 闪一次背景 150ms）+ 抽屉顶部插入 `--destructive-subtle` 横幅 `未能加入购物车：库存不足（仅剩 2 件）` + 「重试」。
- **数量步进**：改数字立即生效 → 若库存不足，输入框回到原值并在行下方出现 14px 红字 `库存仅剩 N 件`（3s 后自动消失，用 `aria-live="polite"` 播报）。
- **删除购物车行**：立即移除 + 底部 Toast `已从购物车移除 商品名` 带「撤销」按钮（5s）。**撤销 = 真正的回滚，不是重新加购**。
- **地址默认切换**：立即生效，失败静默回滚并 Toast 说明。
- **通用**：所有乐观更新必须能回滚；所有回滚必须有可见反馈；所有反馈文案必须**说明原因与下一步**，不写「操作失败」四个字了事。

### 11.3 空态设计（每一处都必须是二次转化位）

| 位置 | 主文案 | 辅助 | 行动 |
|---|---|---|---|
| 购物车 | `购物车还是空的` | `看看本周新到的商品，满 ¥199 免运费` | `去逛逛` + 4 个推荐商品 |
| PLP 无筛选结果 | `这个筛选条件下暂时没有商品` | `试着放宽价格或去掉一个条件` | `清除筛选` + 3 个推荐 |
| 搜索无结果 | `没有找到「关键词」` | `检查一下错别字，或者换个说法` | `搜索框自动聚焦` + 热词 6 个 |
| 订单列表 | `还没有订单` | `下单后可以在这里查物流` | `去逛逛` |
| 地址簿 | `还没有收货地址` | `添加后结账会更快` | `新增地址` |
| 后台商品列表 | `还没有商品` | `上传第一个商品，或者从 Excel 批量导入` | `新建商品`（主）+ `批量导入`（次） |
| 后台订单列表 | `还没有订单` | `订单产生后会自动出现在这里` | 无按钮（不制造假操作） |

**空态规格**：图标 24px（`--neutral-300`，不用彩色插画）→ 主文案 `text-lg`/500 → 辅助 `text-sm`/`--muted-foreground` → 按钮（1 主 1 次）。**禁止**把空态做成大插画 + 居中居中的模板。

### 11.4 错误态设计（4 类，文案必须区分）

| 类型 | 表现 | 文案范式 |
|---|---|---|
| 字段校验 | 输入框红边 + 字段下方 14px 红字 | 具体：`请输入 11 位手机号` / `验证码不正确或已过期` |
| 业务规则 | 横幅（`--destructive-subtle` 底，含图标与关闭） | 带原因：`库存不足，当前仅剩 2 件。请调整数量后重试。` |
| 网络 / 服务 | 区块级占位替换（不是 Toast） | `加载失败` + `网络似乎不稳定` + `重试` 按钮 |
| 支付失败 | 结果页 + 订单号常显 | 透传网关原因 + `重新支付` + `联系客服` |

**Toast 使用边界**：只用于「不需用户决策的确认」（已复制、已保存、已移除），4s 自动消失，右上角（桌面）/**顶部**（移动，避免遮挡吸底条）；**禁止**用 Toast 报校验错误（会被手机键盘遮住且易错过），禁止 Toast 里放 >1 个操作。

---

## 12. 性能预算的设计侧落地（LCP < 2.5s / CLS < 0.1）

| 措施 | 设计侧具体规定 |
|---|---|
| **商品图比例** | 主图/卡片固定 **4:5**、购物车缩略图与后台列表 **1:1**、首页编辑式横条 **16:9**、通告条 **3:1**。比例是 `--product-ratio` 换肤可调项（1:1 / 4:5 / 3:4 三档），**任何页面不得出现未声明比例的图位**。 |
| **裁切规则** | 统一 `object-fit: cover` + 居中裁切（`object-position: center`）；人脸/鞋类等需要在后台标 `focalPoint`，前端 `object-position` 读该值。**禁止 `object-fit: fill`**（会拉变形）。 |
| **首屏图不加懒加载** | 首屏 LCP 图（首页第一排商品图、PDP 主图）必须 `priority` / `fetchpriority="high"`，且该图**不得在客户端组件里包一层动态 import**。第二屏起（`IntersectionObserver` 进入视口前 200px）才 `loading="lazy"`。 |
| **预留固定尺寸防 CLS** | 每个图位必须写 `width`/`height` 或 `aspect-ratio`，容器高度由 CSS 决定而非由图片撑开。文案位（标题 2 行、价格 1 行、`--muted-foreground` 辅助行）用 `min-height` 锁定，避免数据回来时跳。骨架屏与真实内容**同高**。 |
| **字体加载** | 首屏 preload Archivo(400/600 latin) + Noto Sans SC(400/600 首屏子集)；`display: swap`；用 `size-adjust` 把 `PingFang SC` 回落的 x-height 对齐到 Noto（`size-adjust: ~103%`，实施时实测微调），避免字体切换时整页重排。 |
| **动效不拖 LCP** | 首屏不做入场动画（不做 `opacity:0 → 1` 的整体淡入，那会把 LCP 时间往后推）；`MOTION_INTENSITY=3` 已从规范层禁止。 |
| **图片体积** | 设计交付的图比例与裁切点决定 `srcset` 断点（设计给出 2 档：移动 750px 宽、桌面 1200px 宽），前端据此出 `srcset`/`sizes`，避免大图喂小屏。 |
| **第三方资源** | 支付 SDK 只在进入结账步骤 4 时按需加载；不在首屏加载任何第三方 JS。 |
| **验收口径** | 一期验收在真实 4G 网络下测首页 / PDP / 结账三页 LCP，超预算不上线（简报第十节第 2 条）。 |

---

## 13. 换肤地基（模板产品的核心）

### 13.1 设计变量集中管理清单

**唯一入口**：`design-tokens.css`。店面与后台都从这里取，组件内**零裸值**。

| 层 | 变量 | 换肤时是否改 | 管理位置 |
|---|---|---|---|
| 主色（蓝阶 + 渐变 + 强调橙） | `--primary`（= `--primary-600`，含 50–900 阶）、`--gradient`、`--accent-orange`（500–700） | 可调（预设色板 8 选 1，选中后自动联动生成蓝阶/橙阶深浅档） | 后台写入 → 覆盖 `:root` |
| 字体 | `--font-family-sans` / `--font-family-display` / `--font-family-mono` | 可选（3 套预设：Archivo / 思源黑体优先 / 系统字体） | 同上 |
| 圆角 | `--radius`（派生 6 档） | 可调，5 档滑杆：4 / 6 / 8 / 10 / 12 | 同上 |
| 阴影 | `--shadow-sm/md/lg` | 可调，3 档：无阴影 / 轻 / 中（只换强度，不换方向） | 同上 |
| Logo | `--logo-url`（明/暗两版） | 可调，后台上传 | 同上 |
| 商品图比例 | `--product-ratio-primary`（1:1 / 4:5 / 3:4） | 可调，单选 | 同上 |
| 字阶与间距 | `--text-*`（`@theme` 内）/ `--space-*` | 可选（3 档密度预设：舒适 / 标准 / 紧凑，即 §附录 B 的 VISUAL_DENSITY） | 同上 |
| 中性阶 / 语义色 | `--neutral-*` / `--success` 等 | 不可调（保证对比度达标） | 固定 |
| 动效 / z-index | `--duration-*` / `--ease-*` / `--z-*` | 不可调 | 固定 |
| 布局骨架（栅格、两栏比、区块顺序） | — | 不可调（属「可视化装修」范围，二期 CMS） | — |

### 13.2 后台可调项（外观面板，一期交付）

| 可调项 | 控件 | 取值 | 约束 |
|---|---|---|---|
| 品牌主色 | 色板 8 选 1（活力蓝 `#1666D9` / 墨绿 / 藏蓝 / 砖红 / 橄榄 / 深棕 / 石墨 / 砂岩，每个都是预校验过 4.5:1 的色，选中后自动生成蓝阶 + 联动橙阶） | 8 选 1 | **不给自由十六进制**，防运营调出低对比度不可读界面 |
| 渐变 / 次级强调色 | 跟随主色同色系派生（默认 `#5B8DEF`） | 自动 | 只做装饰，禁正文 |
| 强调橙 | 跟随主色（默认 `#FF6B35`，文字档 `#C2410C`） | 自动 | 只做非文本，文字走深档 |
| 字体预设 | 单选（带实时预览图） | 3 套 | 每套都是中英混排校验过的组合 |
| 圆角 | 滑杆 | 4 / 6 / 8 / 10 / 12 | 上限 12（卡片 >24 禁止） |
| 阴影强度 | 单选 | 无 / 轻 / 中 | — |
| Logo | 上传 | SVG/PNG，明暗两版，高 ≤40px | 自动校验安全边距 |
| 商品图比例 | 单选 | 1:1 / 4:5 / 3:4 | — |
| 首页通告条 | 文本 + 开关 + 链接 | — | 单行，超 40 字强制截断 |
| 每屏强调色上限 | 固定为 2，不可调 | — | 写死在设计规范里 |

**实时预览**：面板右侧 `ThemePreviewCard` 用同一套 token 渲染一个迷你商品卡 + 迷你按钮 + 迷你价格，改任何一项立即重绘；底部 `保存并预览`（写入草稿 token 并让店面 `revalidateTag`）/ `恢复默认`（回到安装时的预设）。

### 13.3 哪些必须"代码不变、仅换变量"

1. **所有颜色**：组件只写 `bg-primary` / `text-muted-foreground` / `border-border`，不写 `bg-[#17171B]`。
2. **所有圆角**：只写 `rounded-md` / `rounded-lg`，不写 `rounded-[8px]`。`--radius` 改了，按钮/输入框/卡片全部跟随（因为都派生自它）。
3. **所有阴影**：只写 `shadow-sm/md/lg`。
4. **所有间距**：只写 `p-4` / `gap-6` 这类 token 映射类，不写 `p-[18px]`。
5. **所有字体**：只写 `font-sans` / `font-mono`，不写 `font-[Archivo]`。
6. **所有图标**：只从 `lucide-react` 具名导入 + `currentColor` 着色，不写死 `fill="#17171B"`。
7. **所有商品图容器**：只写 `aspect-product`（映射 `--product-ratio-primary`），不写 `aspect-[4/5]` 字面量。

**实现约束（写给架构师）**：后台换肤的落盘方式建议为「DB 存一份 token 覆盖表 → 服务端渲染时注入 `<style>:root{...}</style>`，或用 `@theme` 变量覆盖层 + `revalidateTag` 清理 CDN 缓存」。**不要**用 CSS-in-JS 运行时动态生成主题——会让 SSG/ISR 失效，直接冲击 LCP 预算。这条需架构师在 Spec 中确认（见 open questions）。

### 13.4 已知坑（务必转达前端）

1. **`--accent` 不是品牌色、不是强调橙**。shadcn/ui 里 `--accent` = hover/选中面（本项目映射到 `--neutral-50`）。品牌蓝是 `--primary`，橙色强调是 `--accent-orange`。三者混用会导致「按钮变灰」「hover 变橙」「促销价变灰」的翻车。
2. **Tailwind v4 vs v3 的透明度写法不同**。v4 用 hex + `color-mix()` 即可支持 `bg-background/40`；若降到 v3，token 必须改成裸 OKLCH 通道（`--background: 0.99 0 0;`）+ config 里 `oklch(var(--x) / <alpha-value>)`，否则 `/40` 静默失效。**改 Tailwind 大版本前必须先通知设计师**。
3. **`@theme inline` 必须用 `inline`**。不写 `inline` 会把值复制到工具类里，导致 `.dark` 与后台运行时覆盖穿透不了。
4. **中文回落的度量补偿**。字体 swap 期间 `PingFang SC` 与 Noto Sans SC 的 x-height 不同，必须配 `size-adjust`，否则 CLS 必爆。

---

## 14. 无障碍基线（A11y Baseline）

> 设计阶段只保证"可达成"，逐项审计在 Phase 3 的 `audit` 环节执行。

### 14.1 对比度

| 组合 | 比值 | 结论 |
|---|---|---|
| `--foreground` on `--background`（`#17171B` / `#FAFAFB`） | 17.1:1 | 达标 AAA |
| `--muted-foreground` on `--background`（`#71717F` / `#FAFAFB`） | 4.60:1 | 达标 AA（**这是下限，禁止再浅**） |
| `--primary-foreground` on `--primary`（白 / `#1666D9`） | 5.33:1 | 达标 AA |
| `--primary-hover` 白字（`#1454B4`） | 7.10:1 | 达标 AA |
| `--primary-active` 白字（`#124594`） | 9.11:1 | 达标 AAA |
| `--accent-orange-deep` on white（`#C2410C`） | 4.96:1 | 达标 AA（促销价文字） |
| `--accent-orange` on white（`#FF6B35`） | 2.83:1 | 注意：**连 3:1 大字都不过 → 仅非文本**；其上文字用 `--neutral-900` = 6.30:1 |
| `--gradient` 白字（`#5B8DEF`） | 3.23:1 | 注意：**仅装饰 / 大字号，禁止正文** |
| `--destructive` 白字（`#B91C1C`） | 6.47:1 | 达标 AA |
| `--success` 白字（`#15803D`） | 5.02:1 | 达标 AA |
| `--warning` 白字（`#B45309`） | 5.03:1 | 达标 AA |

**规则**：禁用态文字用 `opacity: 0.4` 时**不参与**对比度计算（禁用态豁免），但禁用态仍需可辨认——用 `--neutral-300` 而非纯透明。

### 14.2 焦点态（可访问性的唯一视觉契约）

- 全局 `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`，**任何组件不得设置 `outline: none`**。
- 焦点环同时给 `outline`（保证 Windows 高对比度模式下可见）+ 可选 `box-shadow` 增强，**不能只用 `box-shadow`**（Windows 强制颜色模式下会消失）。
- 深色底上焦点环用 `--ring`（深色下自动切 `--primary-300`）。
- 抽屉/Modal 打开时必须 `trapFocus`，关闭后焦点**回到触发元素**（照抄 Dawn 的时序：`transitionend` 之后才 trap）。

### 14.3 键盘路径（必测 6 条）

1. `Tab` 顺序 = 视觉顺序（DOM 顺序即视觉顺序，禁止用 `order` 改变视觉但不动 DOM）。
2. 跳转链：页面首个可聚焦元素是「跳到主内容」链接（`sr-only` + `focus` 时显现）。
3. 图库：`←`/`→` 切图，缩略图是可聚焦 `<button>` 且带 `aria-current="true"`。
4. 筛选 Sheet / 购物车抽屉：`Esc` 关闭；`Tab` 在内部循环；不可 `Tab` 到背景。
5. 结账步骤：`Enter` 提交当前步；步骤切换后焦点落到新步骤的 `h2`（`tabindex="-1"`）。
6. 表格（后台）：行内操作是真实 `<button>` 而非 `div`；批量勾选后有 `aria-live` 播报「已选 3 项」。

### 14.4 表单 label

- **每个输入框必须有可见 label**（`<label for>` 关联），**禁止只用 placeholder 当标签**（输入后标签消失，用户忘记在填什么）。
- 必填标记用 `--accent-orange-deep` 星号 + `aria-required="true"`，不只靠颜色。
- 辅助说明（helper text）在 label 下、输入框上，12px `--muted-foreground`。
- 错误用 `aria-invalid="true"` + `aria-describedby` 指向错误文案节点 + `aria-live="polite"` 区域。
- 字段组（如地址）用 `<fieldset>` + `<legend>`，不用 `<div>`。
- 手机号/邮编/验证码加 `inputmode="numeric"` 与 `autocomplete`（`tel` / `postal-code` / `one-time-code`），触屏出数字键盘。

### 14.5 其它硬约束

- 触摸目标 **≥44×44px**，相邻可点元素间距 **≥8px**（视觉尺寸可小于 44，用 `::before` 或 padding 外扩命中区）。
- 图标按钮必须 `aria-label`；装饰图标 `aria-hidden="true"`。
- 图片 `alt` 规则：商品图 = 商品标题 + 规格（`藏青 / M`），纯装饰图 `alt=""`，不用「图片」二字开头。
- 状态不能只靠颜色：库存紧张同时给文字「仅剩 2 件」；表单错误同时给文案 + 图标。
- `prefers-reduced-motion` 全局降级（已在 token 层实现）。
- 语言：`<html lang>` 随 locale 变化；`/{locale}/{channel}/` 切换时输出 `hreflang`。
- 页面 `viewport` 不禁用缩放（**禁止 `user-scalable=no`**）。

---

## 附录 A：页面 × 状态覆盖矩阵（9 态）

| 页面 / 组件 | Default | Hover | Focus | Active | Disabled | Loading | Error | Empty | Success |
|---|---|---|---|---|---|---|---|---|---|
| ProductCard | 有 | 有（图 1.02 缩放） | 有 | 有 | — | 有（骨架） | — | — | — |
| AddToCartButton | 有 | 有 | 有 | 有 | 有（售罄） | 有（Loader2） | 有（行下红字） | — | 有（抽屉） |
| VariantPicker | 有 | 有 | 有 | 有（选中边框） | 有（删除线） | — | — | — | — |
| QuantityStepper | 有 | 有 | 有 | 有 | 有（到 1 禁用减） | 有 | 有（库存红字） | — | — |
| CartDrawer | 关闭 | 有 | 有（焦点环） | 有 | — | 有（行骨架） | 有（顶部横幅） | 有（空态+推荐） | 有（撤销 Toast） |
| CheckoutStep | 有 | — | 有 | — | 有（未填前禁用下一步） | 有（跳转中） | 有（字段+横幅） | — | 有（完成勾） |
| DataTable（后台） | 有 | 有（行 hover） | 有（行焦点） | 有（勾选） | — | 有（行骨架） | 有（区块替换） | 有（空态） | 有（保存 Toast） |
| Input / Select | 有 | 有（边框加深） | 有（ring 3px） | — | 有（底色 `--muted`） | 有（右侧 spinner） | 有（红边+文案） | — | 有（右侧 Check） |

## 附录 B：三轴刻度说明

| 轴 | 值 | 具体表现 |
|---|---|---|
| **DESIGN_VARIANCE = 6** | 偏移式 | PDP 用 `7fr 5fr` 非对称；首页分类条 3 条横向编辑式图文而非九宫格；价格列右对齐成列；**移动端（<768px）全部回退单列** |
| **MOTION_INTENSITY = 3** | 功能性 | 只有 hover / 抽屉 / 步骤切换 / 乐观更新回滚四类；无入场动画；无装饰脉冲（骨架屏除外） |
| **VISUAL_DENSITY = 3（店面）/ 7（后台）** | 双档 | 店面走美术馆留白（区块 64–112px 节奏）；后台走驾驶舱（行高 52px、1px 分隔线、无卡片盒子），靠 `[data-surface="admin"]` 覆盖 token 实现，**不新增第二套颜色** |

---

**交付自检**：本文件不含 emoji 符号（全部替换为 `名称（Icon，尺寸）` 写法，状态列用「有 / 无 / 达标」文字）；不含紫→粉渐变；不含英文空泛欢迎句与假占位文案；不含裸色值（仅 `#FFFFFF` / `#000000` 例外，且实际未用纯黑）；首页明确禁止通用 Hero；图标库锁定 Lucide 并给出三档尺寸与描边规则。
