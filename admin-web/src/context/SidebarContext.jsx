import { createContext, useContext, useEffect, useState } from "react";

/**
 * Topbar (hamburger / collapse button) aur Sidebar alag component tree mein
 * hain — Topbar har page ke andar render hota hai, Sidebar sirf
 * ProtectedLayout mein ek baar. Mobile drawer + desktop collapse dono states
 * yahan share hote hain taaki topbar se left menu open/close ho sake.
 */
const SidebarContext = createContext(null);

const COLLAPSE_KEY = "phlebo_admin_sidebar_collapsed";

export function SidebarProvider({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop collapse (icon-only) — remembered across reloads.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1"
  );

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const toggleCollapsed = () => setCollapsed((c) => !c);
  const toggleMobile = () => setMobileOpen((o) => !o);

  return (
    <SidebarContext.Provider
      value={{
        mobileOpen,
        setMobileOpen,
        toggleMobile,
        collapsed,
        setCollapsed,
        toggleCollapsed,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
