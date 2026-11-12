import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/require-auth';
import { Shell } from './components/shell';
import { LoginPage } from './pages/login';
import { DashboardPage } from './pages/dashboard';
import { ProductsPage } from './pages/products';
import { CategoriesPage } from './pages/categories';
import { OrdersPage } from './pages/orders';
import { InventoryPage } from './pages/inventory';
import { ShippingProfilesPage } from './pages/shipping-profiles';
import { RefundsPage } from './pages/refunds';
import { CustomersPage } from './pages/customers';
import { SettingsPage } from './pages/settings';
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
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="orders" element={<OrdersPage />} />
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
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
