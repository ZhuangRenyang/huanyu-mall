# 商城 · 逐页设计提示词（Phase 2）

> 设计师：颜好看 | 日期：2026-11-08 | 版本：v1.0
> 上游契约：`docs/04-specs/SPEC.md` §7（13 页路由）、§8（Token）、§11（已知坑）
> 设计源：`docs/03-uiux/UIUX.md`（三轴刻度 / 结账流 / 动效 / 无障碍）+ `design-tokens.css`（机器真源）
> 本文件是 **Phase 3 前端逐页实现依据**，照此实现即可，不新增规格、不改架构。

---

## 0. 全局约定（所有页面共同遵守，不再逐页重复）

### 0.1 路由（以 Spec §7 为唯一依据，前缀 `/{locale}/{channel}` 一期 = `/zh-CN/cn`）

| # | 页面 | 路由 | 端 |
|---|---|---|---|
| 1 | 首页 | `/` | 前台 |
| 2 | 商品列表 PLP | `/products` | 前台 |
| 3 | 商品详情 PDP | `/products/{handle}` | 前台 |
| 4 | 购物车 | `/cart` | 前台 |
| 5 | 结账 | `/checkout` | 前台 |
| 6 | 支付结果 | `/checkout/result` | 前台 |
| 7 | 订单查询 | `/orders`（列表 + 详情） | 前台 |
| 8 | 账户 | `/account`（登录 / 地址簿） | 前台 |
| 9 | 404 | `*` | 前台 |
| 10 | 后台登录 | `/admin/login` | 后台 |
| 11 | 商品管理 | `/admin/products` | 后台 |
| 12 | 订单管理 | `/admin/orders` | 后台 |
| 13 | 设置 | `/admin/settings` | 后台 |

### 0.2 Token 引用规范（禁止硬编码 hex，仅 `#fff`/`#000` 例外）

所有颜色/圆角/间距/字号/动效必须走 `design-tokens.css` 暴露的 utility 或 CSS 变量。速查：

**颜色 utility（Tailwind v4，由 `@theme` 映射，前端直接写类名）**
| 用途 | utility |
|---|---|
| 页面底 / 卡片底 | `bg-background` / `bg-card` |
| 弱化面 / 次级面 | `bg-muted` / `bg-secondary` |
| 品牌蓝（主按钮/链接/选中） | `bg-primary`、`text-primary`、`bg-primary-subtle` |
| 主按钮文字 / 链接反白 | `text-primary-foreground` |
| 品牌蓝 hover / active | `bg-primary-hover`（即 `hover:bg-primary-hover`）、`bg-primary-active` |
| 强调橙（徽章底/圆点/装饰） | `bg-accent-orange`、`bg-accent-orange-subtle` |
| 促销价文字 | `text-accent-orange-deep` |
| 渐变（仅装饰/大字号） | `bg-gradient-to-br from-primary to-gradient` |
| 主文本 / 次级文本 | `text-foreground` / `text-muted-foreground` |
| 边框 / 强边框 / 输入框 | `border-border` / `border-border-strong` / `border-input` |
| 焦点环 | `ring-ring` |
| 语义色 | `text-destructive` / `text-success` / `text-warning` / `text-info` + `bg-*-subtle` |

**CSS 变量（组件/布局内联 `var()` 或读取）**
| 用途 | 变量 |
|---|---|
| 圆角 | `--radius-xs(4)` / `--radius-sm(6)` / `--radius-md(8)` / `--radius-lg(12)` / `--radius-xl(16)` |
| 间距 | `--space-1(4) … --space-24(96)`，4px 整数倍 |
| 字号 | `--text-xs … --text-5xl`、`--text-display`（clamp） |
| 固定栏高 | `--header-height` / `--bottom-bar-height` / `--chrome-offset` / `--safe-area-bottom` |
| 动效 | `--motion-duration-fast(150)` / `base(200)` / `slow(300)`、`--motion-ease-standard` / `emphasized` / `exit` |
| 层级 | `--z-sticky(30)` / `--z-drawer(50)` / `--z-modal(50)` / `--z-toast(60)` |

**对应 utility 快捷写法**：圆角 `rounded-md`；间距 `p-4` `gap-6`；字号 `text-base` `text-xl`；动效 `duration-150` `ease-standard`。

### 0.3 复用组件（M18 可嵌入 + 通用原子）

