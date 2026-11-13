/**
 * 浏览足迹（ADR-063）。
 *
 * 淘宝在「我的淘宝」里有「我的足迹」，商品页也常有「最近看过」。
 * 顾客挑东西会反复回看同一件，没有足迹就只能靠浏览器历史记录找 —— 那里面混着
 * 新闻和别的网站，等于让他自己在大海捞针。
 *
 * 为什么存在本机而不是服务端：
 * - 浏览是**最高频**的写操作（每开一个商品页一次）。放服务端就是给每次点击加一次写库，
 *   而它几乎不影响成交，收益远小于代价；
 * - 游客没有身份。服务端要记就得先造一个匿名 id，那是另一套需要清理和授权的东西。
 *
 * 代价是跨设备不同步。界面必须**如实说明「只记录在这台设备」**，
 * 不能让顾客以为换了手机还能看到。
 */

export interface RecentView {
  productId: string;
  /** 商品页 handle（拼链接用，比 id 稳定）。 */
  handle: string;
  title: string;
  /** 展示价（最低变体价），只用于列表显示；加购时以商品页为准。 */
  priceMinor: number;
  currencyCode: string;
  imageUrl?: string;
  /** 最近一次查看的时间（毫秒）。 */
  viewedAt: number;
}

/** 最多留多少条：再多也没人往下翻，还会把 localStorage 撑大。 */
export const RECENT_LIMIT = 30;

const STORAGE_KEY = 'recent:views';

/**
 * 存储端口：默认 localStorage，测试可注入内存实现。
 * 浏览器隐私模式 / 禁用存储时 `getItem` 会抛异常，所以每个调用点都要容忍失败。
 */
export interface RecentStorage {
  get(): string | null;
  set(value: string): void;
  remove(): void;
}

function defaultStorage(): RecentStorage {
  return {
    get: () => {
      try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    },
    set: (value) => {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, value);
      } catch {
        /* 存不下就算了：足迹不该影响浏览 */
      }
    },
    remove: () => {
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* noop */
      }
    },
  };
}

/**
 * 把一条浏览记录并进列表（纯函数，便于测）。
 *
 * 规则：
 * 1. 同一商品只留一条 —— 反复回看不该把列表刷满同一件；
 * 2. 最近看的排最前，重复查看会把它顶到最前并更新时间；
 * 3. 超过上限截断尾部（最旧的先丢）。
 */
export function mergeRecent(
  list: readonly RecentView[],
  next: RecentView,
  limit: number = RECENT_LIMIT,
): RecentView[] {
  const rest = list.filter((item) => item.productId !== next.productId);
  return [next, ...rest].slice(0, limit);
}

/** 记一条浏览（写库失败也不抛：足迹不是关键路径）。 */
export function recordView(next: RecentView, storage: RecentStorage = defaultStorage()): RecentView[] {
  const merged = mergeRecent(listRecent(storage), next);
  try {
    storage.set(JSON.stringify(merged));
  } catch {
    /*
     * 存不进去就算了。隐私模式会直接抛 QuotaExceededError，
     * 而「记不住看过什么」绝不能变成「商品页打不开」。
     */
  }
  return merged;
}

/** 读足迹（解析失败当作空，不把脏数据渲染到页面）。 */
export function listRecent(storage: RecentStorage = defaultStorage()): RecentView[] {
  let raw: string | null = null;
  try {
    raw = storage.get();
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 逐条校验：老版本写进去的字段可能不全，缺关键字段的直接丢
    return parsed.filter((item): item is RecentView => {
      if (typeof item !== 'object' || item === null) return false;
      const r = item as Record<string, unknown>;
      return (
        typeof r.productId === 'string' &&
        typeof r.handle === 'string' &&
        typeof r.title === 'string' &&
        typeof r.priceMinor === 'number' &&
        typeof r.viewedAt === 'number'
      );
    });
  } catch {
    return [];
  }
}

/** 清空足迹。 */
export function clearRecent(storage: RecentStorage = defaultStorage()): void {
  try {
    storage.remove();
  } catch {
    /* noop */
  }
}
