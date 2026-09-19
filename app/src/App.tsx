import { Navigate, Route, Routes } from "react-router-dom";
import { AdminGuard, AuthedGuard } from "./lib/AdminGuard";
import { AssortmentSetDetailScreen } from "./screens/AssortmentSetDetailScreen";
import { AssortmentSetsScreen } from "./screens/AssortmentSetsScreen";
import { EventDetailScreen } from "./screens/EventDetailScreen";
import { EventInventoryCheckScreen } from "./screens/EventInventoryCheckScreen";
import { EventNewScreen } from "./screens/EventNewScreen";
import { EventsScreen } from "./screens/EventsScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { InviteScreen } from "./screens/InviteScreen";
import { LocationStockScreen } from "./screens/LocationStockScreen";
import { LocationsScreen } from "./screens/LocationsScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { ClosingDistributeScreen } from "./screens/ClosingDistributeScreen";
import { MovementDetailScreen } from "./screens/MovementDetailScreen";
import { MovementNewScreen } from "./screens/MovementNewScreen";
import { MovementsScreen } from "./screens/MovementsScreen";
import { PreparationSetDetailScreen } from "./screens/PreparationSetDetailScreen";
import { PreparationSetsScreen } from "./screens/PreparationSetsScreen";
import { PreparationsScreen } from "./screens/PreparationsScreen";
import { ProductDetailScreen } from "./screens/ProductDetailScreen";
import { ProductsScreen } from "./screens/ProductsScreen";
import { UsersScreen } from "./screens/UsersScreen";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/invite/:token" element={<InviteScreen />} />
      <Route path="/" element={<HomeScreen />} />
      <Route
        path="/users"
        element={
          <AdminGuard>
            <UsersScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/events"
        element={
          <AdminGuard>
            <EventsScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/events/new"
        element={
          <AdminGuard>
            <EventNewScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/events/:id"
        element={
          <AuthedGuard>
            <EventDetailScreen />
          </AuthedGuard>
        }
      />
      <Route
        path="/events/:eventId/inventory/:checkId"
        element={
          <AuthedGuard>
            <EventInventoryCheckScreen />
          </AuthedGuard>
        }
      />
      <Route
        path="/events/:eventId/distribute/:checkId"
        element={
          <AdminGuard>
            <ClosingDistributeScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/locations"
        element={
          <AdminGuard>
            <LocationsScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/locations/:id"
        element={
          <AdminGuard>
            <LocationStockScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/movements"
        element={
          <AuthedGuard>
            <MovementsScreen />
          </AuthedGuard>
        }
      />
      <Route
        path="/movements/new"
        element={
          <AdminGuard>
            <MovementNewScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/movements/:id"
        element={
          <AuthedGuard>
            <MovementDetailScreen />
          </AuthedGuard>
        }
      />
      <Route
        path="/preparations"
        element={
          <AdminGuard>
            <PreparationsScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/preparation-sets"
        element={
          <AdminGuard>
            <PreparationSetsScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/preparation-sets/:id"
        element={
          <AdminGuard>
            <PreparationSetDetailScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/products"
        element={
          <AdminGuard>
            <ProductsScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/products/:id"
        element={
          <AdminGuard>
            <ProductDetailScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/assortment-sets"
        element={
          <AdminGuard>
            <AssortmentSetsScreen />
          </AdminGuard>
        }
      />
      <Route
        path="/assortment-sets/:id"
        element={
          <AdminGuard>
            <AssortmentSetDetailScreen />
          </AdminGuard>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
