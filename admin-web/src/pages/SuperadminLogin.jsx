import { useState } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

/**
 * Superadmin-only portal — deliberately different look (darker/violet, "Console"
 * branding) from the city Admin/Lab login (Login.jsx) so the two are never
 * confused. A non-superadmin account is rejected here even if the password is
 * correct — they're pointed back to the regular portal.
 */
export default function SuperadminLogin() {
  const { login, logout, isAuthed, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthed && user?.role === "superadmin") return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await login(email, password, keepLoggedIn);
      if (data.userdata?.role !== "superadmin") {
        logout();
        setError("This is the Superadmin Console — City Admin/Lab should use their own login page.");
        return;
      }
      navigate("/");
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-violet-100 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div
            className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold"
            style={{ boxShadow: "0 2px 4px rgba(124,58,237,0.15), 0 12px 24px -8px rgba(124,58,237,0.45)" }}
          >
            ⬡
          </div>
          <h1 className="mt-3 text-slate-900 text-xl font-semibold tracking-tight">Superadmin Console</h1>
          <p className="text-violet-500/80 text-sm">Platform-wide access — all cities</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="card-3d p-6 space-y-4"
        >
          {error ? (
            <div className="rounded-lg bg-rose-50 text-rose-600 text-sm px-3 py-2 border border-rose-100">
              {error}
            </div>
          ) : null}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Email</label>
            <input
              type="email"
              required
              className="w-full rounded-lg bg-violet-50/50 border border-violet-100 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300"
              placeholder="ops@phlebo.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Password</label>
            <input
              type="password"
              required
              className="w-full rounded-lg bg-violet-50/50 border border-violet-100 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={keepLoggedIn}
              onChange={(e) => setKeepLoggedIn(e.target.checked)}
              className="rounded border-violet-200 text-violet-500 focus:ring-violet-300"
            />
            Keep me logged in
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 transition-all"
            style={{ boxShadow: "0 2px 4px rgba(124,58,237,0.2), 0 8px 16px -6px rgba(124,58,237,0.45)" }}
          >
            {loading ? "Signing in…" : "Enter Console"}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500 mt-4">
          City Admin or Lab?{" "}
          <Link to="/login" className="text-violet-600 hover:text-violet-700 font-medium">
            Login here →
          </Link>
        </p>
      </div>
    </div>
  );
}
