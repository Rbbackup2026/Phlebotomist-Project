import { useEffect, useMemo, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import Badge from "../components/Badge.jsx";
import StatCard from "../components/StatCard.jsx";
import DateRangeBar from "../components/DateRangeBar.jsx";
import { useDateRange } from "../hooks/useDateRange.js";
import { adminApi } from "../api.js";
import { displaySource } from "../utils/clients.js";

const STATUS_OPTIONS = ["All", "Paid", "Unpaid"];
const SETTLEMENT_OPTIONS = ["All", "Pending settlement", "Settled"];

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Payments() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settlingId, setSettlingId] = useState(null);

  const [status, setStatus] = useState("All");
  const [method, setMethod] = useState("All");
  const [settlement, setSettlement] = useState("All");
  const [search, setSearch] = useState("");
  const { preset, range, applyPreset, setCustom } = useDateRange("all");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.orders({ limit: 300 });
      setOrders(res.orders || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const methodOptions = useMemo(() => {
    const set = new Set(
      orders.map((o) => o.paymentCollectedMethod || o.paymentMethod || "—").filter(Boolean)
    );
    return ["All", ...Array.from(set)];
  }, [orders]);

  const filtered = useMemo(() => {
    const fromT = range.from ? new Date(range.from).setHours(0, 0, 0, 0) : null;
    const toT = range.to ? new Date(range.to).setHours(23, 59, 59, 999) : null;

    return orders.filter((o) => {
      if (status !== "All" && (o.paymentStatus || "Unpaid") !== status) return false;
      const m = o.paymentCollectedMethod || o.paymentMethod || "—";
      if (method !== "All" && m !== method) return false;

      const isCashPaid = o.paymentStatus === "Paid" && /^cash$/i.test(m);
      if (settlement === "Settled" && !(isCashPaid && o.cashSettled)) return false;
      if (settlement === "Pending settlement" && !(isCashPaid && !o.cashSettled)) return false;

      if (fromT !== null || toT !== null) {
        const created = o.createdAt ? new Date(o.createdAt).getTime() : null;
        if (created === null) return false;
        if (fromT !== null && created < fromT) return false;
        if (toT !== null && created > toT) return false;
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (
          !`${o.patientName} ${o.mobileNumber} ${o.externalOrderId}`.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [orders, status, method, settlement, search, range]);

  const totals = useMemo(() => {
    const collected = filtered
      .filter((o) => o.paymentStatus === "Paid")
      .reduce((s, o) => s + (o.totalAmount || 0), 0);
    const pending = filtered
      .filter((o) => o.paymentStatus !== "Paid")
      .reduce((s, o) => s + (o.totalAmount || 0), 0);
    const cashUnsettled = filtered
      .filter((o) => o.paymentStatus === "Paid" && /^cash$/i.test(o.paymentCollectedMethod || "") && !o.cashSettled)
      .reduce((s, o) => s + (o.totalAmount || 0), 0);
    return { collected, pending, cashUnsettled };
  }, [filtered]);

  async function settleOne(order) {
    if (!order.assignedPhlebo) return;
    setSettlingId(order._id);
    try {
      await adminApi.settleCash(order.assignedPhlebo, [order._id]);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSettlingId(null);
    }
  }

  return (
    <>
      <Topbar title="Payments" subtitle="Payment status, method, and cash settlement for every order" />
      <div className="p-4 md:p-8 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Collected" value={`₹${totals.collected}`} accent="green" />
          <StatCard label="Pending (unpaid)" value={`₹${totals.pending}`} accent="rose" />
          <StatCard label="Cash awaiting settlement" value={`₹${totals.cashUnsettled}`} accent="amber" />
        </div>

        <DateRangeBar preset={preset} range={range} onPreset={applyPreset} onCustom={setCustom} />

        <div className="card p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Payment status</label>
            <select className="input w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Method</label>
            <select className="input w-36" value={method} onChange={(e) => setMethod(e.target.value)}>
              {methodOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Cash settlement</label>
            <select
              className="input w-44"
              value={settlement}
              onChange={(e) => setSettlement(e.target.value)}
            >
              {SETTLEMENT_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto">
            <input
              className="input w-56"
              placeholder="Search patient / phone / order id"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn-secondary" onClick={load}>
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
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                  <th className="text-left px-4 py-3 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 font-medium">Method</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Collected by</th>
                  <th className="text-left px-4 py-3 font-medium">Collected at</th>
                  <th className="text-left px-4 py-3 font-medium">Settlement</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                      No orders match these filters
                    </td>
                  </tr>
                ) : (
                  filtered.map((o) => {
                    const m = o.paymentCollectedMethod || o.paymentMethod || "—";
                    const isCashPaid = o.paymentStatus === "Paid" && /^cash$/i.test(m);
                    return (
                      <tr key={o._id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{o.patientName}</div>
                          <div className="text-xs text-slate-400">{o.mobileNumber}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{displaySource(o)}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">
                          ₹{o.totalAmount ?? o.amount ?? 0}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{m}</td>
                        <td className="px-4 py-3">
                          <Badge>{o.paymentStatus || "Unpaid"}</Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{o.assignedPhleboName || "—"}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {fmtDate(o.paymentCollectedAt)}
                        </td>
                        <td className="px-4 py-3">
                          {isCashPaid ? (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                o.cashSettled
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-amber-50 text-amber-700"
                              }`}
                            >
                              {o.cashSettled ? "Settled" : "Pending"}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isCashPaid && !o.cashSettled ? (
                            <button
                              className="btn bg-amber-500 text-white hover:bg-amber-600"
                              disabled={settlingId === o._id}
                              onClick={() => settleOne(o)}
                            >
                              {settlingId === o._id ? "Saving…" : "Mark received"}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
