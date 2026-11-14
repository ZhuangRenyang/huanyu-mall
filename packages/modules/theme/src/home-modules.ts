/**
 * 首页模块编排（ADR-079）。
 *
 * 装修的第一块能力：决定首页显示哪些区块、按什么顺序。
 * 存进 theme.metadata.home_modules —— 装修是店铺级配置，不值得为三个开关开一张表。
 *
 * 归一化必须容错：商家在旧版本存过别的模块 id，升级后不认识的那个不能把整页搞崩，
 * 直接丢掉；新版本新增的模块（老配置里没有）补在末尾并默认开启。
 */
export type HomeModuleId = "categories" | "vouchers" | "featured";

export interface HomeModuleDTO {
  id: HomeModuleId;
  enabled: boolean;
}

export const HOME_MODULE_IDS: HomeModuleId[] = ["categories", "vouchers", "featured"];

export const DEFAULT_HOME_MODULES: HomeModuleDTO[] = HOME_MODULE_IDS.map((id) => ({
  id,
  enabled: true,
}));

export function normalizeHomeModules(
  metadata: Record<string, unknown> | null | undefined,
): HomeModuleDTO[] {
  const raw = metadata?.home_modules;
  const stored = Array.isArray(raw)
    ? raw
        .filter(
          (item): item is { id: string; enabled?: unknown } =>
            typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string",
        )
        .map((item) => ({
          id: item.id as HomeModuleId,
          enabled: item.enabled !== false,
        }))
        .filter((item) => HOME_MODULE_IDS.includes(item.id))
    : [];

  // 去重（同一 id 只认第一次出现），再补上缺失的新模块
  const seen = new Set<HomeModuleId>();
  const ordered = stored.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  for (const id of HOME_MODULE_IDS) {
    if (!seen.has(id)) ordered.push({ id, enabled: true });
  }
  return ordered;
}

/** 上移/下移一位；越界原样返回（界面按钮也置灰，这里只是兜底）。 */
export function moveHomeModule(
  list: HomeModuleDTO[],
  id: HomeModuleId,
  direction: "up" | "down",
): HomeModuleDTO[] {
  const index = list.findIndex((m) => m.id === id);
  if (index < 0) return list;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