**M18 三个可嵌入组件（只接 props，不写业务逻辑，换任何店面模板都能挂载）**
| 组件 | props 约定 | 复用位置 |
|---|---|---|
| `CartDrawer` | `open` `onClose` `items` `subtotal` `onQuantityChange(id,qty)` `onRemove(id)` `onCheckout` | 全局（首页/PLP/PDP/购物车页共用一套） |
| `ProductGallery` | `images[]` `aspectRatio`（默认 4:5）`priority`（首图预加载） | PDP |
| `VariantPicker` | `options` `value` `onChange` `stockMap` `disabledKeys` | PDP |

**通用原子（shadcn 风格，全项目一套）**：`Button`（variant=primary/secondary/ghost/destructive，size=sm/md/lg，均含 default/hover/focus/active/disabled/loading 6 态）、`Input`、`Select`、`Badge`、`IconButton`（44×44 触摸区）、`Skeleton`、`Toast`、`Sheet`（抽屉/底部动作面板）、`Modal`、`FocusModal`（后台集中任务）、`QuantityStepper`、`Price`（现价/划线原价/促销档）、`StatusPill`、`EmptyState`、`Breadcrumb`、`Pagination`、`Tabs`。

### 0.4 通用规则

- **图标**：一律 lucide-react 具名导入，`size-4(16)/size-5(20)/size-6(24)`，`strokeWidth` 16px 用 1.75、20/24px 用 2。装饰图标 `aria-hidden`，可操作图标按钮给 `aria-label`。禁 emoji。
- **状态命名**：每个有状态区块必须覆盖 loading（骨架屏，形状逐像素模仿真实布局）/ empty（实义文案 + 二次转化位）/ error（具体原因 + 重试）/ populated。
- **动效**：hover/焦点 150ms、抽屉/下拉/Toast 200ms、步骤切换 300ms，只动 `transform`/`opacity`，禁 `width/height` 动画，禁弹跳缓动。
- **焦点**：全局 `:focus-visible` 2px `ring-ring` + `outline-offset: 2`，任何组件不得 `outline:none`。
- **文案**：空态/错误态必须说清「现在什么情况 + 用户能做什么」，禁止「操作失败」「暂无数据」这类空话。
- **移动优先**：先写 <640px 布局，再 `sm/md/lg` 增强；触摸目标 ≥44×44，相邻可点间距 ≥8px。

---

## 1. 首页 `/`

**页面目标**：3 秒内让访客看到可买的商品并进入分类，首屏零 Hero。

**区块布局（自上而下）**
- 移动（<640，单列）：通告条（可选，单行可关）→ Header 56px（Logo / 搜索图标 / 购物车图标，分类进汉堡 `Menu`）→ 商品网格首屏（2 列，`gap-3`，≥4 个真实商品）→ 分类入口（3 条横向滚动 snap 图文条）→ 商品瀑布（2 列）→ 服务承诺条（3 项横排：正品/直邮/7 天可退）→ Footer 手风琴。
- 桌面（≥1024）：通告条 → Header 64px（Logo / 内联分类导航 / 搜索框 / 账户 / 购物车）→ 商品网格（4 列，`--container-content` 1280px 内 `gap-6`）→ 分类入口（3 条横向图文条，`16:9`）→ 商品瀑布（4 列）→ 服务承诺条 → Footer 多列。
- **首屏硬约束**：无 Hero。首屏纵向预算内必须出现 ≥4 个商品（真实图 + 真实价 + 标题）。允许顶部 3:1 活动横条但高 ≤120px（移动 ≤88px），其下立刻接商品网格。

**关键组件**：`ProductCard`（图 4:5 `object-cover` 居中裁切 + 标题 2 行 `line-clamp-2-safe` + 价格 `tabular` + 促销角标）、`SectionHeader`（标题 + 「查看全部」`ChevronRight`）、`AnnouncementBar`、`Header`、`Footer`、`TrustBar`、`CategoryStrip`、`ProductGridSkeleton`。

**状态矩阵**
| 状态 | 表现 |
|---|---|
| loading | 商品网格骨架屏（`--skeleton-delay: 300ms` 后出现，4/2 列同布局同高，防 CLS） |
| empty（无商品） | `EmptyState`：`还没有上架商品` + `商品正在筹备中，稍后再来看看`，不放假按钮 |
| error | 区块级替换：`加载失败` + `网络似乎不稳定` + `重试` 按钮（`RefreshCw` size-4） |
| populated | 商品网格 + 瀑布 |

**交互细节**：首屏图不懒加载（`priority` + `fetchpriority=high`）；第二屏起 `loading=lazy`；商品卡 hover 图 `scale(1.02)` 150ms；加购走全局 `CartDrawer`（乐观更新，见 §4）。

