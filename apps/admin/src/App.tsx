import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/require-auth';
import { Shell } from './components/shell';
import { LoginPage } from './pages/login';
import { ProductsPage } from './pages/products';
import { OrdersPage } from './pages/orders';
import { SettingsPage } from './pages/settings';
import { PromotionsPage } from './pages/promotions';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/products" replace />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="promotions" element={<PromotionsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/products" replace />} />
    </Routes>
  );
}
