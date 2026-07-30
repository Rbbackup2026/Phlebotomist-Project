import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useSidebar } from "../context/SidebarContext.jsx";

const baseItems = [
  { to: "/", label: "Dashboard", icon: "▦", end: true },
  { to: "/orders", label: "Orders", icon: "🧾" },
  { to: "/live-map", label: "Live Map", icon: "🗺️" },
  { to: "/added-tests", label: "Added Tests", icon: "➕" },
  { to: "/payments", label: "Payments", icon: "💳" },
  { to: "/kits", label: "Kit Inventory", icon: "🧪" },
  { to: "/phlebos", label: "Phlebotomists", icon: "🧑‍⚕️" },
  { to: "/attendance", label: "Attendance", icon: "🕘" },
  { to: "/collections", label: "Collections", icon: "📅" },
  { to: "/lab-tat", label: "Lab TAT", icon: "⏱️" },
  { to: "/clients", label: "Clients", icon: "🌐" },
];

// Superadmin manages city Admins; Admin manages their city's Labs. Lab role
// (single city, single lab) doesn't get this section at all.
const teamItem = { to: "/team", label: "Team", icon: "👥" };

const COLLAPSE_KEY = "phlebo_admin_sidebar_collapsed";

export default function Sidebar() {
  const { user } = useAuth();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const role = user?.role;
  const isSuperadmin = role === "superadmin";

  // Desktop collapse (icon-only) — remembered across reloads. Mobile always
  // opens full-width as an overlay drawer, collapse only applies to md+.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Superadmin sirf oversight karta hai — cross-city report (Dashboard) + Team
  // (city admins ka account management). Din-ke-din operational pages
  // (Orders/Phlebos/Kits/etc.) sirf city Admin (aur Lab) ko dikhte hain, jo
  // apne city ke andar actual data edit karte hain.
  // Lab sirf apne assign kiye samples dekhti hai — Dashboard (apna summary) +
  // Orders (assigned list) ke alawa kuch nahi chahiye. Added Tests/Payments/
  // Kits/Phlebos/Clients sab city-Admin ka operational territory hai.
  const items =
    role === "superadmin"
      ? [baseItems[0], teamItem]
      : role === "admin"
      ? [...baseItems, teamItem]
      : role === "lab"
      ? [baseItems[0], baseItems[1]]
      : baseItems;

  const roleLabel =
    role === "superadmin"
      ? "All cities · full oversight"
      : role === "lab"
      ? `Lab · ${user?.city || "—"}`
      : role === "admin"
      ? `City Admin · ${user?.city || "—"}`
      : "Ops Panel";

  // Superadmin ka shell jaanbujh kar alag dikhta hai — halka lavender + "raised"
  // 3D pills. Baaki roles ke liye dark slate theme jaisa pehle tha.
  const theme = isSuperadmin
    ? {
        aside: "bg-gradient-to-b from-violet-50 to-white border-r border-violet-100",
        logoBg: "bg-gradient-to-br from-violet-500 to-violet-600",
        logoShadow: "0 2px 4px rgba(124,58,237,0.2), 0 6px 14px -4px rgba(124,58,237,0.45)",
        brandText: "text-slate-900",
        subText: "text-violet-500/80",
        itemActive: "bg-white text-violet-700",
        itemActiveShadow: "0 1px 2px rgba(109,40,217,0.06), 0 6px 14px -6px rgba(109,40,217,0.35)",
        itemInactive: "text-slate-500 hover:bg-white/70 hover:text-violet-600",
        footerBorder: "border-violet-100",
        footerText: "text-violet-400/70",
        footerLabel: "Platform-wide · read-only",
        ghostBtn: "text-violet-400 hover:text-violet-600 hover:bg-white/70",
        brandLabel: "Superadmin",
        logoMark: "⬡",
      }
    : {
        aside: "bg-slate-900",
        logoBg: "bg-brand-500",
        logoShadow: "none",
        brandText: "text-white",
        subText: "text-slate-500",
        itemActive: "bg-brand-500/10 text-white ring-1 ring-inset ring-brand-500/30",
        itemActiveShadow: undefined,
        itemInactive: "text-slate-400 hover:bg-white/5 hover:text-white",
        footerBorder: "border-white/5",
        footerText: "text-slate-600",
        footerLabel: "PhleboBackend · own DB",
        ghostBtn: "text-slate-500 hover:text-white hover:bg-white/5",
        brandLabel: "Phlebo Ops",
        logoMark: "P",
      };

  return (
    <>
      {/* Mobile backdrop — sidebar khula ho tabhi dikhta hai, tap karke band ho jaata hai */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 bg-slate-900/50 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col min-h-screen shrink-0 transition-all duration-200 ease-in-out
          ${theme.aside}
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0
          ${collapsed ? "md:w-[76px]" : "md:w-60"} w-64
          md:static md:z-auto`}
      >
        <div className={`px-4 py-6 flex items-center gap-2.5 ${collapsed ? "md:justify-center md:px-0" : ""}`}>
          <div
            className={`h-9 w-9 rounded-xl flex items-center justify-center text-white font-bold shrink-0 ${theme.logoBg}`}
            style={{ boxShadow: theme.logoShadow }}
          >
            {theme.logoMark}
          </div>
          <div className={collapsed ? "md:hidden" : "min-w-0"}>
            <div className={`font-semibold leading-none truncate ${theme.brandText}`}>{theme.brandLabel}</div>
            <div className={`text-[11px] mt-0.5 truncate ${theme.subText}`}>{roleLabel}</div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className={`ml-auto md:hidden h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${theme.ghostBtn}`}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-1.5 overflow-y-auto">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              title={it.label}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  collapsed ? "md:justify-center md:px-0" : ""
                } ${isActive ? theme.itemActive : theme.itemInactive}`
              }
              style={({ isActive }) => (isActive ? { boxShadow: theme.itemActiveShadow } : undefined)}
            >
              <span className="text-base shrink-0">{it.icon}</span>
              <span className={collapsed ? "md:hidden" : ""}>{it.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Desktop-only collapse/expand toggle — mobile drawer hamesha full-width khulta hai */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={`hidden md:flex items-center gap-2 mx-3 mb-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            collapsed ? "justify-center" : ""
          } ${theme.ghostBtn}`}
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          <span>{collapsed ? "»" : "«"}</span>
          {!collapsed ? <span>Collapse</span> : null}
        </button>

        <div className={`px-5 py-4 text-[11px] border-t ${theme.footerBorder} ${theme.footerText} ${collapsed ? "md:hidden" : ""}`}>
          {theme.footerLabel}
        </div>
      </aside>
    </>
  );
}