**Token 引用**：底色 `bg-background`；Header `bg-card` + `border-b border-border`；价格 `text-foreground`，促销价 `text-accent-orange-deep`；角标 `bg-accent-orange` + `text-accent-orange-foreground`（近黑字）；承诺条图标 `text-muted-foreground`；标题 `text-2xl`（移动 `text-xl`）；网格间距 `gap-3`(移动)/`gap-6`(桌面)；卡片圆角 `rounded-lg`。

**无障碍**：搜索/购物车/汉堡 `IconButton` 带 `aria-label`；商品卡标题是链接（`<a>` 可聚焦）；装饰图 `alt` 空、商品图 `alt`=标题；导航菜单键盘可达；Header 吸顶时 `scroll-padding-top: --chrome-offset`。

---

## 2. 商品列表 PLP `/products`（含搜索 `/products?q=` 复用）

**页面目标**：快速找到商品并筛选，兜住搜索流量。

**区块布局**
- 移动：面包屑（只显上一级）→ 标题「全部商品（N 件）」→ 吸顶工具条（筛选 `SlidersHorizontal` + 排序 `ArrowUpDown` 两按钮 + 已选 chips）→ 商品网格 2 列 → 「加载更多」按钮。
- 桌面：面包屑 → 标题 → 左 240px 筛选侧栏 + 右商品网格 4 列 → 分页（`Pagination`）。
- 筛选形态：桌面左侧栏（可折叠分组，复选 + 价格区间）；移动底部 `Sheet`（`--radius-xl` 上沿 + 吸底「查看 N 件商品」按钮）+ 顶部 chips 可单个删除（`X` size-3）。
- 空态：`这个筛选条件下暂时没有商品` + `试着放宽价格或去掉一个条件` + `清除筛选` 按钮 + 3 个推荐商品。

**关键组件**：`FilterSidebar`、`FilterSheet`、`SortSelect`、`ActiveFilterChips`、`ProductCard`、`ProductGridSkeleton`、`Pagination`、`SearchBox`（`Search` size-5 前缀）。

**状态矩阵**：loading=骨架屏（同布局）；empty（无结果）= 上述空态；error=区块替换+重试；populated=网格。

**交互细节**：排序/筛选切换用 `useOptimistic` 立即刷新，防抖 300ms（搜索输入）；切换时列表 `opacity` 淡出 150ms 不跳布局；筛选值同步 URL query（可分享/回退保留）；移动筛选 Sheet 打开时 `body.overflow-hidden` + `Esc` 关闭 + 焦点回到筛选按钮。

**Token 引用**：工具条 `bg-background` 吸顶 + 滚动后 `border-b border-border`；chips `bg-muted` + `rounded-full`；价格同上；筛选侧栏 `bg-card` + `border-r border-border`；主按钮 `bg-primary text-primary-foreground`。

**无障碍**：筛选分组是 `<fieldset>` + `<legend>`；复选 `aria-checked`；「查看 N 件」按钮 `aria-live` 播报数量变化；搜索框 `aria-label` + `inputmode=search`。

---

## 3. 商品详情 PDP `/products/{handle}`

**页面目标**：让用户在最短路径内选对规格并加购。

**区块布局**
- 移动（单列）：图库（横向 snap 轮播 + 「1/6」计数，4:5）→ 标题 `text-3xl` → 价格区 → `VariantPicker` → 库存时效（`Truck` + `ShieldCheck` 两行 size-4）→ 跨境信息（清关时效/税费）→ 描述（富文本，默认展开）→ 参数表（折叠）→ 相关推荐 → **吸底条**（`--bottom-bar-height` 72px + `--safe-area-bottom`：左侧价格，右侧「加入购物车」）。
- 桌面（≥1024，非对称 `grid-cols-[7fr_5fr]`）：左 `ProductGallery`（4:5 主图 + 缩略图条，`sticky top: --chrome-offset`）→ 右侧信息栏（标题 / 价格 / 规格 / 库存时效 / 加购 + 立即购买 / 跨境信息）→ 下方描述 + 参数表（`--container-prose`）→ 相关推荐（4 列）。

**关键组件**（复用 M18 两个）：`ProductGallery`（`images[]` `aspectRatio=4:5` `priority=true`；缩略图 `<button>` + `aria-current`；键盘 `←/→` 切图）、`VariantPicker`（swatch 44×44；`stockMap` 决定禁用态；`disabledKeys` 渲染删除线 + `aria-disabled`）、`QuantityStepper`、`PriceBlock`、`AddToCartBar`、`TrustRow`、`SkuSpecTable`。

