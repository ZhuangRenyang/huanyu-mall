import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ClipboardList, LogOut, Package, Settings, TicketPercent, Warehouse } from 'lucide-react';
import { IconButton, cn } from '@mall/ui';
import { getSession } from '@/lib/admin-store';
import { logout } from '@/lib/admin-api';

const NAV = [
  { to: '/products', label: '商品', icon: Package },
  { to: '/orders', label: '订单', icon: ClipboardList },
  { to: '/inventory', label: '库存', icon: Warehouse },
  { to: '/promotions', label: '促销', icon: TicketPercent },
  { to: '/settings', label: '设置', icon: Settings },
] as const;

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
        <nav className="flex-1 space-y-1 p-2" aria-label="后台导航">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
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
        </nav>
        <div className="border-t border-border p-3 text-xs text-muted-foreground">一期 · 沙箱环境</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b border-border bg-card px-4">
          <nav className="flex gap-1 md:hidden" aria-label="移动导航">
            {NAV.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'rounded px-2 py-1 text-sm transition-colors duration-150',
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
