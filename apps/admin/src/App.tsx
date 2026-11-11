import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/require-auth';
import { Shell } from './components/shell';
import { LoginPage } from './pages/login';
import { ProductsPage } from './pages/products';
import { OrdersPage } from './pages/orders';
import { InventoryPage } from './pages/inventory';
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
          <Route index element={<Navigate to="/products" replace />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="inventory" element={<InventoryPage />} />
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
      <Route path="*" element={<Navigate to="/products" replace />} />
    </Routes>
  );
}