**规格选择器联动（variant 级）**：选规格 → 价格/库存/图即时切换（`useOptimistic`）；某规格售罄 → 该按钮删除线 + `--muted-foreground` + 点击在按钮下出现 14px `text-destructive`「该规格已售罄，试试其他尺码」，不弹 Toast；未选规格点加购 → 滚动到规格区 + `ring-ring` 高亮 + 文案「请先选择规格」。

**状态矩阵**：loading=图库骨架（4:5 同高）+ 标题行骨架；error=图位 `ImageOff` size-6 + `图片加载失败` + 重试；empty（无变体）= 不加购按钮，显示「暂时缺货」`StatusPill`；populated=正常。

**交互细节**：加购乐观更新（0ms 购物车数字 +1 + 抽屉滑入 200ms）；立即购买跳 `/checkout`；库存变化在价格下 `text-warning` 提示「仅剩 N 件」；加购按钮 6 态（含 loading=`Loader2` size-5 旋转 + 「加入中…」）。

**Token 引用**：价格现价 `text-xl text-foreground tabular`，促销价 `text-accent-orange-deep`，划线原价 `text-muted-foreground line-through`；主按钮 `bg-primary text-primary-foreground rounded-md h-11`；吸底条 `bg-card border-t border-border`；售罄态 `text-muted-foreground line-through`。

**无障碍**：图库缩略图 `<button>` + `aria-current="true"`；规格是 radio group（`role=radiogroup`）；价格/库存变化用 `aria-live="polite"` 播报；商品图 `alt` = 标题 + 规格。

---

## 4. 购物车 `/cart`（含全局抽屉）

**页面目标**：编辑数量/删除，导向结算，减弃购。

**区块布局**
- 移动（单列）：标题「购物车（3）」→ 商品行列表 → 优惠码位（留位不实现）→ 小计 + 运费说明 → 吸底条（总额 + 「去结算」）。
- 桌面（`grid-cols-[8fr_4fr]`）：左商品明细 / 右 `OrderSummaryCard`（sticky，小计/运费/税/总计 + 去结算）。

**关键组件**（复用 M18 `CartDrawer` 为全局加购反馈）：`CartLineItem`（1:1 图 64px + 标题 2 行 + 规格 + `QuantityStepper` + 单价 + `Trash2` size-5）、`OrderSummaryCard`、`FreeShippingProgress`（进度条用 `bg-primary`，仅此一处）、`PromoCodeInput`（disabled，占位）。

**购物车抽屉交互契约（全局触发，从任何页面加购打开）**：触发图标 `role="button"` + `aria-haspopup="dialog"`；`Esc` 关闭；点遮罩关闭；`transitionend` 后 `trapFocus`；关闭后焦点回触发图标；桌面宽 440px、移动 `calc(100vw - 48px)`；`translateX(100%)→0` 200ms `--motion-ease-emphasized`；遮罩 `rgba(23,23,27,0.5)` 淡入。

**状态矩阵**：loading=行骨架（64px 图 + 两行文字）；empty=`购物车还是空的` + `看看本周新到的商品，满 ¥199 免运费` + `去逛逛` + 4 推荐；error（改量失败）= 行下方红字 + 回退；populated=明细。

**交互细节（乐观更新 + 回滚）**：数量步进立即改数字 → 失败回退原值 + 行下 `text-destructive`「库存仅剩 N 件」（3s 自动消失 + `aria-live`）；删除立即移除 + Toast `已从购物车移除 商品名` +「撤销」（5s，撤销=真回滚）；金额变更 `tabular` 无跳动。

**Token 引用**：行分隔 `divide-y divide-border`；缩略图 `rounded-sm`；总额 `text-xl tabular`；去结算 `bg-primary text-primary-foreground h-11`；进度条轨道 `bg-muted`、填充 `bg-primary`。

**无障碍**：数量步进 `<button>` 44×44 + `aria-label="增加/减少数量"`；删除 `aria-label="移除 商品名"`；合计区 `aria-live="polite"`；抽屉标题 `h2`。

---

## 5. 结账 `/checkout`（移动优先，4 步）

**页面目标**：4 步完成下单，单步 ≤4 字段，游客可下单。

