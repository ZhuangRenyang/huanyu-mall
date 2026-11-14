import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/require-auth';
import { Shell } from './components/shell';
import { LoginPage } from './pages/login';
import { DashboardPage } from './pages/dashboard';
import { ProductsPage } from './pages/products';
import { CategoriesPage } from './pages/categories';
import { OrdersPage } from './pages/orders';
import { ReviewsPage } from './pages/reviews';
import { PackingSlipPage } from './pages/packing-slip';
import { InventoryPage } from './pages/inventory';
import { ShippingProfilesPage } from './pages/shipping-profiles';
import { RefundsPage } from './pages/refunds';
import { CustomersPage } from './pages/customers';
import { SettingsPage } from './pages/settings';
import { DesignPage } from './pages/design';
import { AppsPage } from './pages/apps';
import { MaintenancePage } from './pages/maintenance';
import {
  MarketingGiftCardsPage,
  MarketingPromotionsPage,
  MarketingVouchersPage,
} from './pages/marketing';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        {/* 发货单不套外壳：套着侧边栏打印会印出一列菜单（ADR-044） */}
        <Route path="orders/:id/packing-slip" element={<PackingSlipPage />} />
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="refunds" element={<RefundsPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="shipping-profiles" element={<ShippingProfilesPage />} />
          <Route path="marketing">
            <Route index element={<Navigate to="promotions" replace />} />
            <Route path="promotions" element={<MarketingPromotionsPage />} />
            <Route path="vouchers" element={<MarketingVouchersPage />} />
            <Route path="gift-cards" element={<MarketingGiftCardsPage />} />
          </Route>
          {/* 旧地址兼容：收藏过 /promotions 的书签仍可用 */}
          <Route path="promotions" element={<Navigate to="/marketing/promotions" replace />} />
          <Route path="design" element={<DesignPage />} />
          <Route path="apps" element={<AppsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="maintenance" element={<MaintenancePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
