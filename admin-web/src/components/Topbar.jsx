import { useAuth } from "../context/AuthContext.jsx";
import { useSidebar } from "../context/SidebarContext.jsx";
import { useNavigate } from "react-router-dom";

export default function Topbar({ title, subtitle }) {
  const { user, logout } = useAuth();
  const { mobileOpen, setMobileOpen, collapsed, toggleCollapsed } = useSidebar();
  const navigate = useNavigate();
  const isSuperadmin = user?.role === "superadmin";

  return (
    <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-slate-200 px-4 md:px-8 py-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {/* Mobile: open/close drawer */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden h-9 w-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 shrink-0"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          title={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
        {/* Desktop: collapse/expand left sidebar */}
        <button
          onClick={toggleCollapsed}
          className="hidden md:inline-flex h-9 w-9 rounded-lg items-center justify-center text-slate-500 hover:bg-slate-100 shrink-0 border border-slate-200"
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          {collapsed ? "☰" : "«"}
        </button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
            {isSuperadmin ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-700 px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-violet-200">
                ⬡ Superadmin
              </span>
            ) : null}
          </div>
          {subtitle ? <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p> : null}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <div className="text-sm font-medium text-slate-800">{user?.name || "Ops Admin"}</div>
          <div className="text-xs text-slate-500">
            {user?.email}
            {user?.city ? ` · ${user.city}` : ""}
          </div>
        </div>
        <div
          className={`h-9 w-9 rounded-full flex items-center justify-center font-semibold text-sm ${
            isSuperadmin ? "bg-violet-100 text-violet-700" : "bg-brand-100 text-brand-700"
          }`}
        >
          {(user?.name || "O").charAt(0).toUpperCase()}
        </div>
        <button
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="btn-secondary"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
