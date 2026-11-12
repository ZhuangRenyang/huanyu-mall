import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Banknote,
  ClipboardList,
  Gift,
  LogOut,
  Package,
  Settings,
  Tag,
  Users,
  Truck,
  TicketPercent,
  Warehouse,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { IconButton, cn } from '@mall/ui';
import { getSession } from '@/lib/admin-store';
import { logout } from '@/lib/admin-api';

/**
 * 菜单按域分组（参照 CRMEB 的信息架构，但不照抄它的营销玩法）：
 * 商品 / 订单 / 营销 / 设置。营销域把「总览」「促销」「优惠券」「礼品卡」拆成平级项，
 * 商家不用先记住某个功能藏在哪个 tab 里。
 */
interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: '商品',
    items: [
      { to: '/products', label: '商品列表', icon: Package },
      { to: '/inventory', label: '库存', icon: Warehouse },
      // 运费模板是低频配置项，放商品域末尾：日常用的是上面两个
      { to: '/shipping-profiles', label: '运费模板', icon: Truck },
    ],
  },
  {
    label: '订单',
    items: [
      { to: '/orders', label: '订单列表', icon: ClipboardList },
      // 退款是独立单据（有自己的状态与时效），必须能单独筛出待处理
      { to: '/refunds', label: '退款管理', icon: Banknote },
    ],
  },
  {
    // 客户单独一组（淘宝「客户运营」/ Shopify「Customers」）：
    // 挂在订单下会变成「订单的附属物」，而客户资料、地址、消费是独立维度
    label: '客户',
    items: [{ to: '/customers', label: '客户列表', icon: Users }],
  },
  {
    label: '营销',
    items: [
      { to: '/marketing/promotions', label: '促销', icon: Tag },
      { to: '/marketing/vouchers', label: '优惠券', icon: TicketPercent },
      { to: '/marketing/gift-cards', label: '礼品卡', icon: Gift },
    ],
  },
  {
    label: '设置',
    items: [{ to: '/settings', label: '设置', icon: Settings }],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

/** 后台外壳：左侧导航（桌面）+ 顶栏（当前管理员/退出）+ 主区（data-surface=admin 收紧密度）。 */
export function Shell() {
  const navigate = useNavigate();
  const session = getSession();

  return (
    <div className="flex min-h-dvh bg-background" data-surface="admin">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">商</span>
          <span className="text-sm font-semibold text-foreground">商城后台</span>
        </div>
        <nav className="flex-1 space-y-2 overflow-y-auto p-2" aria-label="后台导航">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1 text-[11px] font-medium text-muted-foreground">{group.label}</p>
              <div className="space-y-1">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm transition-colors duration-150',
                        isActive
                          ? 'border-primary bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                          : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-border p-3 text-xs text-muted-foreground">一期 · 沙箱环境</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b border-border bg-card px-4">
          <nav className="flex gap-1 overflow-x-auto md:hidden" aria-label="移动导航">
            {NAV_ITEMS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  cn(
                    'shrink-0 rounded px-2 py-1 text-sm transition-colors duration-150',
                    isActive ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-muted-foreground',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{session?.name ?? '管理员'}</span>
            <IconButton
              aria-label="退出登录"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              <LogOut className="size-5" strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
