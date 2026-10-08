import { createContext, useContext, useState, useCallback } from "react";
import { authApi, setSession, clearSession, getToken, getUser } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(getToken());
  const [user, setUser] = useState(getUser());

  const login = useCallback(async (email, password, keepLoggedIn) => {
    const data = await authApi.login(email, password, keepLoggedIn);
    setSession(data.token, data.userdata);
    setToken(data.token);
    setUser(data.userdata);
    return data;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      const next = { ...(prev || {}), ...patch };
      const current = getToken();
      if (current) setSession(current, next);
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, login, logout, updateUser, isAuthed: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
