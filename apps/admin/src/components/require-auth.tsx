import { Navigate, Outlet } from 'react-router-dom';
import { getSession } from '@/lib/admin-store';

/** 路由守卫：未登录跳 /login。 */
export function RequireAuth() {
  if (!getSession()) return <Navigate to="/login" replace />;
  return <Outlet />;
}
