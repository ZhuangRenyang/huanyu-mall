/**
 * live 模式的「后端购物车」状态层。
 *
 * 为什么单独一个模块：后端购物车有两个前端看不见的身份 ——
 * 1. cartId（cart_xxx）：加购 / 改量 / 删行 / 选运费 / 下单都用它；
 * 2. lineId（cli_xxx）：**行**的主键。前端购物车行的 id 是 variant_id，
 *    但改数量、删行要的是 lineId，两者不在同一个 ID 空间。
 *    漏了这层映射就会出现「删不掉 / 改不动」的行。
 *
 * 本模块的规矩：**行 id 一律从服务端购物车现取**（不缓存映射）。
 * 缓存的映射会和服务端脱节（刷新、换车、多标签页），而映射错了就是
 * 「改错行 / 删错行」—— 直接影响收多少钱。
 *
 * 另一条铁律：**写操作必须串行**（enqueue）。
 * 后端 addLineItem 每次都插新行、不合并同一 variant；两次并发的同款加购
 * 会变成两行同商品 —— 下单金额按行累加，那等于**重复扣款**。
 * 串行后第二个请求能看到第一个的结果，走的是改量而不是新增行。
 */
import { ApiError } from '@mall/sdk';
import type { Cart, CartLineItem } from '@mall/sdk';
import type { CartLineItemProps } from '@mall/ui';
import { getStoreClient } from './api';

const STORAGE_KEY = 'cart:live';

interface LiveCartSnapshot {
  /** 后端购物车 id；空串表示还没建车。 */
  cartId: string;
  /** 建车时带的邮箱（后端只在建车时接受 email，见 prepareCartForOrder 的说明）。 */
  email: string;
  /**
   * 这辆车已经下过单时的「内容指纹」。
   *
   * 为什么记这个：后端 createPaymentSession 是「按 cart_id 反查订单 → 找该订单的支付集合」，
   * 而仓储层的 listOrders 没有 ORDER BY。一辆车若出过两笔订单，反查结果就不确定，
   * 可能把支付会话挂到另一笔订单上 —— **金额就收错了**。
   *
   * 所以规则是「一辆车只出一笔单」：
   * - 内容没变（重试/连点）→ 复用这辆车，后端按幂等键重放同一笔订单；
   * - 内容变了 → 换新车，新单新集合。
   */
  orderedFingerprint: string;
}

const EMPTY: LiveCartSnapshot = { cartId: '', email: '', orderedFingerprint: '' };

let snapshot: LiveCartSnapshot | null = null;

/** 读后端购物车快照（首次读时从 sessionStorage 恢复，刷新不丢车）。 */
function read(): LiveCartSnapshot {
  if (snapshot) return snapshot;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    snapshot = raw ? (JSON.parse(raw) as LiveCartSnapshot) : { ...EMPTY };
  } catch {
    snapshot = { ...EMPTY };
  }
  return snapshot;
}

function persist(state: LiveCartSnapshot): void {
  snapshot = state;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* sessionStorage 不可用时降级为内存态 */
  }
}

/* ------------------------------------------------------------------ *
 * 写操作串行队列
 * ------------------------------------------------------------------ */

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * 把操作排进队列，一个接一个执行。
 *
 * 写操作必须串行：后端 addLineItem 每次都插新行、不合并同 variant。
 * 两个并发的「加购同款」会得到两行同商品 —— 下单时金额按行累加，
 * 顾客就被重复扣款。串行后第二个请求能看到第一个的结果，走的是改量。
 *
 * 注意：队列内部**不要**再调用会排队的函数（会自锁）。
 */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  // 队列本身不能被失败打断（否则一次失败会让后续写操作全卡住）。
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/* ------------------------------------------------------------------ *
 * 内部原语（只在队列内调用）
 * ------------------------------------------------------------------ */

/** 建车（后端只在建车时接受 email）。 */
async function createCartLocked(email?: string): Promise<string> {
  const cart = (await getStoreClient().createCart(email ? { email } : {})) as { id: string };
  return cart.id;
}

/** 拉取后端购物车。 */
async function pullCart(cartId: string): Promise<Cart> {
  return (await getStoreClient().getCart(cartId)) as Cart;
}

/**
 * 删行。
 *
 * 后端返回 204（无响应体），SDK 按「JSON 解析失败」抛 ApiError(204) ——
 * 204 是「删除成功」的协议事实，这里当成功处理。
 */
