import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Topbar from "../components/Topbar.jsx";
import Badge from "../components/Badge.jsx";
import Modal from "../components/Modal.jsx";
import DateRangeBar from "../components/DateRangeBar.jsx";
import TestPicker from "../components/TestPicker.jsx";
import { useDateRange } from "../hooks/useDateRange.js";
import { adminApi, authApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

/** Normalize free-form slotDate → YYYY-MM-DD for Collections deep links. */
function toYmd(raw) {
  const s = String(raw || "").trim();
  if (!s) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function collectionsHref(slotDate, opts = {}) {
  const params = new URLSearchParams({ date: toYmd(slotDate) });
  if (opts.focusUnassigned) params.set("focus", "unassigned");
  return `/collections?${params.toString()}`;
}

const emptyNewOrder = {
  clientId: "",
  patientName: "",
  mobileNumber: "",
  gender: "",
  address: "",
  city: "",
  area: "",
  state: "",
  pincode: "",
  slotDate: "",
  slotTime: "",
  paymentMethod: "COD",
  specialInstructions: "",
};

const STATUS_OPTIONS = ["All", "Booked", "Sample Collected", "Processing", "Cancelled"];
const PHLEBO_STATUS_OPTIONS = [
  "All",
  "NeedsAssign",
  "Assigned",
  "Accepted",
  "Rejected",
  "En Route",
  "Arrived",
  "OTP Verified",
  "Consent Done",
  "Sample Collected",
  "Handed Off",
];

export default function Orders() {
  const { user } = useAuth();
  // Sirf city Admin operational edits (create/assign) kar sakta hai. Superadmin
  // is page tak pahunchta hi nahi (App.jsx route guard) — Lab yahan sirf apne
  // assign kiye orders view karti hai, edit buttons nahi dikhte.
  const canManage = user?.role === "admin";
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [clients, setClients] = useState([]);
  const [phlebos, setPhlebos] = useState([]);
  const [labs, setLabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [status, setStatus] = useState(searchParams.get("status") || "All");
  const [phleboStatus, setPhleboStatus] = useState(searchParams.get("phleboStatus") || "All");
  const [clientSlug, setClientSlug] = useState(searchParams.get("clientSlug") || "");

  const [assignFor, setAssignFor] = useState(null);
  const [labAssignFor, setLabAssignFor] = useState(null);
  const [detailFor, setDetailFor] = useState(null);
  const [assignSaving, setAssignSaving] = useState(false);
  const { preset, range, applyPreset, setCustom } = useDateRange("30d");

  const [rescheduleFor, setRescheduleFor] = useState(null);
  const [rescheduleForm, setRescheduleForm] = useState({ slotDate: "", slotTime: "", phleboId: "" });
  const [rescheduleSaving, setRescheduleSaving] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");

  const [showNewOrder, setShowNewOrder] = useState(false);
  const [newOrder, setNewOrder] = useState(emptyNewOrder);
  const [newOrderItems, setNewOrderItems] = useState([]);
  const [newOrderSaving, setNewOrderSaving] = useState(false);
  const [newOrderError, setNewOrderError] = useState("");

  const [addTestSaving, setAddTestSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [o, c, p, l] = await Promise.all([
        adminApi.orders({ status, phleboStatus, clientSlug, from: range.from, to: range.to, limit: 200 }),
        canManage ? adminApi.clients() : Promise.resolve({ clients: [] }),
        canManage ? adminApi.phlebos() : Promise.resolve({ phlebos: [] }),
        canManage ? authApi.labs() : Promise.resolve({ labs: [] }),
      ]);
      setOrders(o.orders || []);
      setClients(c.clients || []);
      setPhlebos(p.phlebos || []);
      setLabs(l.labs || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, phleboStatus, clientSlug, range]);

  // Dashboard se link karke aane par (jaise ?phleboStatus=NeedsAssign) filters sync karo
  useEffect(() => {
    const s = searchParams.get("status");
    const ps = searchParams.get("phleboStatus");
    const cs = searchParams.get("clientSlug");
    if (s && s !== status) setStatus(s);
    if (ps && ps !== phleboStatus) setPhleboStatus(ps);
    if (cs !== null && cs !== clientSlug) setClientSlug(cs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const eligiblePhlebos = useMemo(() => {
    if (!assignFor) return [];
    return phlebos.filter(
      (p) => p.servesAllClients || (p.clientIds || []).includes(assignFor.clientId)
    );
  }, [assignFor, phlebos]);

  // City ke andar multiple labs ho sakti hain — order jis city ka hai sirf usi
  // city ki labs dikhao (superadmin ke liye labs list saari cities ki aati hai).
  const eligibleLabs = useMemo(() => {
    if (!labAssignFor) return [];
    return labs.filter((l) => !labAssignFor.city || l.city === labAssignFor.city);
  }, [labAssignFor, labs]);

  const needsAssignOrders = useMemo(
    () => orders.filter((o) => !o.assignedPhlebo),
    [orders]
  );

  async function doAssign(phleboId) {
    setAssignSaving(true);
    try {
      await adminApi.assignPhlebo(assignFor._id, phleboId);
      setAssignFor(null);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setAssignSaving(false);
    }
  }

  async function doAssignLab(labId) {
    setAssignSaving(true);
    try {
      await adminApi.assignLab(labAssignFor._id, labId);
      setLabAssignFor(null);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setAssignSaving(false);
    }
  }

  const eligiblePhlebosForReschedule = useMemo(() => {
    if (!rescheduleFor) return [];
    return phlebos.filter(
      (p) => p.servesAllClients || (p.clientIds || []).includes(rescheduleFor.clientId)
    );
  }, [rescheduleFor, phlebos]);

  function openReschedule(order) {
    setRescheduleFor(order);
    setRescheduleForm({ slotDate: "", slotTime: order.slotTime || "", phleboId: "" });
    setRescheduleError("");
  }

  async function submitReschedule(e) {
    e.preventDefault();
    if (!rescheduleFor) return;
    if (!rescheduleForm.slotDate || !rescheduleForm.slotTime) {
      return setRescheduleError("New date and time are required");
    }
    setRescheduleSaving(true);
    setRescheduleError("");
    try {
      await adminApi.rescheduleOrder(rescheduleFor._id, {
        slotDate: rescheduleForm.slotDate,
        slotTime: rescheduleForm.slotTime,
        phleboId: rescheduleForm.phleboId || undefined,
      });
      setRescheduleFor(null);
      await load();
    } catch (e2) {
      setRescheduleError(e2.message);
    } finally {
      setRescheduleSaving(false);
    }
  }

  function openNewOrder() {
    setNewOrder(emptyNewOrder);
    setNewOrderItems([]);
    setNewOrderError("");
    setShowNewOrder(true);
  }

  function addNewOrderItem(item) {
    setNewOrderItems((list) => {
      const existing = list.find((i) => i.productId && i.productId === item.productId);
      if (existing) {
        return list.map((i) =>
          i === existing ? { ...i, quantity: (i.quantity || 1) + 1 } : i
        );
      }
      return [...list, item];
    });
  }

  function removeNewOrderItem(idx) {
    setNewOrderItems((list) => list.filter((_, i) => i !== idx));
  }

  const newOrderTotal = newOrderItems.reduce(
    (s, i) => s + (i.price || 0) * (i.quantity || 1),
    0
  );

  async function submitNewOrder(e) {
    e.preventDefault();
    setNewOrderError("");
    if (!newOrder.clientId) return setNewOrderError("Please select a website");
    if (!newOrder.patientName || !newOrder.address || !newOrder.slotDate || !newOrder.slotTime) {
      return setNewOrderError("Patient name, address, and slot date/time are required");
    }
    setNewOrderSaving(true);
    try {
      await adminApi.createOrder({ ...newOrder, items: newOrderItems });
      setShowNewOrder(false);
      await load();
    } catch (e2) {
      setNewOrderError(e2.message);
    } finally {
      setNewOrderSaving(false);
    }
  }

  async function addTestToDetail(item) {
    if (!detailFor) return;
    setAddTestSaving(true);
    try {
      const res = await adminApi.addTestToOrder(detailFor._id, item);
      setDetailFor(res.job);
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setAddTestSaving(false);
    }
  }

  const [rejectSaving, setRejectSaving] = useState(false);
  async function rejectSample(barcode) {
    if (!detailFor) return;
    const reason = prompt("Rejection reason (e.g. haemolyzed, insufficient quantity)?");
    if (reason === null) return; // cancelled
    setRejectSaving(true);
    try {
      const res = await adminApi.rejectSample(detailFor._id, barcode, {
        reason,
        createRedraw: true,
      });
      setDetailFor(res.order);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setRejectSaving(false);
    }
  }

  return (
    <>
      <Topbar title="Orders" subtitle="All bookings across partner websites" />
      <div className="p-4 md:p-8 space-y-4">
        {canManage ? (
          <div className="flex justify-end">
            <button className="btn-primary" onClick={openNewOrder}>
              + New order (phone/walk-in)
            </button>
          </div>
        ) : null}

        <DateRangeBar preset={preset} range={range} onPreset={applyPreset} onCustom={setCustom} />

        {canManage ? (
          <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-amber-900">
                Dispatch board
                {needsAssignOrders.length > 0 ? (
                  <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-bold">
                    {needsAssignOrders.length} unassigned in this list
                  </span>
                ) : (
                  <span className="ml-2 text-xs font-medium text-slate-500">No unassigned in this list</span>
                )}
              </div>
              <p className="text-xs text-amber-800/80 mt-0.5">
                See free phlebo slots on Collections and assign from green cells — Orders stays for search & details.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              {needsAssignOrders.length > 0 ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPhleboStatus("NeedsAssign")}
                >
                  Show needs assignment
                </button>
              ) : null}
              <Link
                to={collectionsHref(new Date().toISOString().slice(0, 10), { focusUnassigned: true })}
                className="btn-primary"
              >
                Open Collections
              </Link>
            </div>
          </div>
        ) : null}

        <div className="card p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Order status</label>
            <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Phlebo status</label>
            <select
              className="input w-44"
              value={phleboStatus}
              onChange={(e) => setPhleboStatus(e.target.value)}
            >
              {PHLEBO_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "NeedsAssign" ? "Needs assignment" : s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Website</label>
            <select
              className="input w-44"
              value={clientSlug}
              onChange={(e) => setClientSlug(e.target.value)}
            >
              <option value="">All websites</option>
              {clients.map((c) => (
                <option key={c._id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-secondary ml-auto" onClick={load}>
            Refresh
          </button>
        </div>

        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Patient</th>
                  <th className="text-left px-4 py-3 font-medium">Website</th>
                  <th className="text-left px-4 py-3 font-medium">Slot</th>
                  <th className="text-left px-4 py-3 font-medium">Phlebo status</th>
                  <th className="text-left px-4 py-3 font-medium">Payment</th>
                  <th className="text-left px-4 py-3 font-medium">Assigned to</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      Loading orders…
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      No orders match these filters
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => (
                    <tr key={o._id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{o.patientName}</div>
                        <div className="text-xs text-slate-400">
                          {o.pickupId || `#${String(o._id).slice(-6).toUpperCase()}`} · {o.mobileNumber}
                        </div>
                        {o.isRedraw ? (
                          <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[10px] font-medium mt-1">
                            Redraw
                          </span>
                        ) : null}
                        {o.walkInSourceJobId ? (
                          <span className="inline-flex items-center rounded-full bg-violet-50 text-violet-700 px-2 py-0.5 text-[10px] font-medium mt-1 ml-1">
                            Walk-in
                          </span>
                        ) : null}
                        {o.rescheduleRequested ? (
                          <span className="inline-flex items-center rounded-full bg-rose-50 text-rose-700 px-2 py-0.5 text-[10px] font-medium mt-1 ml-1">
                            Patient asked to reschedule
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{o.clientName || o.clientSlug}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {o.slotDate} · {o.slotTime}
                      </td>
                      <td className="px-4 py-3">
                        <Badge>{o.phleboStatus || "Unassigned"}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge>{o.paymentStatus}</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>{o.assignedPhleboName || "—"}</div>
                        {o.assignedLabName ? (
                          <div className="text-xs text-slate-400">Lab: {o.assignedLabName}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button className="btn-secondary" onClick={() => setDetailFor(o)}>
                            View
                          </button>
                          {canManage ? (
                            <>
                              <button className="btn-primary" onClick={() => setAssignFor(o)}>
                                Assign
                              </button>
                              {!o.assignedPhlebo ? (
                                <Link
                                  to={collectionsHref(o.slotDate, { focusUnassigned: true })}
                                  className="btn-secondary"
                                  title="Assign on free slot board"
                                >
                                  Dispatch
                                </Link>
                              ) : null}
                              <button className="btn-secondary" onClick={() => setLabAssignFor(o)}>
                                Lab
                              </button>
                              {!["Sample Collected", "Handed Off"].includes(o.phleboStatus) ? (
                                <button className="btn-secondary" onClick={() => openReschedule(o)}>
                                  Reschedule
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title="Assign phlebotomist">
        {assignFor ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Order for <span className="font-medium text-slate-700">{assignFor.patientName}</span> ·{" "}
              {assignFor.clientName || assignFor.clientSlug}
            </p>
            <Link
              to={collectionsHref(assignFor.slotDate, { focusUnassigned: !assignFor.assignedPhlebo })}
              className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-left hover:bg-emerald-100/80 transition-colors"
              onClick={() => setAssignFor(null)}
            >
              <div>
                <div className="text-sm font-semibold text-emerald-900">Open on Collections board</div>
                <div className="text-xs text-emerald-800/80">
                  {assignFor.slotDate} · {assignFor.slotTime || "—"} — pick a free green slot
                </div>
              </div>
              <span className="text-emerald-700 text-sm font-bold shrink-0">Go →</span>
            </Link>
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {eligiblePhlebos.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">
                  No phlebotomist is eligible for this website
                </p>
              ) : (
                eligiblePhlebos.map((p) => (
                  <button
                    key={p._id}
                    disabled={assignSaving}
                    onClick={() => doAssign(p._id)}
                    className="w-full flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:border-brand-300 hover:bg-brand-50/50 transition-colors disabled:opacity-50"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-800">{p.name}</div>
                      <div className="text-xs text-slate-400">
                        {p.employeeId} · {p.zone || p.city || "—"}
                        {p.dutyStatus ? ` · ${p.dutyStatus}` : ""}
                      </div>
                    </div>
                    <Badge>{p.status}</Badge>
                  </button>
                ))
              )}
            </div>
            {assignFor.assignedPhlebo ? (
              <button
                disabled={assignSaving}
                onClick={() => doAssign(null)}
                className="btn-danger w-full"
              >
                Unassign current phlebo
              </button>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={!!labAssignFor} onClose={() => setLabAssignFor(null)} title="Assign lab">
        {labAssignFor ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Sample for <span className="font-medium text-slate-700">{labAssignFor.patientName}</span> ·{" "}
              {labAssignFor.city || "no city set"}
            </p>
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {eligibleLabs.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">
                  No lab exists for this city yet — create one on the Team page
                </p>
              ) : (
                eligibleLabs.map((l) => (
                  <button
                    key={l._id}
                    disabled={assignSaving}
                    onClick={() => doAssignLab(l._id)}
                    className="w-full flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:border-brand-300 hover:bg-brand-50/50 transition-colors disabled:opacity-50"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-800">{l.name}</div>
                      <div className="text-xs text-slate-400">{l.email} · {l.city}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
            {labAssignFor.assignedLab ? (
              <button
                disabled={assignSaving}
                onClick={() => doAssignLab(null)}
                className="btn-danger w-full"
              >
                Unassign current lab
              </button>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={!!rescheduleFor} onClose={() => setRescheduleFor(null)} title="Reschedule order">
        {rescheduleFor ? (
          <form onSubmit={submitReschedule} className="space-y-4">
            {rescheduleError ? (
              <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{rescheduleError}</div>
            ) : null}
            <p className="text-sm text-slate-500">
              <span className="font-medium text-slate-700">{rescheduleFor.patientName}</span> ·{" "}
              Current slot: {rescheduleFor.slotDate} · {rescheduleFor.slotTime}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">New date</label>
                <input
                  required
                  type="date"
                  className="input"
                  value={rescheduleForm.slotDate}
                  onChange={(e) => setRescheduleForm({ ...rescheduleForm, slotDate: e.target.value })}
                />
              </div>
              <div>
                <label className="label">New time</label>
                <input
                  required
                  type="time"
                  className="input"
                  value={rescheduleForm.slotTime}
                  onChange={(e) => setRescheduleForm({ ...rescheduleForm, slotTime: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="label">Phlebo (optional)</label>
              <select
                className="input"
                value={rescheduleForm.phleboId}
                onChange={(e) => setRescheduleForm({ ...rescheduleForm, phleboId: e.target.value })}
              >
                <option value="">Auto-assign / leave unassigned</option>
                {eligiblePhlebosForReschedule.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} · {p.zone || p.city || "—"}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                Leaving blank clears the old assignment; the system will auto-find the nearest phlebo for the new slot.
              </p>
            </div>

            <button type="submit" disabled={rescheduleSaving} className="btn-primary w-full">
              {rescheduleSaving ? "Saving…" : "Reschedule order"}
            </button>
          </form>
        ) : null}
      </Modal>

      <Modal open={!!detailFor} onClose={() => setDetailFor(null)} title="Order details" width="max-w-lg">
        {detailFor ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pickup ID" value={detailFor.pickupId} />
              <Field label="Patient" value={detailFor.patientName} />
              <Field label="Mobile" value={detailFor.mobileNumber} />
              <Field label="Website" value={detailFor.clientName || detailFor.clientSlug} />
              <Field label="External order ID" value={detailFor.externalOrderId} />
              <Field label="Slot" value={`${detailFor.slotDate} · ${detailFor.slotTime}`} />
              <Field label="Amount" value={`₹${detailFor.totalAmount ?? detailFor.amount ?? 0}`} />
            </div>
            <Field label="Address" value={`${detailFor.address}, ${detailFor.area || ""} ${detailFor.city || ""} ${detailFor.pincode || ""}`} />
            <div className="flex flex-wrap gap-2">
              <Badge>{detailFor.status}</Badge>
              <Badge>{detailFor.phleboStatus || "Unassigned"}</Badge>
              {detailFor.walkInSourceJobId && (
                <span className="inline-flex items-center rounded-full bg-violet-100 text-violet-700 px-3 py-1 text-xs font-semibold">
                  Walk-in (added by phlebo on-site)
                </span>
              )}
              <Badge>{detailFor.paymentStatus}</Badge>
              {detailFor.isRedraw ? (
                <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2.5 py-0.5 text-xs font-medium">
                  Redraw{detailFor.redrawReason ? `: ${detailFor.redrawReason}` : ""}
                </span>
              ) : null}
              {detailFor.hasRedraw ? (
                <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 px-2.5 py-0.5 text-xs font-medium">
                  Has a redraw job
                </span>
              ) : null}
            </div>

            {detailFor.rescheduleRequested ? (
              <div className="rounded-lg bg-rose-50 text-rose-700 text-xs px-3 py-2">
                Patient requested a reschedule
                {detailFor.rescheduleRequestNote ? `: “${detailFor.rescheduleRequestNote}”` : ""}
              </div>
            ) : null}

            {detailFor.rating?.stars ? (
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Patient rating: {"★".repeat(detailFor.rating.stars)}{"☆".repeat(5 - detailFor.rating.stars)}
                {detailFor.rating.comment ? ` — “${detailFor.rating.comment}”` : ""}
              </div>
            ) : null}

            {typeof detailFor.travelDistanceKm === "number" ? (
              <div className="text-xs text-slate-500">
                Travel to patient: {detailFor.travelDistanceKm} km
                {detailFor.arrivedWithinGeofence === false ? (
                  <span className="text-amber-600 font-medium">
                    {" "}
                    · ⚠ arrived ~{detailFor.arrivedDistanceFromAddressM}m from address
                  </span>
                ) : null}
              </div>
            ) : null}
            <div>
              <div className="label mb-1.5">Tests</div>
              {(detailFor.items || []).length > 0 ? (
                <div className="space-y-1 mb-2">
                  {detailFor.items.map((it, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"
                    >
                      <span className="flex items-center gap-2">
                        {it.name}
                        {it.addedByPhlebo ? (
                          <span className="rounded-full bg-violet-50 text-violet-700 px-2 py-0.5 text-[10px] font-medium">
                            {it.addedBySource === "admin" ? "Added by Ops" : "Added on-site"}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-slate-500">
                        ₹{it.price} x{it.quantity || 1}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <details className="text-xs">
                <summary className="cursor-pointer text-brand-600 font-medium select-none">
                  + Add test to this order
                </summary>
                <div className="mt-2">
                  <TestPicker
                    clientId={detailFor.clientId}
                    city={detailFor.city}
                    disabled={addTestSaving}
                    onAdd={addTestToDetail}
                  />
                </div>
              </details>
            </div>
            {(detailFor.samples || []).length > 0 ? (
              <div>
                <div className="label mb-1.5">Samples</div>
                <div className="space-y-1">
                  {detailFor.samples.map((s, i) => (
                    <div
                      key={i}
                      className={`rounded-lg px-3 py-2 text-xs ${
                        s.rejected ? "bg-rose-50" : "bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono">{s.barcode}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">{s.sampleType}</span>
                          {s.photoUrl || s.hasPhoto || (s.photoUrls && s.photoUrls.length) ? (
                            <span className="text-emerald-600 font-medium">
                              Photo ✓
                              {Array.isArray(s.photoUrls) && s.photoUrls.length > 1
                                ? ` (${s.photoUrls.length})`
                                : ""}
                            </span>
                          ) : (
                            <span className="text-amber-600 font-medium">No photo</span>
                          )}
                          {canManage && !s.rejected ? (
                            <button
                              disabled={rejectSaving}
                              onClick={() => rejectSample(s.barcode)}
                              className="text-rose-600 hover:text-rose-800 font-medium"
                            >
                              Reject
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {(() => {
                        const urls =
                          Array.isArray(s.photoUrls) && s.photoUrls.length
                            ? s.photoUrls.filter(Boolean)
                            : s.photoUrl
                              ? [s.photoUrl]
                              : [];
                        if (!urls.length) return null;
                        return (
                          <div className="mt-2 flex gap-2 overflow-x-auto">
                            {urls.map((src, pi) => (
                              <img
                                key={pi}
                                src={src}
                                alt={`Sample ${s.barcode} ${pi + 1}`}
                                className="rounded-lg max-h-48 max-w-[220px] object-contain bg-white border border-slate-100"
                              />
                            ))}
                          </div>
                        );
                      })()}
                      {s.rejected ? (
                        <div className="mt-1 text-rose-700 font-medium">
                          Rejected by lab{s.rejectionReason ? `: ${s.rejectionReason}` : ""}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {detailFor.handover?.completed ? (
              <div>
                <div className="label mb-1.5">Handover / cold-chain bag</div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs space-y-2">
                  <div className="text-slate-500">
                    {detailFor.handover.handedOverAt
                      ? new Date(detailFor.handover.handedOverAt).toLocaleString()
                      : "—"}
                    {typeof detailFor.handover.bagTemperatureC === "number"
                      ? ` · ${detailFor.handover.bagTemperatureC}°C`
                      : ""}
                  </div>
                  {(() => {
                    const bagUrls =
                      Array.isArray(detailFor.handover.bagPhotoUrls) &&
                      detailFor.handover.bagPhotoUrls.length
                        ? detailFor.handover.bagPhotoUrls.filter(Boolean)
                        : detailFor.handover.bagPhotoUrl
                          ? [detailFor.handover.bagPhotoUrl]
                          : [];
                    if (!bagUrls.length) {
                      return <div className="text-slate-400">No bag photo submitted</div>;
                    }
                    return (
                      <div className="flex gap-2 overflow-x-auto">
                        {bagUrls.map((src, bi) => (
                          <img
                            key={bi}
                            src={src}
                            alt={`Cold-chain bag ${bi + 1}`}
                            className="rounded-lg max-h-40 max-w-[200px] object-cover"
                          />
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={showNewOrder}
        onClose={() => setShowNewOrder(false)}
        title="New order — phone / walk-in booking"
        width="max-w-lg"
      >
        <form onSubmit={submitNewOrder} className="space-y-4">
          {newOrderError ? (
            <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{newOrderError}</div>
          ) : null}

          <div>
            <label className="label">Website</label>
            <select
              required
              className="input"
              value={newOrder.clientId}
              onChange={(e) => setNewOrder({ ...newOrder, clientId: e.target.value })}
            >
              <option value="">Select website…</option>
              {clients.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Patient name</label>
              <input
                required
                className="input"
                value={newOrder.patientName}
                onChange={(e) => setNewOrder({ ...newOrder, patientName: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Mobile</label>
              <input
                className="input"
                value={newOrder.mobileNumber}
                onChange={(e) => setNewOrder({ ...newOrder, mobileNumber: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Slot date</label>
              <input
                required
                type="date"
                className="input"
                value={newOrder.slotDate}
                onChange={(e) => setNewOrder({ ...newOrder, slotDate: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Slot time</label>
              <input
                required
                type="time"
                className="input"
                value={newOrder.slotTime}
                onChange={(e) => setNewOrder({ ...newOrder, slotTime: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label">Address</label>
            <input
              required
              className="input"
              value={newOrder.address}
              onChange={(e) => setNewOrder({ ...newOrder, address: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">City</label>
              <input
                className="input"
                value={newOrder.city}
                onChange={(e) => setNewOrder({ ...newOrder, city: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Area</label>
              <input
                className="input"
                value={newOrder.area}
                onChange={(e) => setNewOrder({ ...newOrder, area: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Pincode</label>
              <input
                className="input"
                value={newOrder.pincode}
                onChange={(e) => setNewOrder({ ...newOrder, pincode: e.target.value })}
              />
            </div>
          </div>

          <div>
            <div className="label mb-1.5">Tests</div>
            <TestPicker
              clientId={newOrder.clientId}
              city={newOrder.city}
              disabled={newOrderSaving}
              onAdd={addNewOrderItem}
            />
            {newOrderItems.length > 0 ? (
              <div className="mt-2 space-y-1">
                {newOrderItems.map((it, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"
                  >
                    <span>{it.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">
                        ₹{it.price} x{it.quantity || 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeNewOrderItem(i)}
                        className="text-rose-500 hover:text-rose-700"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                <div className="text-right text-xs font-semibold text-slate-700 pt-1">
                  Total: ₹{newOrderTotal}
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <label className="label">Special instructions (optional)</label>
            <input
              className="input"
              value={newOrder.specialInstructions}
              onChange={(e) => setNewOrder({ ...newOrder, specialInstructions: e.target.value })}
            />
          </div>

          <button type="submit" disabled={newOrderSaving} className="btn-primary w-full">
            {newOrderSaving ? "Creating…" : "Create order"}
          </button>
        </form>
      </Modal>
    </>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-700 font-medium">{value || "—"}</div>
    </div>
  );
}
