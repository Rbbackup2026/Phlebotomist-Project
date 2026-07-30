import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import Badge from "../components/Badge.jsx";
import Modal from "../components/Modal.jsx";
import { adminApi } from "../api.js";

const emptyForm = {
  name: "",
  phone: "",
  employeeId: "",
  zone: "",
  city: "",
  password: "",
  servesAllClients: true,
  clientIds: [],
  slotCapacity: 1,
};

export default function Phlebos() {
  const [phlebos, setPhlebos] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(emptyForm);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editStats, setEditStats] = useState(null);
  const [editCash, setEditCash] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [settling, setSettling] = useState(false);

  const [routeDate, setRouteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [routePlan, setRoutePlan] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");

  const [editIncentive, setEditIncentive] = useState(null);
  const [incentiveLoading, setIncentiveLoading] = useState(false);

  const [editLeaves, setEditLeaves] = useState([]);
  const [leaveForm, setLeaveForm] = useState({ fromDate: "", toDate: "", reason: "" });
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [p, c] = await Promise.all([adminApi.phlebos(), adminApi.clients()]);
      setPhlebos(p.phlebos || []);
      setClients(c.clients || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = phlebos.filter((p) =>
    `${p.name} ${p.phone} ${p.employeeId} ${p.zone} ${p.city}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  async function submitAdd(e) {
    e.preventDefault();
    setAddSaving(true);
    setAddError("");
    try {
      await adminApi.createPhlebo(addForm);
      setShowAdd(false);
      setAddForm(emptyForm);
      await load();
    } catch (e) {
      setAddError(e.message);
    } finally {
      setAddSaving(false);
    }
  }

  async function openEdit(p) {
    setEditing(p);
    setEditForm({
      name: p.name || "",
      zone: p.zone || "",
      city: p.city || "",
      employeeId: p.employeeId || "",
      status: p.status || "active",
      servesAllClients: p.servesAllClients !== false,
      clientIds: p.clientIds || [],
      incentivePerJob: p.incentivePerJob ?? 50,
      targetBonus: p.targetBonus ?? 200,
      slotCapacity: p.slotCapacity ?? 1,
    });
    setEditStats(null);
    setEditCash(null);
    setEditIncentive(null);
    setRoutePlan(null);
    setRouteError("");
    setEditLeaves([]);
    setLeaveForm({ fromDate: "", toDate: "", reason: "" });
    setLeaveError("");
    try {
      const detail = await adminApi.phlebo(p._id);
      setEditStats(detail.stats);
      setEditCash(detail.cash);
    } catch {
      /* non-fatal */
    }
    setIncentiveLoading(true);
    try {
      const inc = await adminApi.phleboIncentive(p._id);
      setEditIncentive(inc);
    } catch {
      /* non-fatal */
    } finally {
      setIncentiveLoading(false);
    }
    loadLeaves(p._id);
  }

  async function loadLeaves(phleboId) {
    try {
      const res = await adminApi.phleboLeaves(phleboId);
      setEditLeaves(res.leaves || []);
    } catch {
      /* non-fatal */
    }
  }

  async function submitLeave() {
    if (!editing) return;
    if (!leaveForm.fromDate || !leaveForm.toDate) {
      return setLeaveError("From and to dates are required");
    }
    setLeaveSaving(true);
    setLeaveError("");
    try {
      await adminApi.markLeave(editing._id, leaveForm);
      setLeaveForm({ fromDate: "", toDate: "", reason: "" });
      await loadLeaves(editing._id);
    } catch (e2) {
      setLeaveError(e2.message);
    } finally {
      setLeaveSaving(false);
    }
  }

  async function removeLeave(leaveId) {
    if (!editing) return;
    try {
      await adminApi.cancelLeave(leaveId);
      await loadLeaves(editing._id);
    } catch (e) {
      alert(e.message);
    }
  }

  async function loadRoute(phleboId, date) {
    setRouteLoading(true);
    setRouteError("");
    try {
      const plan = await adminApi.phleboRoutePlan(phleboId, date);
      setRoutePlan(plan);
    } catch (e) {
      setRouteError(e.message);
    } finally {
      setRouteLoading(false);
    }
  }

  // Editing phlebo change ho ya date badle, route re-fetch karo.
  useEffect(() => {
    if (editing) loadRoute(editing._id, routeDate);
  }, [editing, routeDate]);

  async function handleSettleCash() {
    if (!editing || !editCash?.pendingAmount) return;
    setSettling(true);
    try {
      await adminApi.settleCash(editing._id);
      const detail = await adminApi.phlebo(editing._id);
      setEditCash(detail.cash);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSettling(false);
    }
  }

  async function submitEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      await adminApi.updatePhlebo(editing._id, editForm);
      setEditing(null);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (
      !confirm(
        `${editing.name} (${editing.phone}) — permanently delete? This cannot be undone.`
      )
    ) {
      return;
    }
    setEditSaving(true);
    try {
      await adminApi.deletePhlebo(editing._id);
      setEditing(null);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setEditSaving(false);
    }
  }

  function toggleClient(list, id, setter) {
    setter(
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    );
  }

  return (
    <>
      <Topbar title="Phlebotomists" subtitle="Field staff who collect samples" />
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            className="input max-w-xs"
            placeholder="Search name, phone, zone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn-primary ml-auto" onClick={() => setShowAdd(true)}>
            + Add phlebotomist
          </button>
        </div>

        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">Zone / City</th>
                  <th className="text-left px-4 py-3 font-medium">Duty</th>
                  <th className="text-left px-4 py-3 font-medium">Lab(s) assigned</th>
                  <th className="text-left px-4 py-3 font-medium">Completed / Pending</th>
                  <th className="text-left px-4 py-3 font-medium">Today's Kms</th>
                  <th className="text-left px-4 py-3 font-medium">Rating</th>
                  <th className="text-left px-4 py-3 font-medium">Cash pending</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                      No phlebotomists found
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => (
                    <tr key={p._id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{p.name}</div>
                        <div className="text-xs text-slate-400">{p.employeeId}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{p.phone}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {p.zone || "—"} {p.city ? `· ${p.city}` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <Badge>{p.dutyStatus === "on_duty" ? "active" : "inactive"}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {(p.labs || []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {p.labs.map((lab) => (
                              <span
                                key={lab}
                                className="inline-flex items-center rounded-full bg-violet-50 text-violet-700 px-2.5 py-0.5 text-xs font-medium"
                              >
                                {lab}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-xs font-medium">
                            ✓ {p.completedJobs || 0}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2.5 py-0.5 text-xs font-medium">
                            ⏳ {p.pendingJobs || 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {typeof p.todayDistanceKm === "number" ? `${p.todayDistanceKm.toFixed(1)} km` : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {p.rating ?? "—"} ★{p.ratingCount ? ` (${p.ratingCount})` : ""}
                      </td>
                      <td className="px-4 py-3">
                        {p.cashPending > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2.5 py-0.5 text-xs font-medium">
                            ₹{p.cashPending} · {p.cashPendingCount} order{p.cashPendingCount === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge>{p.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="btn-secondary" onClick={() => openEdit(p)}>
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

      {/* Add modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add phlebotomist">
        <form onSubmit={submitAdd} className="space-y-3">
          {addError ? (
            <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{addError}</div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Name</label>
              <input
                required
                className="input"
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                required
                className="input"
                value={addForm.phone}
                onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Employee ID</label>
              <input
                className="input"
                placeholder="auto-generated if blank"
                value={addForm.employeeId}
                onChange={(e) => setAddForm({ ...addForm, employeeId: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Password (Ops use only)</label>
              <input
                type="password"
                className="input"
                value={addForm.password}
                onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Zone</label>
              <input
                className="input"
                value={addForm.zone}
                onChange={(e) => setAddForm({ ...addForm, zone: e.target.value })}
              />
            </div>
            <div>
              <label className="label">City</label>
              <input
                className="input"
                value={addForm.city}
                onChange={(e) => setAddForm({ ...addForm, city: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Slot capacity</label>
              <input
                type="number"
                min="1"
                className="input"
                value={addForm.slotCapacity}
                onChange={(e) => setAddForm({ ...addForm, slotCapacity: e.target.value })}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                How many jobs can be taken in the same slot at once (default 1)
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={addForm.servesAllClients}
              onChange={(e) => setAddForm({ ...addForm, servesAllClients: e.target.checked })}
              className="rounded border-slate-300 text-brand-500 focus:ring-brand-400"
            />
            Serves all partner websites
          </label>

          {!addForm.servesAllClients ? (
            <div>
              <div className="label mb-1.5">Allowed websites</div>
              <div className="flex flex-wrap gap-2">
                {clients.map((c) => (
                  <button
                    type="button"
                    key={c._id}
                    onClick={() =>
                      toggleClient(addForm.clientIds, c._id, (v) =>
                        setAddForm({ ...addForm, clientIds: v })
                      )
                    }
                    className={`text-xs rounded-full px-3 py-1 border ${
                      addForm.clientIds.includes(c._id)
                        ? "bg-brand-500 text-white border-brand-500"
                        : "border-slate-200 text-slate-600"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <button type="submit" disabled={addSaving} className="btn-primary w-full">
            {addSaving ? "Saving…" : "Add phlebotomist"}
          </button>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Manage phlebotomist">
        {editing && editForm ? (
          <form onSubmit={submitEdit} className="space-y-4">
            {editStats ? (
              <div className="grid grid-cols-4 gap-2 text-center">
                <MiniStat label="Total" value={editStats.totalJobs} />
                <MiniStat label="Done" value={editStats.completed} />
                <MiniStat label="Active" value={editStats.active} />
                <MiniStat label="Rejected" value={editStats.rejected} />
              </div>
            ) : null}

            {incentiveLoading ? (
              <div className="text-xs text-slate-400">Loading incentive…</div>
            ) : editIncentive ? (
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                <div className="text-sm font-semibold text-emerald-800">
                  Today's incentive: ₹{editIncentive.total}
                </div>
                <div className="text-xs text-emerald-700/80 mt-1">
                  {editIncentive.jobsDone} job{editIncentive.jobsDone === 1 ? "" : "s"} × ₹{editIncentive.perJob}
                  {" = ₹"}{editIncentive.base}
                  {editIncentive.bonus > 0 ? ` + ₹${editIncentive.bonus} target bonus` : ""}
                  {editIncentive.target > 0 && !editIncentive.targetReached
                    ? ` (target ${editIncentive.target} not yet met)`
                    : ""}
                </div>
              </div>
            ) : null}

            {editCash?.pendingAmount > 0 ? (
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-amber-800">
                      ₹{editCash.pendingAmount} cash pending
                    </div>
                    <div className="text-xs text-amber-700/80">
                      {editCash.pendingCount} order{editCash.pendingCount === 1 ? "" : "s"} — still need to be handed over at the office/lab
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={settling}
                    onClick={handleSettleCash}
                    className="btn bg-amber-500 text-white hover:bg-amber-600 shrink-0"
                  >
                    {settling ? "Saving…" : "Mark received"}
                  </button>
                </div>
                <div className="mt-3 space-y-1 max-h-32 overflow-y-auto">
                  {(editCash.jobs || []).map((j) => (
                    <div
                      key={j._id}
                      className="flex justify-between text-xs text-amber-800/90 bg-white/60 rounded-lg px-2.5 py-1.5"
                    >
                      <span>{j.patientName}</span>
                      <span className="font-medium">₹{j.totalAmount}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : editCash ? (
              <div className="text-xs text-slate-400">No pending cash to settle.</div>
            ) : null}

            {/* Leave / planned unavailability — Collections tracking grid isko
                "on_leave" ke roop mein dikhati hai, aur auto-assign is window mein
                naya job is phlebo ko nahi deta (services/autoAssign.js). */}
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="text-sm font-semibold text-slate-700 mb-2">Leave / unavailability</div>
              {leaveError ? (
                <div className="rounded-lg bg-rose-50 text-rose-700 text-xs px-3 py-2 mb-2">{leaveError}</div>
              ) : null}
              {/* Plain div (NOT a nested <form>) — this whole card sits inside the
                  outer "Manage phlebotomist" <form onSubmit={submitEdit}>, and HTML
                  doesn't allow forms inside forms. Button below calls submitLeave()
                  directly instead of relying on form submit. */}
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <div>
                  <label className="label">From</label>
                  <input
                    type="date"
                    className="input !py-1 text-xs"
                    value={leaveForm.fromDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, fromDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">To</label>
                  <input
                    type="date"
                    className="input !py-1 text-xs"
                    value={leaveForm.toDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, toDate: e.target.value })}
                  />
                </div>
                <div className="flex-1 min-w-[120px]">
                  <label className="label">Reason (optional)</label>
                  <input
                    className="input !py-1 text-xs"
                    value={leaveForm.reason}
                    onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  disabled={leaveSaving}
                  onClick={submitLeave}
                  className="btn-secondary !py-1.5 text-xs"
                >
                  {leaveSaving ? "Saving…" : "Mark leave"}
                </button>
              </div>
              {editLeaves.length === 0 ? (
                <div className="text-xs text-slate-400">No leave records</div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {editLeaves.map((l) => (
                    <div
                      key={l._id}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs"
                    >
                      <span>
                        {l.fromDate}
                        {l.toDate !== l.fromDate ? ` → ${l.toDate}` : ""}
                        {l.reason ? ` · ${l.reason}` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLeave(l._id)}
                        className="text-rose-500 hover:text-rose-700 font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Route optimization — us din ke saare (non-terminal) orders ko nearest-
                neighbor se ordered stops mein dikhata hai, jaisa phlebo app khud dikhata
                hai, taaki admin dispatch/oversight ke liye plan dekh sake. */}
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-sm font-semibold text-slate-700">Today's route</div>
                <input
                  type="date"
                  className="input !w-auto !py-1 text-xs"
                  value={routeDate}
                  onChange={(e) => setRouteDate(e.target.value)}
                />
              </div>

              {routeLoading ? (
                <div className="text-xs text-slate-400 py-3 text-center">Loading route…</div>
              ) : routeError ? (
                <div className="text-xs text-rose-600">{routeError}</div>
              ) : routePlan && routePlan.totalStops === 0 ? (
                <div className="text-xs text-slate-400 py-3 text-center">
                  No active orders for this date
                </div>
              ) : routePlan ? (
                <div className="space-y-2">
                  <div className="text-xs text-slate-500">
                    {routePlan.totalStops} stop{routePlan.totalStops === 1 ? "" : "s"} · ~
                    {routePlan.totalDistanceKm} km · ~{routePlan.totalEtaMin} min
                    {routePlan.startedFrom?.source === "phlebo_location"
                      ? " (from live location)"
                      : routePlan.startedFrom
                      ? " (from first slot-time job)"
                      : ""}
                  </div>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {routePlan.route.map((stop) => (
                      <div
                        key={stop.job.id}
                        className="flex items-start gap-2.5 bg-slate-50 rounded-lg px-2.5 py-2"
                      >
                        <span className="shrink-0 h-5 w-5 rounded-full bg-brand-500 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">
                          {stop.order}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-slate-700 truncate">
                            {stop.job.patientName} · {stop.job.slotTime}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {stop.job.address}
                          </div>
                        </div>
                        <div className="shrink-0 text-[11px] text-slate-400 text-right">
                          +{stop.distanceFromPrevKm}km
                          <br />
                          {stop.etaMinFromPrev}m
                        </div>
                      </div>
                    ))}
                  </div>
                  {routePlan.unlocated?.length ? (
                    <div className="text-[11px] text-amber-600">
                      {routePlan.unlocated.length} order(s) could not be geocoded — not included in the route
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Employee ID</label>
                <input
                  className="input"
                  value={editForm.employeeId}
                  onChange={(e) => setEditForm({ ...editForm, employeeId: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Zone</label>
                <input
                  className="input"
                  value={editForm.zone}
                  onChange={(e) => setEditForm({ ...editForm, zone: e.target.value })}
                />
              </div>
              <div>
                <label className="label">City</label>
                <input
                  className="input"
                  value={editForm.city}
                  onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Incentive per job (₹)</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={editForm.incentivePerJob}
                  onChange={(e) => setEditForm({ ...editForm, incentivePerJob: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Daily target bonus (₹)</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={editForm.targetBonus}
                  onChange={(e) => setEditForm({ ...editForm, targetBonus: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Slot capacity</label>
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={editForm.slotCapacity}
                  onChange={(e) => setEditForm({ ...editForm, slotCapacity: e.target.value })}
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  How many jobs per slot (more than 1 if assistant/team)
                </p>
              </div>
              <div className="col-span-2">
                <label className="label">Status</label>
                <select
                  className="input"
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={editForm.servesAllClients}
                onChange={(e) => setEditForm({ ...editForm, servesAllClients: e.target.checked })}
                className="rounded border-slate-300 text-brand-500 focus:ring-brand-400"
              />
              Serves all partner websites
            </label>

            {!editForm.servesAllClients ? (
              <div>
                <div className="label mb-1.5">Allowed websites</div>
                <div className="flex flex-wrap gap-2">
                  {clients.map((c) => (
                    <button
                      type="button"
                      key={c._id}
                      onClick={() =>
                        toggleClient(editForm.clientIds, c._id, (v) =>
                          setEditForm({ ...editForm, clientIds: v })
                        )
                      }
                      className={`text-xs rounded-full px-3 py-1 border ${
                        editForm.clientIds.includes(c._id)
                          ? "bg-brand-500 text-white border-brand-500"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <button type="submit" disabled={editSaving} className="btn-primary w-full">
              {editSaving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={editSaving}
              onClick={handleDelete}
              className="btn-danger w-full"
            >
              Delete phlebotomist
            </button>
          </form>
        ) : null}
      </Modal>
    </>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 py-2">
      <div className="text-lg font-bold text-slate-800">{value ?? 0}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}
