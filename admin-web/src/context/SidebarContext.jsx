import { createContext, useContext, useState } from "react";

/**
 * Topbar (hamburger button) aur Sidebar (the actual drawer) alag component
 * tree mein hain — Topbar har page ke andar render hota hai, Sidebar sirf
 * ProtectedLayout mein ek baar. Isliye "mobile drawer khula hai ya band"
 * wala state yahan ek chhota context mein rakha hai taaki dono ise share kar sakein.
 */
const SidebarContext = createContext(null);

export function SidebarProvider({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <SidebarContext.Provider value={{ mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