async function deleteLineLocked(cartId: string, lineId: string): Promise<void> {
  try {
    await getStoreClient().deleteLineItem(cartId, lineId);
  } catch (err) {
    if (!(err instanceof ApiError && err.code === 204)) throw err;
  }
}

/** 建车并把商品行搬过去（换车时用）。 */
async function createCartWithItems(
  email: string,
  items: Array<{ variantId: string; quantity: number }>,
): Promise<string> {
  const cartId = await createCartLocked(email);
  for (const item of items) {
    await getStoreClient().addLineItem(cartId, {
      variant_id: item.variantId,
      quantity: item.quantity,
    });
  }
  return cartId;
}

/* ------------------------------------------------------------------ *
 * 对外接口
 * ------------------------------------------------------------------ */

/** 当前后端购物车 id（未建车时为空串）。 */
export function getLiveCartId(): string {
  return read().cartId;
}

/**
 * 加购（数量在服务端现有数量上累加）。
 *
 * 数量以**服务端**的购物车为准，不是前端算出来的数字：
 * 前端的数字可能因为并发 / 刷新而落后，直接写回去会把顾客已有的数量覆盖掉。
 */
export async function addToLiveCart(variantId: string, quantity: number): Promise<Cart> {
  return enqueue(async () => {
    const state = read();
    const cartId = state.cartId || (await createCartLocked());
    if (!state.cartId) persist({ ...state, cartId });

    const cart = await pullCart(cartId);
    const line = (cart.line_items ?? []).find((l) => l.variant_id === variantId);
    if (!line) {
      // 服务端没有这一行 → 新增。
      return (await getStoreClient().addLineItem(cartId, {
        variant_id: variantId,
        quantity,
      })) as Cart;
    }
    // 服务端已有这一行 → 改量（后端不会合并同变体，再插一行就是重复扣款）。
    return (await getStoreClient().updateLineItem(cartId, line.id, {
      quantity: line.quantity + quantity,
    })) as Cart;
  });
}

/**
 * 把某个变体的数量**设为**指定值（购物车抽屉里的加减号）。
 *
 * 行 id 从服务端购物车解析 —— 改量要的是 lineId（cli_xxx），不是 variant_id，
 * 两者不在同一个 ID 空间。
 */
export async function setLiveCartQuantity(variantId: string, quantity: number): Promise<Cart> {
  return enqueue(async () => {
    const cartId = read().cartId;
    if (!cartId) return emptyCart();
    const cart = await pullCart(cartId);
    const line = (cart.line_items ?? []).find((l) => l.variant_id === variantId);
    if (!line) return cart;
    return (await getStoreClient().updateLineItem(cartId, line.id, {
      quantity,
    })) as Cart;
  });
}

/** 删掉某个变体所在的行。 */
export async function removeLiveCartLine(variantId: string): Promise<Cart> {
  return enqueue(async () => {
    const cartId = read().cartId;
    if (!cartId) return emptyCart();
    const cart = await pullCart(cartId);
    const line = (cart.line_items ?? []).find((l) => l.variant_id === variantId);
    if (!line) return cart;
    await deleteLineLocked(cartId, line.id);
    return { ...cart, line_items: (cart.line_items ?? []).filter((l) => l.id !== line.id) };
  });
}

/** 拉取后端购物车（刷新页面后恢复用）。 */
export async function fetchLiveCart(cartId: string): Promise<Cart> {
  return enqueue(() => pullCart(cartId));
}

/**
 * 丢弃后端购物车（订单完成后换新车）。
 *
 * 排队执行：等在途的写操作跑完再丢弃，否则在途写会把旧 cartId 又写回来，
 * 下一单就复用了已经下过单的旧车。
 */
export function resetLiveCart(): void {
  void enqueue(async () => {
    persist({ ...EMPTY });
  });
}

/** 记录「这辆车已按此内容出过单」——重试同一内容时复用这辆车。 */
export function markCartOrdered(fingerprint: string): void {
  persist({ ...read(), orderedFingerprint: fingerprint });
}

/**
 * 在「后端购物车锁」内执行一段逻辑。
 *
 * 结账提交必须走这里：加购写操作与下单流程要互斥 ——
 * 否则「刚点加购就点结算」时，下单接口可能先快照到**还没加进去**的购物车，
 * 顾客看到的金额和实际扣的金额就不一样了。
 */
export async function withLiveCartLock<T>(fn: () => Promise<T>): Promise<T> {
  return enqueue(fn);
}