**通用框架**
- 步骤头吸顶（`--header-height`）：4 步点 + 进度线，当前步实心 `bg-primary`、完成步 `Check` size-4、未达步 `--neutral-300`。
- 操作吸底（移动）：高 52px 全宽主按钮 + 左侧「返回」`IconButton`（`ArrowLeft` size-6 44×44）；按钮文字带金额（如「微信支付 ¥199.00」）。
- 桌面：左 `8fr` 表单 / 右 `4fr` 只读订单摘要（sticky）。
- 校验时机：字段 `blur` 单字段校验 → 点「下一步」整步校验并聚焦第一个错误；**不在输入中实时报错**。
- 错误位置：字段错误 = 输入框下 14px `text-destructive` + 输入框 `border-destructive`；整步错误 = 吸底条上方 `bg-destructive-subtle` 横幅 +「去修改」锚点。
- 数据持久化 `sessionStorage`，返回不丢，刷新回填；任何金额变更在摘要高亮闪一下（`bg-warning-subtle` → 透明 150ms）。

**步骤 1 联系方式**
| 字段 | 必填 | 校验 | 组件 |
|---|---|---|---|
| 手机号 | 是（软标识，不验证） | `1[3-9]\d{9}` | `Input type=tel inputmode=numeric autocomplete=tel` |
| 邮箱 | 否 | `type=email` | `Input type=email` |
| 验证码 | 条件（后台启用短信后变必填，默认隐藏） | 6 位，60s 重发倒计时在按钮上 | `Input inputmode=numeric autocomplete=one-time-code` + 发送按钮 |
> 游客下单：本步无注册门槛，手机号仅软标识（Spec §3 明确短信验证码不做一期）。

**步骤 2 收货地址**
| 字段 | 必填 | 校验 |
|---|---|---|
| 收件人 | 是 | 1–30 字符 |
| 国家/地区 | 是 | `Select` 默认 Channel 绑定国家；改国家重算运费税 |
| 省/市/区 | 是 | 三级原生 `Select`（不做级联动画） |
| 详细地址 | 是 | 5–200 字符 `textarea` 2 行 |
| 邮编 | 视国家 | 中国 6 位数字 |
| 身份证号 | 跨境必填 | 18 位末位可 X；**必须显示** `Info` size-4 + 12px `text-muted-foreground`「用于海关清关，不会用于其他用途」 |

「保存为常用地址」复选框在末尾。

**步骤 3 配送方式**
- 单选卡片列表：承运商 + 时效（「7–12 个工作日」）+ 运费（免运费显示 `免运费` 不显示 ¥0.00）+ 右侧 radio。
- 选中态：`border-primary` 1px + `bg-muted`，不用彩色。
- 空态：`当前地址暂不支持配送` + `更换地址` 按钮。
- loading：3 个 72px 骨架卡（`--skeleton-delay` 后出现）。
- 切换配送方式 → 运费/总额 `tabular` 滚动（150ms）。

**步骤 4 支付方式 + 确认**
- 支付分组（`GET payment-providers` 按 Channel+地区过滤，无可用项整组不渲染 + 一行说明）：`微信支付`（官方品牌 SVG 24px）/ `支付宝` / `Stripe` / `PayPal`，各 1 行 radio 卡，选中后展开说明（如「将跳转至微信完成支付」）。
- 折叠订单摘要（可展开）：商品行 + 小计 + 运费 + 税 + 总计。
- 主 CTA 文案随方式变：`微信支付 ¥199.00`。
- 提交中：按钮 `Loader2` 旋转 + 「正在跳转…」+ 全表单 `pointer-events-none`；15s 未跳转 →「支付页面加载失败，重试 / 换个方式」。

**状态矩阵**（全流程）：loading=各步骨架/按钮 loading；error=字段下红字 / 整步横幅 / 15s 超时；empty=配送无可用方式；success=跳转支付或进结果页。

**Token 引用**：步骤点 `bg-primary`/`bg-muted`；字段 label `text-sm font-medium`；必填星号 `text-accent-orange-deep`；错误 `text-destructive border-destructive`；吸底 `bg-card border-t border-border`；主按钮 `bg-primary text-primary-foreground h-[52px] rounded-md`。

**无障碍**：每步 `<fieldset>`+`<legend>`；步骤切换后焦点落新步 `h2`（`tabindex=-1`）；错误 `aria-invalid` + `aria-describedby` + `aria-live`；支付方式 radio group；键盘 `Enter` 提交当前步。

---

## 6. 支付结果 `/checkout/result`

**页面目标**：三种结果态明确呈现，**可重入不丢状态**。

**区块布局（单列，`--container-narrow` 896px 居中）**：状态图标 48px → 标题 → 订单号（`tabular` + `Copy` size-4）→ 金额 `text-display` → 主按钮 + 次按钮 → 预计发货时间 → 订单摘要卡。

