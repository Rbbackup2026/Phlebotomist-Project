import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import Badge from "../components/Badge.jsx";
import Modal from "../components/Modal.jsx";
import { authApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

/**
 * Superadmin → sees "City Admins" (create one admin per city).
 * Admin      → sees "Labs" for their own city (create multiple labs).
 * Lab role never reaches this page (Sidebar hides it).
 */
export default function Team() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", city: "" });
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");

  const [managing, setManaging] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = isSuperadmin ? await authApi.admins() : await authApi.labs();
      setRows(isSuperadmin ? data.admins || [] : data.labs || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitAdd(e) {
    e.preventDefault();
    setSaving(true);
    setAddError("");
    try {
      if (isSuperadmin) {
        await authApi.registerAdmin(form);
      } else {
        await authApi.registerLab(form);
      }
      setShowAdd(false);
      setForm({ name: "", email: "", password: "", city: "" });
      await load();
    } catch (e) {
      setAddError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(row) {
    setManageError("");
    try {
      if (isSuperadmin) {
        await authApi.setAdminStatus(row._id, row.isActive === false);
      } else {
        await authApi.setLabStatus(row._id, row.isActive === false);
      }
      await load();
      setManaging((m) => (m ? { ...m, isActive: row.isActive === false } : m));
    } catch (e) {
      setManageError(e.message);
    }
  }

  async function submitResetPassword(e) {
    e.preventDefault();
    if (!managing) return;
    setManageBusy(true);
    setManageError("");
    try {
      if (isSuperadmin) {
        await authApi.resetAdminPassword(managing._id, newPassword);
      } else {
        await authApi.resetLabPassword(managing._id, newPassword);
      }
      setNewPassword("");
      setManaging(null);
    } catch (e) {
      setManageError(e.message);
    } finally {
      setManageBusy(false);
    }
  }

  const title = isSuperadmin ? "City Admins" : "Labs";
  const subtitle = isSuperadmin
    ? "One admin per city — share these credentials with that city's owner"
    : `Labs in ${user?.city || "your city"} — samples are assigned from here`;

  return (
    <>
      <Topbar title={title} subtitle={subtitle} />
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <button
            className={
              isSuperadmin
                ? "btn bg-violet-600 text-white hover:bg-violet-500 ml-auto"
                : "btn-primary ml-auto"
            }
            onClick={() => setShowAdd(true)}
          >
            {isSuperadmin ? "+ Create city admin" : "+ Create lab"}
          </button>
        </div>

        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium">City</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      {isSuperadmin ? "No city admins yet" : "No labs yet"}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r._id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                      <td className="px-4 py-3 text-slate-600">{r.email}</td>
                      <td className="px-4 py-3 text-slate-600">{r.city || "—"}</td>
                      <td className="px-4 py-3">
                        <Badge>{r.isActive === false ? "inactive" : "active"}</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            setManaging(r);
                            setNewPassword("");
                            setManageError("");
                          }}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title={isSuperadmin ? "Create city admin" : "Create lab"}
      >
        <form onSubmit={submitAdd} className="space-y-3">
          {addError ? (
            <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{addError}</div>
          ) : null}
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Email (login id)</label>
            <input
              type="email"
              required
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              required
              className="input"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          {isSuperadmin ? (
            <div>
              <label className="label">City</label>
              <input
                required
                className="input"
                placeholder="e.g. Delhi"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                Only one admin is allowed per city.
              </p>
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              City auto-set hogi: <span className="font-medium text-slate-600">{user?.city}</span>
            </div>
          )}
          <button type="submit" disabled={saving} className="btn-primary w-full">
            {saving ? "Saving…" : isSuperadmin ? "Create admin" : "Create lab"}
          </button>
        </form>
      </Modal>

      <Modal
        open={!!managing}
        onClose={() => setManaging(null)}
        title={isSuperadmin ? "Manage city admin" : "Manage lab"}
      >
        {managing ? (
          <div className="space-y-4">
            {manageError ? (
              <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{manageError}</div>
            ) : null}
            <div>
              <div className="text-sm font-medium text-slate-800">{managing.name}</div>
              <div className="text-xs text-slate-400">
                {managing.email} · {managing.city || "—"}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
              <div>
                <div className="text-sm text-slate-700">Account status</div>
                <div className="text-xs text-slate-400">
                  Suspending blocks login — data is not deleted
                </div>
              </div>
              <button
                className={managing.isActive === false ? "btn-primary" : "btn-danger"}
                onClick={() => toggleStatus(managing)}
              >
                {managing.isActive === false ? "Activate" : "Suspend"}
              </button>
            </div>

            <form onSubmit={submitResetPassword} className="space-y-2">
              <label className="label">Reset password</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  required
                  minLength={6}
                  className="input"
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <button type="submit" disabled={manageBusy} className="btn-secondary shrink-0">
                  {manageBusy ? "Saving…" : "Reset"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
