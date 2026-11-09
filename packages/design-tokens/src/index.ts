/**
 * 商城 · Design Tokens (TS 常量)
 * -----------------------------------------------------------------------------
 * 与 tokens.css / design-tokens.json 同源。仅供「必须用 JS 值」的场景：
 *   - 图表库（Recharts）的色板
 *   - 内联 style 里需要读取动效时长/层级
 *   - 测试断言里引用 token 值
 *
 * 日常组件样式一律走 CSS 变量与 Tailwind 工具类，不要引用这里的常量去写内联色。
 * 换肤以 CSS 变量为准；这里的值是一期默认（浅色）快照，仅供 JS 侧参考。
 */

/** 原始色阶（primitive）。组件层禁止直接使用，只允许语义层引用。 */
export const colors = {
  neutral: {
    0: '#FFFFFF',
    25: '#FAFAFB',
    50: '#F4F4F6',
    100: '#E9E9ED',
    200: '#DADAE0',
    300: '#BEBEC7',
    400: '#9A9AA6',
    500: '#71717F',
    600: '#55555F',
    700: '#3D3D46',
    800: '#26262C',
    900: '#17171B',
    950: '#0E0E11',
  },
  primary: {
    50: '#EAF2FD',
    100: '#D6E7FB',
    200: '#ADCDF7',
    300: '#7CAEF0',
    400: '#4A8DE8',
    500: '#2B76E0',
    600: '#1666D9',
    700: '#1454B4',
    800: '#124594',
    900: '#0F3A77',
  },
  accentOrange: {
    50: '#FFF3EC',
    100: '#FFE4D6',
    200: '#FFC5A6',
    300: '#FF9F70',
    400: '#FF8547',
    500: '#FF6B35',
    600: '#E04E1B',
    700: '#C2410C',
  },
  gradient: '#5B8DEF',
  semantic: {
    green600: '#15803D',
    green700: '#166534',
    green50: '#F0FDF4',
    amber600: '#B45309',
    amber700: '#92400E',
    amber50: '#FFFBEB',
    red600: '#B91C1C',
    red700: '#991B1B',
    red50: '#FEF2F2',
  },
  chart: ['#1666D9', '#0F766E', '#FF6B35', '#CA8A04', '#71717F'],
} as const;

/** 字体栈。中英混排：拉丁先命中，中文回落 Noto Sans SC。 */
export const fontFamily = {
  sans: '"Archivo", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
  display: 'var(--font-family-sans)',
  mono: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const;

/** 字号阶（px）。CSS 真源在 tokens.css 的 @theme，此处仅为 JS 侧参考。 */
export const fontSize = {
  eyebrow: 11,
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,
  '5xl': 40,
} as const;

/** 间距（4px 基准网格）。n = px / 4。 */
export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
} as const;

/** 圆角基准（派生 6 档见 tokens.css）。--radius = 8px 是换肤可调项。 */
export const radius = {
  base: 8,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
} as const;

/** 容器宽度（具名，禁止页面里写 max-w-7xl 魔数）。 */
export const container = {
  prose: '42rem', // 672px
  narrow: '56rem', // 896px
  content: '80rem', // 1280px
  wide: '96rem', // 1536px
} as const;

/** 商品图比例（换肤可调项，CSS 用斜杠比值写法）。 */
export const productRatio = {
  primary: '4 / 5',
  square: '1 / 1',
  wide: '16 / 9',
} as const;

/** 阴影 3 档。静置卡片用 1px 边框，不用阴影。 */
export const shadow = {
  sm: '0 1px 2px 0 rgba(23, 23, 27, 0.06)',
  md: '0 4px 12px -2px rgba(23, 23, 27, 0.10)',
  lg: '0 12px 32px -8px rgba(23, 23, 27, 0.16)',
} as const;

/** 动效时长（上限 300ms）。 */
export const motion = {
  duration: {
    instant: '100ms',
    fast: '150ms', // 全站收敛基准值
    base: '200ms',
    slow: '300ms', // 绝对上限
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
    emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
  },
} as const;

/** 层级（禁止组件自造 z-index）。 */
export const zIndex = {
  base: 0,
  sticky: 30,
  drawer: 50,
  modal: 50,
  toast: 60,
} as const;

/** 图标三档尺寸 + 描边（全项目唯一规范，不可新增）。 */
export const icon = {
  inline: { size: 16, strokeWidth: 1.75 },
  button: { size: 20, strokeWidth: 2 },
  standalone: { size: 24, strokeWidth: 2 },
} as const;

/** 触摸目标与间距（WCAG 2.5.5）。 */
export const touch = {
  minTarget: '44px',
  minGap: '8px',
} as const;

export const tokens = {
  colors,
  fontFamily,
  fontWeight,
  fontSize,
  spacing,
  radius,
  container,
  productRatio,
  shadow,
  motion,
  zIndex,
  icon,
  touch,
} as const;

export type Tokens = typeof tokens;
