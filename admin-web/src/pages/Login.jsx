import { useState } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

/** City Admin & Lab portal. Superadmin has its own separate login (SuperadminLogin.jsx). */
export default function Login() {
  const { login, logout, isAuthed } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthed) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await login(email, password, keepLoggedIn);
      if (data.userdata?.role === "superadmin") {
        logout();
        setError("This is a superadmin account — sign in via the Superadmin Portal.");
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="h-12 w-12 rounded-xl bg-brand-500 flex items-center justify-center text-white text-xl font-bold shadow-card">
            P
          </div>
          <h1 className="mt-3 text-white text-xl font-semibold">Phlebo Ops Admin</h1>
          <p className="text-slate-400 text-sm">Sign in to manage orders &amp; field staff</p>
        </div>

        <form onSubmit={onSubmit} className="card p-6 space-y-4">
          {error ? (
            <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{error}</div>
          ) : null}
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              required
              className="input"
              placeholder="ops@phlebo.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              required
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={keepLoggedIn}
              onChange={(e) => setKeepLoggedIn(e.target.checked)}
              className="rounded border-slate-300 text-brand-500 focus:ring-brand-400"
            />
            Keep me logged in
          </label>
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500 mt-4">
          Superadmin?{" "}
          <Link to="/super-login" className="text-brand-400 hover:text-brand-300 font-medium">
            Login here →
          </Link>
        </p>
      </div>
    </div>
  );
}
