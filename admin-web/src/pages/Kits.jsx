import { useEffect, useMemo, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import Modal from "../components/Modal.jsx";
import { adminApi } from "../api.js";

const emptyItemForm = { sku: "", name: "", unit: "pcs", centralStock: 0, reorderThreshold: 10 };

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Kits() {
  const [items, setItems] = useState([]);
  const [phlebos, setPhlebos] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAddItem, setShowAddItem] = useState(false);
  const [addForm, setAddForm] = useState(emptyItemForm);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  const [editingItem, setEditingItem] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  const [showAssign, setShowAssign] = useState(false);
  const [assignPhleboId, setAssignPhleboId] = useState("");
  const [assignQty, setAssignQty] = useState({});
  const [assignNote, setAssignNote] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [inv, ph, kits] = await Promise.all([
        adminApi.inventory(),
        adminApi.phlebos(),
        adminApi.kitAssignments(),
      ]);
      setItems(inv.items || []);
      setPhlebos(ph.phlebos || []);
      setAssignments(kits.assignments || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submitAddItem(e) {
    e.preventDefault();
    setAddSaving(true);
    setAddError("");
    try {
      await adminApi.createInventoryItem(addForm);
      setShowAddItem(false);
      setAddForm(emptyItemForm);
      await load();
    } catch (e) {
      setAddError(e.message);
    } finally {
      setAddSaving(false);
    }
  }

  function openEditItem(it) {
    setEditingItem(it);
    setEditForm({
      name: it.name,
      unit: it.unit,
      centralStock: it.centralStock,
      reorderThreshold: it.reorderThreshold,
    });
  }

  async function submitEditItem(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      await adminApi.updateInventoryItem(editingItem._id, editForm);
      setEditingItem(null);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setEditSaving(false);
    }
  }

  function openAssign() {
    setAssignPhleboId("");
    setAssignQty({});
    setAssignNote("");
    setAssignError("");
    setShowAssign(true);
  }

  const assignItemsPayload = useMemo(
    () =>
      Object.entries(assignQty)
        .filter(([, q]) => Number(q) > 0)
        .map(([sku, quantity]) => ({ sku, quantity: Number(quantity) })),
    [assignQty]
  );

  async function submitAssign(e) {
    e.preventDefault();
    if (!assignPhleboId) {
      setAssignError("Please select a phlebo");
      return;
    }
    if (!assignItemsPayload.length) {
      setAssignError("Enter a quantity for at least one item");
      return;
    }
    setAssignSaving(true);
    setAssignError("");
    try {
      const res = await adminApi.assignKit({
        phleboId: assignPhleboId,
        items: assignItemsPayload,
        note: assignNote,
      });
      setShowAssign(false);
      await load();
      alert(res.message);
    } catch (e) {
      setAssignError(e.message);
    } finally {
      setAssignSaving(false);
    }
  }

  return (
    <>
      <Topbar title="Kit Inventory" subtitle="Manage central stock and assign kits to phlebos" />
      <div className="p-4 md:p-8 space-y-6">
        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}

        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" onClick={openAssign}>
            + Assign kit to phlebo
          </button>
          <button className="btn-secondary" onClick={() => setShowAddItem(true)}>
            + Add catalog item
          </button>
          <button className="btn-secondary ml-auto" onClick={load}>
            Refresh
          </button>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Central stock (catalog)</h3>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">SKU</th>
                    <th className="text-left px-4 py-3 font-medium">Name</th>
                    <th className="text-left px-4 py-3 font-medium">Unit</th>
                    <th className="text-left px-4 py-3 font-medium">Central stock</th>
                    <th className="text-left px-4 py-3 font-medium">Reorder at</th>
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
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                        No catalog items yet — add one above
                      </td>
                    </tr>
                  ) : (
                    items.map((it) => {
                      const low = it.centralStock <= it.reorderThreshold;
                      return (
                        <tr key={it._id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">{it.sku}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{it.name}</td>
                          <td className="px-4 py-3 text-slate-600">{it.unit}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`font-semibold ${low ? "text-rose-600" : "text-slate-800"}`}
                            >
                              {it.centralStock}
                            </span>
                            {low ? (
                              <span className="ml-2 text-xs font-medium text-rose-600 bg-rose-50 rounded-full px-2 py-0.5">
                                Low stock
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-slate-500">{it.reorderThreshold}</td>
                          <td className="px-4 py-3 text-right">
                            <button className="btn-secondary" onClick={() => openEditItem(it)}>
                              Edit
                            </button>
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

        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Recent kit assignments</h3>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Phlebo</th>
                    <th className="text-left px-4 py-3 font-medium">Items</th>
                    <th className="text-left px-4 py-3 font-medium">Assigned by</th>
                    <th className="text-left px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assignments.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                        No kits assigned yet
                      </td>
                    </tr>
                  ) : (
                    assignments.map((a) => (
                      <tr key={a._id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{a.phleboName}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {(a.items || []).map((it) => `${it.name} x${it.quantity}`).join(", ")}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{a.assignedByName}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(a.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Add catalog item */}
      <Modal open={showAddItem} onClose={() => setShowAddItem(false)} title="Add catalog item">
        <form onSubmit={submitAddItem} className="space-y-3">
          {addError ? (
            <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{addError}</div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">SKU</label>
              <input
                required
                className="input"
                placeholder="e.g. EDTA-PURPLE"
                value={addForm.sku}
                onChange={(e) => setAddForm({ ...addForm, sku: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Name</label>
              <input
                required
                className="input"
                placeholder="e.g. EDTA Violet Tube"
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Unit</label>
              <input
                className="input"
                value={addForm.unit}
                onChange={(e) => setAddForm({ ...addForm, unit: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Starting stock</label>
              <input
                type="number"
                min="0"
                className="input"
                value={addForm.centralStock}
                onChange={(e) => setAddForm({ ...addForm, centralStock: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <label className="label">Reorder threshold</label>
              <input
                type="number"
                min="0"
                className="input"
                value={addForm.reorderThreshold}
                onChange={(e) => setAddForm({ ...addForm, reorderThreshold: e.target.value })}
              />
            </div>
          </div>
          <button type="submit" disabled={addSaving} className="btn-primary w-full">
            {addSaving ? "Saving…" : "Add item"}
          </button>
        </form>
      </Modal>

      {/* Edit catalog item */}
      <Modal open={!!editingItem} onClose={() => setEditingItem(null)} title="Edit catalog item">
        {editingItem && editForm ? (
          <form onSubmit={submitEditItem} className="space-y-3">
            <div className="text-xs text-slate-400 font-mono">{editingItem.sku}</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Name</label>
                <input
                  className="input"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Unit</label>
                <input
                  className="input"
                  value={editForm.unit}
                  onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Central stock</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={editForm.centralStock}
                  onChange={(e) => setEditForm({ ...editForm, centralStock: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="label">Reorder threshold</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={editForm.reorderThreshold}
                  onChange={(e) => setEditForm({ ...editForm, reorderThreshold: e.target.value })}
                />
              </div>
            </div>
            <button type="submit" disabled={editSaving} className="btn-primary w-full">
              {editSaving ? "Saving…" : "Save changes"}
            </button>
          </form>
        ) : null}
      </Modal>

      {/* Assign kit */}
      <Modal open={showAssign} onClose={() => setShowAssign(false)} title="Assign kit to phlebo" width="max-w-lg">
        <form onSubmit={submitAssign} className="space-y-4">
          {assignError ? (
            <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{assignError}</div>
          ) : null}
          <div>
            <label className="label">Phlebotomist</label>
            <select
              required
              className="input"
              value={assignPhleboId}
              onChange={(e) => setAssignPhleboId(e.target.value)}
            >
              <option value="">Select phlebo…</option>
              {phlebos.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} · {p.phone}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="label mb-1.5">Items to give</div>
            <div className="space-y-2">
              {items.map((it) => (
                <div
                  key={it._id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-800">{it.name}</div>
                    <div className="text-xs text-slate-400">
                      {it.centralStock} {it.unit} available
                    </div>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max={it.centralStock}
                    className="input w-20 text-center"
                    value={assignQty[it.sku] ?? ""}
                    onChange={(e) =>
                      setAssignQty({ ...assignQty, [it.sku]: e.target.value })
                    }
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Note (optional)</label>
            <input
              className="input"
              placeholder="e.g. Monthly restock"
              value={assignNote}
              onChange={(e) => setAssignNote(e.target.value)}
            />
          </div>

          <button type="submit" disabled={assignSaving} className="btn-primary w-full">
            {assignSaving ? "Assigning…" : "Assign kit"}
          </button>
        </form>
      </Modal>
    </>
  );
}