**三态（用 URL 参数或子路由区分，刷新保持）**
| 态 | 图标 | 文案 | 操作 |
|---|---|---|---|
| 成功 | `CircleCheck` 48px `text-success` | `订单已支付` + 预计发货时间 | `查看订单`（主）+ `继续购物`（次） |
| 处理中 | `Loader2` 48px 旋转 | `正在确认支付结果` + `每 3 秒自动刷新，也可以手动刷新` | `手动刷新` |
| 失败 | `CircleX` 48px `text-destructive` | 具体原因（如 `银行卡余额不足`/`支付超时`）+ **订单号常显** | `重新支付`（主）+ `联系客服`（次） |

**可重入**：回调超时后用户关页再回 `/checkout/result?order={id}`，用 `GET orders/{id}` 幂等拉最新状态，不依赖本地状态；处理中态定时轮询（3s），成功后自动切成功态（不做整页跳白）。

**Token 引用**：成功 `text-success`、失败 `text-destructive`、处理中 `text-info`；订单号 `font-mono tabular`；金额 `text-display tabular`；主按钮 `bg-primary text-primary-foreground`。

**无障碍**：状态切换 `aria-live="polite"` 播报「支付已确认」；订单号复制按钮 `aria-label="复制订单号"`。

---

## 7. 订单查询 `/orders`（列表 + 详情）

**页面目标**：免登录查单（单号 + 手机后四位/邮箱），登录用户看全量订单。

**区块布局**
- 移动：标题「订单查询」→ 查询表单（`--container-narrow` 居中，2 字段）或 订单列表 → 订单详情（时间轴 4 点横向 + 商品行 + 金额明细折叠 + 地址 + 物流单号）。
- 桌面：同单列；详情两栏（左 8 商品/金额，右 4 地址/物流）。

**关键组件**：`OrderTimeline`（已下单→已付款→已发货→已签收 4 步，当前步 `bg-primary` 圆点）、`OrderLineItem`、`AmountBreakdown`、`AddressBlock`、`CopyableCode`（物流单号 `Copy` + `ExternalLink` size-4）。

**状态矩阵**：loading=行骨架；empty=`还没有订单` + `下单后可以在这里查物流` + `去逛逛`；error=查单失败「单号或手机号不匹配」`text-destructive`；populated=时间轴 + 明细。

**交互细节**：物流单号 `Copy` 点击 150ms 反馈 + Toast `已复制`；外部物流链接 `ExternalLink` 新开窗；游客查单与登录查单同一详情组件复用。

**Token 引用**：时间轴当前步 `bg-primary`、完成步 `text-success`、未达步 `bg-muted`；单号 `font-mono tabular`；卡片 `bg-card border border-border rounded-lg`。

**无障碍**：时间轴 `role="list"` + 每步 `aria-current`；金额明细折叠按钮 `aria-expanded`。

---

## 8. 账户 `/account`（登录 / 订单列表 / 地址簿）

**页面目标**：登录、管理订单与地址。

**区块布局（单列，`--container-narrow`）**
- 登录：手机号（软标识）+ 邮箱/密码二选一（Auth Provider 待定）；验证码条件字段（依赖短信服务商，未配置隐藏）；「登录」主按钮。
- 订单列表：状态 Tab（全部/待付款/待发货/已发货/已完成，横向滚动）+ 订单卡（单号 + 时间 + 2 缩略图 + 总额 + 主操作）。
- 地址簿：卡片列表 +「新增地址」；地址表单分两屏（收件人+电话 / 地址明细），单屏字段 ≤4。

**关键组件**：`AuthForm`、`OrderCard`、`AddressCard`、`AddressForm`、`Tabs`。

**状态矩阵**：loading=表单骨架；empty=`还没有收货地址` + `添加后结账会更快` + `新增地址`；error=登录失败字段下 `text-destructive`（连续 3 次出现图形验证码位预留）；populated=列表。

**Token 引用**：Tab 激活 `border-b-2 border-primary text-primary`；地址卡 `bg-card border border-border rounded-lg`；主按钮 `bg-primary text-primary-foreground`。

**无障碍**：表单全部可见 label；地址 `autocomplete`（`name`/`tel`/`street-address`/`postal-code`）；订单 Tab `role="tablist"`。

---

## 9. 404 `*`

**页面目标**：把错误页变成二次转化位。

**区块布局（单列居中，`--container-narrow`）**：`ImageOff` size-6 `text-muted-foreground` → `这个页面不见了` → `链接可能已失效，或者商品已经下架` → 主按钮 `回到首页` + 次按钮（含搜索框）→ 4 个推荐商品。

**Token 引用**：图标 `text-muted-foreground`；主按钮 `bg-primary text-primary-foreground`；推荐商品卡同 `ProductCard`。

