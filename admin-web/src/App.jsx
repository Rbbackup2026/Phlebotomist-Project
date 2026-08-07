import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import { SidebarProvider } from "./context/SidebarContext.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Login from "./pages/Login.jsx";
import SuperadminLogin from "./pages/SuperadminLogin.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Orders from "./pages/Orders.jsx";
import AddedTests from "./pages/AddedTests.jsx";
import Payments from "./pages/Payments.jsx";
import Kits from "./pages/Kits.jsx";
import Phlebos from "./pages/Phlebos.jsx";
import Attendance from "./pages/Attendance.jsx";
import Collections from "./pages/Collections.jsx";
import Team from "./pages/Team.jsx";
import LiveMap from "./pages/LiveMap.jsx";
import LabTat from "./pages/LabTat.jsx";
import Tickets from "./pages/Tickets.jsx";

function ProtectedLayout({ children, roles }) {
  const { isAuthed, user } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user?.role)) return <Navigate to="/" replace />;
  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/super-login" element={<SuperadminLogin />} />
      <Route
        path="/"
        element={
          <ProtectedLayout>
            <Dashboard />
          </ProtectedLayout>
        }
      />
      {/* Ye 5 pages "operational" hain (city ke andar ka din-ka-din data) — superadmin
          in routes se explicitly bahar rakha gaya hai, isko sirf Dashboard (cross-city
          report) aur Team (admin management) dikhta hai. */}
      <Route
        path="/orders"
        element={
          <ProtectedLayout roles={["admin", "lab", "ops"]}>
            <Orders />
          </ProtectedLayout>
        }
      />
      <Route
        path="/added-tests"
        element={
          <ProtectedLayout roles={["admin", "ops"]}>
            <AddedTests />
          </ProtectedLayout>
        }
      />
      <Route
        path="/payments"
        element={
          <ProtectedLayout roles={["admin", "ops"]}>
            <Payments />
          </ProtectedLayout>
        }
      />
      <Route
        path="/kits"
        element={
          <ProtectedLayout roles={["admin", "ops"]}>
            <Kits />
          </ProtectedLayout>
        }
      />
      <Route
        path="/phlebos"
        element={
          <ProtectedLayout roles={["admin", "ops"]}>
            <Phlebos />
          </ProtectedLayout>
        }
      />
      <Route
        path="/attendance"
        element={
          <ProtectedLayout roles={["admin", "ops"]}>
            <Attendance />
          </ProtectedLayout>
        }
      />
      <Route
        path="/collections"
        element={
          <ProtectedLayout roles={["admin", "ops"]}>
            <Collections />
          </ProtectedLayout>
        }
      />
      <Route
        path="/live-map"
        element={
          <ProtectedLayout roles={["admin", "ops"]}>
            <LiveMap />
          </ProtectedLayout>
        }
      />
      <Route
        path="/lab-tat"
        element={
          <ProtectedLayout roles={["admin", "ops"]}>
            <LabTat />
          </ProtectedLayout>
        }
      />
      <Route
        path="/clients"
        element={
          <ProtectedLayout>
            <Navigate to="/" replace />
          </ProtectedLayout>
        }
      />
      <Route
        path="/team"
        element={
          <ProtectedLayout roles={["superadmin", "admin"]}>
            <Team />
          </ProtectedLayout>
        }
      />
      <Route
        path="/tickets"
        element={
          <ProtectedLayout roles={["superadmin", "admin"]}>
            <Tickets />
          </ProtectedLayout>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
