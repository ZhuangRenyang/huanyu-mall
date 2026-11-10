/**
 * surfaces.ts —— 视觉快照的「表面清单」：迁移前基线 vs 迁移后现状。
 *
 * 基线是**抄录**的迁移前类名清单（仓库无 git 历史，取不到历史快照），每条带出处行号；
 * expected 里登记的是「允许存在且已复核过」的差异，脚本据此判定门禁是否通过。
 */

export interface Surface {
  id: string;
  /** 该表面对应的页面（用于报告分组） */
  page: string;
  /** 迁移前的类名清单（基线，抄录自迁移前的源码） */
  before: string;
  /** 迁移后的类名清单（现状） */
  after: string;
  /** 基线出处（文件:行），便于复核 */
  source: string;
  /** 已登记的差异：属性 → 说明（登记过 = 允许存在） */
  expected?: Record<string, string>;
  /** 该表面是否整体重设计（true = 不做逐属性比对，只记录事实） */
  redesigned?: boolean;
  /** 对比时取「迁移前」的哪个变体分组（默认 base） */
  beforeVariant?: string;
  /** 对比时取「迁移后」的哪个变体分组（默认 base） */
  afterVariant?: string;
}

export const SURFACES: Surface[] = [
  {
    id: 'dialog-overlay',
    page: 'admin-orders / admin-products',
    before: 'absolute inset-0 bg-neutral-900/40',
    after: 'fixed inset-0 z-[var(--z-modal)] bg-neutral-900/40',
    source: '迁移前 apps/admin/src/components/focus-modal.tsx:32',
    expected: {
      position:
        '旧实现是 absolute 挂在 p-4 容器里，新实现是 Radix Portal 的 fixed 全屏遮罩 —— 覆盖范围相同（都是视口），定位方式不同',
      'z-index': '旧实现的层级在包裹容器上，新实现在遮罩自身 —— 同一令牌（--z-modal = 50），层级一致',
    },
  },
  {
    id: 'dialog-panel',
    page: 'admin-orders / admin-products',
    before: 'relative w-full max-w-md rounded-xl bg-card p-5 shadow-lg',
    after:
      'fixed top-1/2 left-1/2 z-[var(--z-modal)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-5 text-card-foreground shadow-lg',
    source: '迁移前 apps/admin/src/components/focus-modal.tsx:33',
    expected: {
      position: '旧实现靠 grid place-items-center 居中，新实现靠 fixed + translate 居中 —— 最终位置等价',
      top: '居中锚点不同（50% vs 容器居中），最终视觉位置等价',
      left: '同上',
      width: '旧实现 w-full 是在 p-4（左右各 16px）容器里，实际宽 = 视口 - 32px；新实现直接写 calc(100% - 2rem) —— 等价',
      transform: '居中位移方式不同，位移量等价（各 -50%）',
      translate: '同上（Tailwind v4 的 translate 合成属性）',
      '--tw-translate-x': '同上',
      '--tw-translate-y': '同上',
      'z-index': '旧实现的层级在包裹容器上（z-[var(--z-modal)]），新实现在弹层自身 —— 同一令牌，层级一致',
      color: '新增 text-card-foreground：card-foreground 与 foreground 同为 #17171B，等价',
    },
  },
  {
    id: 'dialog-footer',
    page: 'admin-orders',
    before: 'mt-5 flex justify-end gap-2',
    after: 'mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
    source: '迁移前 apps/admin/src/components/focus-modal.tsx:42',
    expected: {
      'flex-direction': 'shadcn 默认在 <640px 纵向堆叠，后台为桌面端（≥sm）实际渲染仍是横向一行',
      'justify-content': '旧实现始终右对齐，新实现只在 sm 断点右对齐（移动端纵向堆叠时左对齐更合理）',
    },
  },
  {
    id: 'dialog-title',
    page: 'admin-orders',
    before: 'text-base font-semibold text-foreground',
    after: 'text-base font-semibold text-foreground',
    source: '迁移前 apps/admin/src/components/focus-modal.tsx:35',
  },
  {
    id: 'dialog-close',
    page: 'admin-orders / admin-products',
    before:
      'grid place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground size-11',
    after:
      'absolute right-2 top-2 grid size-11 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    source: '迁移前 apps/admin/src/components/focus-modal.tsx:36（IconButton size=md）',
    expected: {
      position:
        '旧实现是标题行里的 flex 子项（justify-between 推到最右），新实现是右上角绝对定位 —— 位置不同，尺寸/颜色/悬停态一致',
      top: '旧实现与标题同行垂直居中，新实现贴顶（top-2）',
      right: '旧实现距面板右边 20px（p-5 内边距），新实现 8px（right-2）',
      'box-shadow': '新增 focus-visible 焦点环 —— 仅键盘聚焦时出现',
      '--tw-ring-shadow': '同上',
      '--tw-ring-color': '同上',
      'outline-style': '新增 focus-visible:outline-none —— 与全局焦点环契约一致',
      '--tw-outline-style': '同上',
    },
  },
  {
    id: 'sheet-panel',
    page: 'admin-orders / admin-products',
    before: 'absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-card shadow-lg',
    after:
      'fixed z-[var(--z-drawer)] flex flex-col bg-card text-card-foreground shadow-lg transition-transform duration-200 ease-emphasized inset-y-0 right-0 h-full w-full max-w-xl starting:translate-x-full',
    source: '迁移前 apps/admin/src/components/sheet.tsx:37',
    expected: {
      position: '旧实现是 fixed 容器内的 absolute，新实现是 Portal 里的 fixed —— 覆盖范围等价',
      top: '旧的 top-0 等价于新的 inset-y-0（上下同时贴边）',
      'inset-block': '同上',
      'z-index': '旧实现写在容器上，新实现写在面板自身 —— 同一令牌（--z-drawer = 50），层级一致',
      color: '新增 text-card-foreground：与 foreground 同值 #17171B，等价',
      'transition-property': '新增滑入动效（200ms / ease-emphasized），旧实现无动效 —— 只影响打开瞬间',
      'transition-duration': '同上',
      'transition-timing-function': '同上',
      '--tw-duration': '同上',
      '--tw-ease': '同上',
      '--tw-translate-x': '进场起始位移（@starting-style），静止态等价',
      translate: '同上',
    },
  },
  {
    id: 'sheet-header',
    page: 'admin-orders / admin-products',
    before: 'flex items-center justify-between border-b border-border px-5 py-3',
    after: 'shrink-0 border-b border-border px-5 py-3 pr-12',
    source: '迁移前 apps/admin/src/components/sheet.tsx:39',
    expected: {
      'padding-right': '旧实现靠 justify-between 把关闭按钮推到右侧，新实现用 pr-12 预留等宽空间 —— 内容区宽度等价',
      display: '旧实现是 flex 容器，新实现是普通块（标题单行）',
      'align-items': '旧实现垂直居中，新实现默认 stretch（单行文本，视觉等价）',
      'justify-content': '旧实现把关闭按钮推到右端，新实现的关闭按钮是绝对定位 —— 标题位置不变',
      'flex-shrink': '新增 shrink-0：抽屉头在矮屏下不被压缩（与 body 的 flex-1 配合）',
    },
  },
  {
    id: 'sheet-body',
    page: 'admin-orders / admin-products',
    before: 'flex-1 overflow-y-auto p-5',
    after: 'flex-1 overflow-y-auto p-5',
    source: '迁移前 apps/admin/src/components/sheet.tsx:45',
  },
  {
    id: 'sheet-footer',
    page: 'admin-products',
    before: 'flex items-center justify-end gap-2 border-t border-border p-4',
    after: 'shrink-0 border-t border-border p-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
    source: '迁移前 apps/admin/src/components/sheet.tsx:46',
    expected: {
      'flex-direction': 'shadcn 默认在 <640px 纵向堆叠（flex-col-reverse），后台为桌面端（≥sm）实际渲染仍是横向一行',
      'justify-content': '旧实现始终右对齐，新实现只在 sm 断点右对齐（移动端纵向堆叠时左对齐更合理）',
      'align-items': '旧实现垂直居中按钮，新实现由 items-stretch 默认值代替 —— 按钮高度自适应，视觉等价',
      'flex-shrink': '新增 shrink-0：抽屉底栏不被压缩',
    },
  },
  {
    id: 'tab-trigger-active',
    page: 'admin-settings-theme / admin-settings-account',
    before:
      '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors duration-150 border-primary font-medium text-primary',
    after:
      '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors duration-150 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-primary data-[state=inactive]:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40',
    source: '迁移前 apps/admin/src/pages/settings.tsx:43-44',
    afterVariant: 'data-[state=active]',
    expected: {
      'box-shadow': '新增 focus-visible 焦点环 —— 仅键盘聚焦时出现',
      '--tw-ring-shadow': '同上',
      '--tw-ring-color': '同上',
      'outline-style': '新增 focus-visible:outline-none —— 与全局焦点环契约一致',
      '--tw-outline-style': '同上',
      'pointer-events': '新增 disabled:pointer-events-none —— 仅禁用态',
      'data-[state=inactive]:hover.color': '旧实现把 hover:text-foreground 放在「未选中」分支，新实现用 data-[state=inactive]:hover —— 行为等价（选中项悬停不变色）',
      cursor: '新增 disabled:pointer-events-none / disabled:opacity-40 —— 仅禁用态',
      opacity: '同上',
    },
  },
  {
    id: 'input',
    page: 'admin-orders / admin-products / admin-settings-theme / admin-settings-account',
    before:
      'h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground border-input focus:border-ring',
    after:
      'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive',
    source: '迁移前 apps/admin/src/components/field.tsx:40-41',
    expected: {
      'box-shadow': '新增 focus-visible 焦点环（品牌蓝 2px + 24% 外扩）—— 只在键盘聚焦时出现，是无障碍增强',
      '--tw-ring-shadow': '同上',
      '--tw-ring-color': '同上',
      'border-color': '新增 aria-invalid:border-destructive —— 错误态边框（旧的实现用条件类 border-destructive，等价）',
      cursor: '新增 disabled:cursor-not-allowed —— 仅禁用态',
      opacity: '新增 disabled:opacity-40 —— 仅禁用态',
    },
  },
  {
    id: 'textarea',
    page: 'admin-products（商品描述）',
    before:
      'w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground border-input focus:border-ring min-h-[64px] py-2',
    after:
      'min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive min-h-[64px]',
    source: '迁移前 apps/admin/src/components/field.tsx:40-41 + 95',
    expected: {
      'box-shadow': '新增 focus-visible 焦点环（键盘聚焦才出现）',
      '--tw-ring-shadow': '同上',
      '--tw-ring-color': '同上',
      'border-color': '新增 aria-invalid:border-destructive —— 错误态边框（旧的实现用条件类 border-destructive，等价）',
      cursor: '新增 disabled:cursor-not-allowed —— 仅禁用态',
      opacity: '新增 disabled:opacity-40 —— 仅禁用态',
    },
  },
  {
    id: 'label',
    page: 'admin-orders / admin-products / admin-settings-theme / admin-settings-account',
    before: 'mb-1 block text-sm font-medium text-foreground',
    after: 'mb-1 block text-sm font-medium text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
    source: '迁移前 apps/admin/src/components/field.tsx:20',
    expected: {
      cursor: '新增 peer-disabled:cursor-not-allowed —— 仅「控件被禁用」时生效',
      opacity: '新增 peer-disabled:opacity-70 —— 仅「控件被禁用」时生效',
    },
  },
  {
    id: 'error-text',
    page: 'admin-orders / admin-products',
    before: 'mt-1 text-xs text-destructive',
    after: 'mt-1 text-xs text-destructive',
    source: '迁移前 apps/admin/src/components/field.tsx:30',
  },
  {
    id: 'select-trigger',
    page: 'admin-products（商品状态）',
    before:
      'w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground border-input focus:border-ring h-9',
    after:
      'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive data-[placeholder]:text-muted-foreground',
    source: '迁移前 apps/admin/src/components/field.tsx:40-41（原生 <select>）',
    redesigned: true,
    expected: {
      'native-element':
        '原生 <select>（浏览器自带外观，跨浏览器不一致）换成 Radix Select 触发器 —— 这是迁移的目的本身；触发器尺寸/圆角/边框/字号与输入框一致',
      display: '触发器是 flex 行（左侧值 + 右侧 ChevronDown 图标），原生 select 是浏览器控件',
      'align-items': '同上',
      'justify-content': '同上',
      gap: '同上',
      'box-shadow': '新增 focus-visible 焦点环',
      '--tw-ring-shadow': '同上',
      '--tw-ring-color': '同上',
      'border-color': '新增 aria-invalid:border-destructive —— 错误态边框（旧的实现用条件类 border-destructive，等价）',
      color: '新增 data-[placeholder]:text-muted-foreground —— 未选择时的占位色（旧的实现用 placeholder:text-muted-foreground，等价）',
      cursor: '新增 disabled:cursor-not-allowed —— 仅禁用态',
      opacity: '新增 disabled:opacity-40 —— 仅禁用态',
    },
  },
  {
    id: 'cart-drawer-panel',
    page: 'storefront-cart',
    before:
      'fixed right-0 top-0 z-[var(--z-drawer)] flex h-full w-[min(440px,calc(100vw-48px))] flex-col bg-card shadow-lg transition-transform duration-200 ease-emphasized',
    after:
      'fixed right-0 top-0 z-[var(--z-drawer)] flex h-full w-[min(440px,calc(100vw-48px))] flex-col bg-card shadow-lg transition-transform duration-200 ease-emphasized',
    source: 'packages/ui/src/cart-drawer.tsx:130-134（本次迁移未改动其类名）',
  },
];