**无障碍**：标题是 `h1`；搜索框 `aria-label`。

---

## 10. 后台登录 `/admin/login`

**页面目标**：管理员安全登录。

**区块布局（居中卡片，`--container-narrow` 内 400px）**：Logo → `登录管理后台` → 邮箱 `Input` → 密码 `Input`（`Eye`/`EyeOff` size-5 切换）→ 记住我 → 登录按钮。

**关键组件**：`AuthForm`（后台版）、`Input`（密码态）。

**状态矩阵**：loading=按钮 `Loader2` + 「登录中…」；error=字段下 14px `text-destructive`（连续 3 次失败出现图形验证码位预留）；populated=跳转 `/admin/products`。

**Token 引用**：卡片 `bg-card border border-border rounded-xl shadow-lg`；主按钮 `bg-primary text-primary-foreground`；`--radius-xl(16)` 用于登录卡。

**无障碍**：密码可见切换 `aria-label` + `aria-pressed`；不显示「默认账号 admin/admin」提示（安全）。

---

## 11. 商品管理 `/admin/products`（后台，Medusa Admin 形态）

**页面目标**：商品 + 变体 + 定价 + 库存的集中管理，禁 ERP 密集表格。

**区块布局**
- 后台框架：左侧 Sidebar 240px 可折叠（`LayoutDashboard`/`Package`/`ClipboardList`/`Users`/`Settings`，当前项 `bg-sidebar-accent` + 左 2px `bg-primary` 竖条）；主区 `[data-surface="admin"]`（密度 7：正文 `text-sm`、`--radius:6px`、区块节奏收紧）。
- 列表（**不用卡片盒子**）：表头 `bg-muted` 40px；行高 52px，行间 1px `divide-y divide-border`；列：勾选框 / 缩略图 1:1 40px / 标题 2 行截断 / SKU `font-mono` / 价格 `tabular` / 库存 / 状态 `StatusPill` / 操作；勾选后批量操作条从表头滑出（`bg-primary-subtle`）。
- 新建/编辑：右侧 `Sheet` 560px 两段式（基本信息 / 价格库存），底部固定操作条；**变体 + 定价 + 库存三联动**（改定价即时更新变体行、改库存即时更新库存行）。

**关键组件**：`DataTable`（筛选/排序/分页内建）、`StatusBadge`、`Sheet`、`BulkActionBar`、`EmptyState`、`VariantEditor`（三联动核心）、`PriceInput`（`font-mono` + 币种前缀）、`InventoryInput`。

**状态矩阵**：loading=表格行骨架（52px 行高同布局）；empty=`还没有商品` + `上传第一个商品，或者从 Excel 批量导入` + `新建商品`（主）+ `批量导入`（次）；error=保存失败 `Sheet` 内横幅 `bg-destructive-subtle` + 重试；populated=表格。

**交互细节**：新建/编辑不跳页（`Sheet`）；删除走 `FocusModal` 二次确认；批量改价 `FocusModal` 集中任务；保存 `Loader2` + Toast `已保存`；危险操作红色 `text-destructive`。

**Token 引用**：表头 `bg-muted`；行 `divide-y divide-border`；选中行 `bg-primary-subtle`；主按钮 `bg-primary text-primary-foreground`；状态徽章 `StatusPill`（上架 `bg-success-subtle text-success`、下架 `bg-muted text-muted-foreground`、缺货 `bg-warning-subtle text-warning`）。

**无障碍**：表格 `<table>` + `<th scope>`；勾选 `aria-checked`；行内操作真实 `<button>`；批量操作 `aria-live` 播报「已选 3 项」。

---

## 12. 订单管理 `/admin/orders`（后台）

**页面目标**：订单查询、发货、全额退款入口。

**区块布局**
- 列表（密度 7，同 §11）：列：订单号 `font-mono` / 客户 / 时间 / 商品数 / 金额 `tabular` / 支付状态 `StatusPill` / 履约状态 / 操作。
- 详情：左 8（商品行 + 金额明细 + `OrderTimeline`）/ 右 4（客户卡 + 地址卡 + 支付信息 + 操作区）；操作区右下浮动（发货 / 退款 / 取消）；退款二次确认 `FocusModal` 要求输入订单号后四位。

**关键组件**：`OrderStatusPill`、`FulfillmentForm`（`Sheet`，手填承运商+单号，对应 Spec §5 `admin/fulfillments/{id}/shipments`）、`RefundModal`（一期只全额，`admin/orders/{id}/refunds`）、`Timeline`、`AmountBreakdown`。

