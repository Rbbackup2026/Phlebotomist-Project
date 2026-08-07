import { useEffect, useMemo, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import StatCard from "../components/StatCard.jsx";
import DateRangeBar from "../components/DateRangeBar.jsx";
import Modal from "../components/Modal.jsx";
import TestPicker from "../components/TestPicker.jsx";
import { useDateRange } from "../hooks/useDateRange.js";
import { adminApi } from "../api.js";
import { visibleClients, displaySource, sourceOptionsForBooking } from "../utils/clients.js";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AddedTests() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalValue, setTotalValue] = useState(0);
  const [clients, setClients] = useState([]);
  const [phlebos, setPhlebos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [clientSlug, setClientSlug] = useState("");
  const [phleboId, setPhleboId] = useState("");
  const { preset, range, applyPreset, setCustom } = useDateRange("all");

  const [showAdd, setShowAdd] = useState(false);
  const [pickClientId, setPickClientId] = useState("");
  const [pickOrders, setPickOrders] = useState([]);
  const [pickOrdersLoading, setPickOrdersLoading] = useState(false);
  const [pickOrderId, setPickOrderId] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addMsg, setAddMsg] = useState("");

  const pickedOrder = useMemo(
    () => pickOrders.find((o) => o._id === pickOrderId) || null,
    [pickOrders, pickOrderId]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [res, c, p] = await Promise.all([
        adminApi.addedTests({ clientSlug, phleboId, from: range.from, to: range.to }),
        clients.length ? Promise.resolve({ clients }) : adminApi.clients(),
        phlebos.length ? Promise.resolve({ phlebos }) : adminApi.phlebos(),
      ]);
      setRows(res.rows || []);
      setTotal(res.total || 0);
      setTotalValue(res.totalValue || 0);
      if (!clients.length) setClients(c.clients || []);
      if (!phlebos.length) setPhlebos(p.phlebos || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSlug, phleboId, range]);

  function openAdd() {
    setPickClientId("");
    setPickOrders([]);
    setPickOrderId("");
    setOrderSearch("");
    setAddMsg("");
    setShowAdd(true);
  }

  useEffect(() => {
    if (!showAdd || !pickClientId) {
      setPickOrders([]);
      return;
    }
    setPickOrdersLoading(true);
    const client = clients.find((c) => c._id === pickClientId);
    const t = setTimeout(() => {
      adminApi
        .orders({ clientSlug: client?.slug, limit: 50 })
        .then((res) => setPickOrders(res.orders || []))
        .catch(() => setPickOrders([]))
        .finally(() => setPickOrdersLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [showAdd, pickClientId, clients]);

  const filteredPickOrders = useMemo(() => {
    if (!orderSearch.trim()) return pickOrders;
    const q = orderSearch.trim().toLowerCase();
    return pickOrders.filter((o) =>
      `${o.patientName} ${o.mobileNumber} ${o.externalOrderId}`.toLowerCase().includes(q)
    );
  }, [pickOrders, orderSearch]);

  async function addTestToPicked(item) {
    if (!pickedOrder) return;
    setAddSaving(true);
    setAddMsg("");
    try {
      const res = await adminApi.addTestToOrder(pickedOrder._id, item);
      setAddMsg(res.message || "Test add ho gaya");
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setAddSaving(false);
    }
  }

  const [removingKey, setRemovingKey] = useState("");

  async function removeAddedTest(row) {
    if (!row?.orderId || !row?.productId) {
      alert("Is test ko remove nahi kar sakte — product id missing");
      return;
    }
    if (row.phleboStatus === "Handed Off") {
      alert("Handed-off order se extra test nahi hata sakte");
      return;
    }
    const ok = window.confirm(
      `Remove “${row.testName}” from ${row.patientName}'s order?`
    );
    if (!ok) return;
    const key = `${row.orderId}:${row.productId}`;
    setRemovingKey(key);
    try {
      await adminApi.removeTestFromOrder(row.orderId, row.productId);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setRemovingKey("");
    }
  }

  return (
    <>
      <Topbar
        title="Added Tests"
        subtitle="Extra tests customers added with the phlebo during the visit"
      />
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex justify-end">
          <button className="btn-primary" onClick={openAdd}>
            + Add test manually
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard label="Tests added on-site" value={total} />
          <StatCard label="Extra value generated" value={`₹${totalValue}`} accent="green" />
        </div>

        <DateRangeBar preset={preset} range={range} onPreset={applyPreset} onCustom={setCustom} />

        <div className="card p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Source</label>
            <select className="input w-44" value={clientSlug} onChange={(e) => setClientSlug(e.target.value)}>
              <option value="">All sources</option>
              {visibleClients(clients).map((c) => (
                <option key={c._id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Phlebotomist</label>
            <select className="input w-44" value={phleboId} onChange={(e) => setPhleboId(e.target.value)}>
              <option value="">All phlebos</option>
              {phlebos.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
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
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                  <th className="text-left px-4 py-3 font-medium">Test added</th>
                  <th className="text-left px-4 py-3 font-medium">Price</th>
                  <th className="text-left px-4 py-3 font-medium">Added by</th>
                  <th className="text-left px-4 py-3 font-medium">When</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      No tests added manually or on-site yet
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => {
                    const rowKey = `${r.orderId}:${r.productId || i}`;
                    const canRemove =
                      r.productId && r.phleboStatus !== "Handed Off";
                    return (
                    <tr key={`${r.orderId}-${r.productId || i}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{r.patientName}</div>
                        <div className="text-xs text-slate-400 font-mono">
                          #{String(r.orderId).slice(-6)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{displaySource(r)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{r.testName}</div>
                        <div className="text-xs text-slate-400">{r.category}</div>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        ₹{r.price} x{r.quantity || 1}
                      </td>
                      <td className="px-4 py-3">
                        {r.addedBySource === "admin" ? (
                          <span className="inline-flex items-center rounded-full bg-brand-50 text-brand-700 px-2.5 py-0.5 text-xs font-medium">
                            Ops (manual)
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-violet-50 text-violet-700 px-2.5 py-0.5 text-xs font-medium">
                            {r.phleboName || "Phlebo"} (on-site)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(r.addedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {canRemove ? (
                          <button
                            type="button"
                            className="btn-danger !py-1 !px-2.5 !text-xs"
                            disabled={removingKey === rowKey}
                            onClick={() => removeAddedTest(r)}
                          >
                            {removingKey === rowKey ? "Removing…" : "Remove"}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
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

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add test manually" width="max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="label">Source</label>
            <select
              className="input"
              value={pickClientId}
              onChange={(e) => {
                setPickClientId(e.target.value);
                setPickOrderId("");
              }}
            >
              <option value="">Select source…</option>
              {sourceOptionsForBooking(clients).map((c) => (
                <option key={c._id} value={c._id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {pickClientId ? (
            <div>
              <label className="label">Order</label>
              <input
                className="input mb-2"
                placeholder="Search patient / phone / order id"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
              />
              <div className="max-h-40 overflow-y-auto space-y-1 border border-slate-100 rounded-lg p-1">
                {pickOrdersLoading ? (
                  <p className="text-xs text-slate-400 p-2">Loading…</p>
                ) : filteredPickOrders.length === 0 ? (
                  <p className="text-xs text-slate-400 p-2">No orders found</p>
                ) : (
                  filteredPickOrders.map((o) => (
                    <button
                      key={o._id}
                      type="button"
                      onClick={() => setPickOrderId(o._id)}
                      className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm ${
                        pickOrderId === o._id ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50"
                      }`}
                    >
                      <span>{o.patientName}</span>
                      <span className="text-xs text-slate-400">
                        {o.slotDate} · #{String(o._id).slice(-6)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {pickedOrder ? (
            <div>
              <div className="label mb-1.5">
                Add test for {pickedOrder.patientName}
              </div>
              {addMsg ? (
                <div className="rounded-lg bg-emerald-50 text-emerald-700 text-xs px-3 py-2 mb-2">
                  {addMsg}
                </div>
              ) : null}
              <TestPicker
                clientId={pickedOrder.clientId}
                city={pickedOrder.city}
                disabled={addSaving}
                onAdd={addTestToPicked}
              />
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
