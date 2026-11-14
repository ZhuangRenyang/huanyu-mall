import { adminClient, getAdminApiMode } from './admin-client';
import { listMemberLevels as mockList, saveMemberLevel as mockSave } from './admin-store';

/**
 * 会员等级数据层（ADR-102）。
 *
 * 等级不落库到客户身上：每次按累计消费实时匹配。所以这里只需要维护「阶梯」。
 */
export interface MemberLevelView {
  id: string;
  name: string;
  /** 门槛（minor）：达到该累计消费即为这一档。 */
  thresholdMinor: number;
  /** 折扣力度（万分比）：500 = 便宜 5%。 */
  discountBps: number;
}

export async function listMemberLevels(): Promise<MemberLevelView[]> {
  if (getAdminApiMode() !== 'live') {
    return mockList().map((l) => ({
      id: l.id,
      name: l.name,
      thresholdMinor: l.thresholdMinor,
      discountBps: l.discountBps,
    }));
  }
  const res = (await adminClient().listMemberLevels()) as {
    items?: Array<Record<string, unknown>>;
  };
  return (res.items ?? []).map((l) => ({
    id: String(l.id ?? ''),
    name: String(l.name ?? ''),
    thresholdMinor: Number(l.threshold_minor ?? 0),
    discountBps: Number(l.discount_bps ?? 0),
  }));
}

export async function createMemberLevel(input: {
  name: string;
  thresholdMinor: number;
  discountBps: number;
}): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSave({ ...input });
    return;
  }
  await adminClient().createMemberLevel({
    name: input.name,
    threshold_minor: input.thresholdMinor,
    discount_bps: input.discountBps,
  });
}

export async function updateMemberLevel(
  id: string,
  patch: { name?: string; thresholdMinor?: number; discountBps?: number },
): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSave({ id, ...patch });
    return;
  }
  await adminClient().updateMemberLevel(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.thresholdMinor !== undefined ? { threshold_minor: patch.thresholdMinor } : {}),
    ...(patch.discountBps !== undefined ? { discount_bps: patch.discountBps } : {}),
  });
}