/**
 * 下单前把购物车整理成「可下单」状态，返回该用的 cartId。
 *
 * 两种情况要换车：
 * 1. 邮箱对不上 —— 后端只在「创建购物车」时接受 email，之后没有更新接口；
 *    而下单取的正是 cart.email（取不到就退化成 guest@example.com）。
 *    购物车是加购时建的，那时顾客还没填邮箱，所以提交前要把行搬到带邮箱的新车上，
 *    否则订单 email 永远是 guest@example.com，商家联系不上顾客。
 * 2. 内容变了 —— 这辆车已经出过单，再出一单会让后端「按 cart_id 反查订单」
 *    的结果不确定（可能挂错支付集合，金额收错）。
 *
 * 内容没变（重试 / 连点）→ 复用这辆车，后端按幂等键重放同一笔订单。
 *
 * **必须在 withLiveCartLock 内调用**（否则会和加购写操作交错）。
 * 换车失败时退回原购物车（降级但不阻断下单）。
 */
export async function prepareCartForOrder(input: {
  email: string;
  items: Array<{ variantId: string; quantity: number }>;
  fingerprint: string;
}): Promise<string> {
  const state = read();
  const email = input.email.trim();
  const emailMismatch = email !== '' && state.email !== email;
  const contentChanged = state.orderedFingerprint !== '' && state.orderedFingerprint !== input.fingerprint;

  if (state.cartId && !emailMismatch && !contentChanged) {
    // 复用原车：内容一致，后端按幂等键重放同一笔订单。
    return state.cartId;
  }
  if (input.items.length === 0) {
    // 空车没有可下单的东西，别建一张空车出来。
    return state.cartId;
  }

  // 新车（含「还没有车」的情况）：必须把商品行搬过去，否则订单是空的。
  try {
    const cartId = await createCartWithItems(email, input.items);
    persist({ cartId, email, orderedFingerprint: '' });
    return cartId;
  } catch {
    // 换车失败：退回原购物车（降级但不阻断下单）。
    return state.cartId;
  }
}

/**
 * 用后端购物车重建前端购物车。
 *
 * **后端是唯一事实来源**（价格、数量都由后端解析，铁律 13）：
 * - 后端有的行 → 单价取后端的，展示字段（产品标题/图片）沿用本地缓存；
 * - 后端没有的行 → 丢掉。留着会让「页面显示的合计」与「实际扣的金额」不一致
 *   （下单接口是按后端购物车算金额的），这是收款链路最不能出的错。
 *
 * pending：正在写后端、结果还没回来的行。这些行保留**本地**的数量
 * （乐观值就是这次操作的目标值，与服务端最终值一致），
 * 避免两次写之间行「闪没」或数量回跳。
 */
export function applyLiveCart(
  local: CartLineItemProps[],
  cart: Cart,
  pending: Iterable<string> = [],
): CartLineItemProps[] {
  const byVariant = liveLineByVariant(cart);
  const pendingIds = new Set(pending);
  const result: CartLineItemProps[] = [];
  for (const line of byVariant.values()) {
    const cached = local.find((item) => item.id === line.variant_id);
    const useLocalQuantity = cached !== undefined && pendingIds.has(line.variant_id);
    result.push({
      id: line.variant_id,
      // 展示字段后端没有，尽量沿用本地缓存（产品标题/图片比变体标题有用）
      title: cached?.title ?? line.title,
      variantTitle: cached?.variantTitle,
      quantity: useLocalQuantity ? cached.quantity : line.quantity,
      unitPriceMinor: line.unit_price_minor,
      currencyCode: line.currency_code,
      imageUrl: cached?.imageUrl,
      maxQuantity: cached?.maxQuantity,
    });
  }
  // 本地多出来的行：只有「正在写」的行才留（还没落到服务端），其余丢掉。
  for (const item of local) {
    if (!byVariant.has(item.id) && pendingIds.has(item.id)) result.push(item);
  }
  return result;
}

/** 后端购物车行 → 前端展示用的 variant_id 对照表。 */
function liveLineByVariant(cart: Cart): Map<string, CartLineItem> {
  const map = new Map<string, CartLineItem>();
  for (const line of cart.line_items ?? []) {
    if (!map.has(line.variant_id)) map.set(line.variant_id, line);
  }
  return map;
}

/** 空购物车（没有后端车时返回给调用方的占位）。 */
function emptyCart(): Cart {
  return {
    id: '',
    channel_id: '',
    currency_code: 'CNY',
    status: 'open',
    line_items: [],
    totals: {
      subtotal_minor: 0,
      shipping_minor: 0,
      tax_minor: 0,
      total_minor: 0,
    },
  };
}
