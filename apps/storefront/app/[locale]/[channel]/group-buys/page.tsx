import { loadActiveGroupBuys } from '@/lib/group-buys';
import { GroupBuyBoard } from '@/components/group-buy-board';

/**
 * 拼团（ADR-100）。
 *
 * 参团免费、成团领券：页面负责「参团」与「成团后领券」两个动作，
 * 领到的券在「我的卡券」里，下单时自动可用。
 */
export default async function GroupBuysPage() {
  const activities = await loadActiveGroupBuys();
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-foreground">拼团</h1>
      </header>
      <p className="mt-1 text-sm text-muted-foreground">
        参团免费：凑齐人数即算成团，成团后每人领一张拼团专享券，拿券下单。
      </p>

      <GroupBuyBoard activities={activities} />
    </div>
  );
}