**状态矩阵**：loading=行骨架；empty=`还没有订单` + `订单产生后会自动出现在这里`（无假按钮）；error=发货/退款失败时横幅 `bg-destructive-subtle` 带具体原因（如 `退款调用支付 Provider 失败，请重试`）+ 重试按钮；populated=列表/详情。

**交互细节**：发货 `FulfillmentForm` 保存 → Toast + 订单态 `已发货`；退款 `FocusModal` 输入后四位 + 确认 → 回调支付 Provider → Toast；危险操作 `text-destructive`。

**Token 引用**：支付状态（已支付 `text-success`、待支付 `text-warning`、已退款 `text-muted-foreground`）；履约状态（待发货 `text-warning`、已发货 `text-info`、已完成 `text-success`）；操作按钮 `bg-primary text-primary-foreground`。

**无障碍**：状态不只用颜色（`StatusPill` 带文字）；退款确认输入 `aria-describedby` 说明「输入订单号后四位以确认」。

---

## 13. 设置 `/admin/settings`（后台）

**页面目标**：店铺信息 + 设计变量（换肤）+ 支付 Provider 配置。

**区块布局**
- 分组 Tab：店铺信息 / **外观（换肤）** / 支付方式 / 配送与运费 / 税务 / 币种与市场 / 通知。
- 外观面板（换肤核心，对应 Spec §5 `admin/settings/theme`）：每个可调项右侧实时预览 `ThemePreviewCard`（迷你商品卡 + 迷你按钮 + 迷你价格）；底部 `保存并预览` + `恢复默认`。

**可调项（Spec §8 + UIUX §13.2）**
| 项 | 控件 | 取值 |
|---|---|---|
| 品牌主色 | 色板 8 选 1（活力蓝/墨绿/藏蓝/砖红/橄榄/深棕/石墨/砂岩） | 8 选 1，自动生成蓝阶 + 联动橙阶 |
| 字体预设 | 单选 + 预览图 | 3 套（中英混排校验） |
| 圆角 | 滑杆 | 4/6/8/10/12 |
| 阴影强度 | 单选 | 无/轻/中 |
| Logo | 上传 | SVG/PNG 明暗两版，高 ≤40px |
| 商品图比例 | 单选 | 1:1/4:5/3:4 |
| 字阶与间距 | 单选 | 舒适/标准/紧凑 |
| 首页通告条 | 文本 + 开关 | 单行 ≤40 字 |

- 支付方式面板：四家 Provider（微信/支付宝/Stripe/PayPal）各 1 行，填密钥 + 启用开关，对应 Spec §5 `admin/settings/payment-providers/{id}`。

**关键组件**：`SettingsTabs`、`ColorPickerField`（限色板，不给自由十六进制）、`RadiusSlider`、`AspectRatioRadio`、`ThemePreviewCard`、`DangerZone`。

**状态矩阵**：loading=保存中 `Loader2`；error=保存失败 Toast；empty=无；populated=表单。

**交互细节**：改任何项实时重绘预览（不保存）；`保存并预览` 写入草稿 token + `revalidateTag` 清缓存 + Toast；`恢复默认` 二次确认；危险操作在 `DangerZone` 分组。

**Token 引用**：预览卡 `bg-card border border-border rounded-lg`；主按钮 `bg-primary text-primary-foreground`；保存按钮 `Loader2` loading 态。

**无障碍**：每个可调项 `label` 关联控件；色板 swatch `aria-label`（颜色名）+ `aria-pressed`；滑杆 `aria-valuemin/max/now`。

---

## 附：页面 × M18 复用对照（防重复造轮子）

| 复用组件 | 被哪些页面复用 |
|---|---|
| `CartDrawer`（M18） | 首页 / PLP / PDP / 购物车页（全局触发） |
| `ProductGallery`（M18） | 仅 PDP |
| `VariantPicker`（M18） | 仅 PDP |
| `ProductCard` | 首页 / PLP / 404 / 空态推荐 |
| `EmptyState` | 全部有列表的页面 |
| `Skeleton`（+ `--skeleton-delay`） | 全部有异步区块的页面 |
| `OrderTimeline` | 前台订单详情 / 后台订单详情 |
| `AmountBreakdown` | 购物车 / 结账摘要 / 订单详情（前后台） |
| `StatusPill` | 后台商品 / 订单 / 设置 |

---

**自检**：本文件全部颜色走 token（utility 或 CSS 变量），无硬编码 hex；无 emoji 图标（图标全部 lucide 具名 + size）；无通用 Hero（§1 首页首屏直接商品网格）；无空洞文案（空态/错误态均实义）；13 页与 Spec §7 路由 1:1。
