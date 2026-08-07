import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import Badge from "../components/Badge.jsx";
import Modal from "../components/Modal.jsx";
import { adminApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

const CATEGORIES = [
  { value: "orders", label: "Orders" },
  { value: "payments", label: "Payments" },
  { value: "kits", label: "Kits" },
  { value: "phlebos", label: "Phlebotomists" },
  { value: "login", label: "Login / Access" },
  { value: "bug", label: "Bug / UI" },
  { value: "other", label: "Other" },
];

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const EMPTY_FORM = {
  subject: "",
  description: "",
  category: "other",
  priority: "medium",
  relatedOrderId: "",
};

function statusLabel(s) {
  return STATUSES.find((x) => x.value === s)?.label || s;
}

function categoryLabel(c) {
  return CATEGORIES.find((x) => x.value === c)?.label || c;
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "—";
  }
}

export default function Tickets() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [reply, setReply] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  async function loadList() {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const data = await adminApi.tickets(params);
      setRows(data.tickets || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function openDetail(id) {
    setSelectedId(id);
    setDetail(null);
    setDetailError("");
    setReply("");
    setDetailLoading(true);
    try {
      const data = await adminApi.ticket(id);
      setDetail(data.ticket);
    } catch (e) {
      setDetailError(e.message);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setDetailError("");
    setReply("");
  }

  async function submitCreate(e) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const data = await adminApi.createTicket(form);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await loadList();
      if (data.ticket?._id) openDetail(data.ticket._id);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitReply(e) {
    e.preventDefault();
    if (!selectedId || !reply.trim()) return;
    setReplyBusy(true);
    setDetailError("");
    try {
      const data = await adminApi.replyTicket(selectedId, reply.trim());
      setDetail(data.ticket);
      setReply("");
      await loadList();
    } catch (e) {
      setDetailError(e.message);
    } finally {
      setReplyBusy(false);
    }
  }

  async function changeStatus(status) {
    if (!selectedId) return;
    setReplyBusy(true);
    setDetailError("");
    try {
      const data = await adminApi.setTicketStatus(selectedId, status);
      setDetail(data.ticket);
      await loadList();
    } catch (e) {
      setDetailError(e.message);
    } finally {
      setReplyBusy(false);
    }
  }

  return (
    <>
      <Topbar
        title={isSuperadmin ? "Support tickets" : "Support"}
        subtitle={
          isSuperadmin
            ? "City admin issues across all cities"
            : "Raise an issue — platform support will reply here"
        }
      />
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <select
            className="input w-auto min-w-[140px]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {!isSuperadmin ? (
            <button className="btn-primary ml-auto" onClick={() => setShowCreate(true)}>
              + New ticket
            </button>
          ) : (
            <span className="ml-auto text-xs text-slate-400">{rows.length} tickets</span>
          )}
        </div>

        {error ? (
          <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div>
        ) : null}

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Ticket</th>
                  <th className="text-left px-4 py-3 font-medium">Subject</th>
                  {isSuperadmin ? (
                    <th className="text-left px-4 py-3 font-medium">City</th>
                  ) : null}
                  <th className="text-left px-4 py-3 font-medium">Category</th>
                  <th className="text-left px-4 py-3 font-medium">Priority</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td
                      colSpan={isSuperadmin ? 7 : 6}
                      className="px-4 py-8 text-center text-slate-400"
                    >
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={isSuperadmin ? 7 : 6}
                      className="px-4 py-8 text-center text-slate-400"
                    >
                      {isSuperadmin
                        ? "No tickets yet"
                        : "No tickets yet — create one if you hit an issue"}
                    </td>
                  </tr>
                ) : (
                  rows.map((t) => (
                    <tr
                      key={t._id}
                      className="hover:bg-slate-50/80 cursor-pointer"
                      onClick={() => openDetail(t._id)}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{t.ticketNo}</td>
                      <td className="px-4 py-3 text-slate-900 font-medium max-w-[240px] truncate">
                        {t.subject}
                      </td>
                      {isSuperadmin ? (
                        <td className="px-4 py-3 text-slate-600">{t.city || "—"}</td>
                      ) : null}
                      <td className="px-4 py-3 text-slate-600">{categoryLabel(t.category)}</td>
                      <td className="px-4 py-3">
                        <Badge>{t.priority}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge>{t.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(t.updatedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create (city admin) */}
      <Modal
        open={showCreate}
        onClose={() => !saving && setShowCreate(false)}
        title="New support ticket"
        width="max-w-lg"
      >
        <form onSubmit={submitCreate} className="space-y-3">
          <div>
            <label className="label">Subject</label>
            <input
              className="input"
              required
              maxLength={200}
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="Short summary of the issue"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Category</label>
              <select
                className="input"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Priority</label>
              <select
                className="input"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Related order / pickup ID (optional)</label>
            <input
              className="input"
              value={form.relatedOrderId}
              onChange={(e) => setForm((f) => ({ ...f, relatedOrderId: e.target.value }))}
              placeholder="e.g. WEL-20260806-0001"
            />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[120px]"
              required
              maxLength={4000}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What went wrong? Steps to reproduce, expected vs actual…"
            />
          </div>
          {formError ? (
            <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{formError}</div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn" disabled={saving} onClick={() => setShowCreate(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Creating…" : "Create ticket"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Detail / thread */}
      <Modal
        open={!!selectedId}
        onClose={closeDetail}
        title={detail?.ticketNo || "Ticket"}
        width="max-w-2xl"
      >
        {detailLoading ? (
          <div className="py-8 text-center text-slate-400 text-sm">Loading…</div>
        ) : detailError && !detail ? (
          <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{detailError}</div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge>{detail.status}</Badge>
              <Badge>{detail.priority}</Badge>
              <span className="text-xs text-slate-500">{categoryLabel(detail.category)}</span>
              {isSuperadmin ? (
                <span className="text-xs text-slate-500">· {detail.city}</span>
              ) : null}
            </div>
            <div>
              <h4 className="text-base font-semibold text-slate-900">{detail.subject}</h4>
              {detail.relatedOrderId ? (
                <p className="text-xs text-slate-500 mt-1">
                  Related: <span className="font-mono">{detail.relatedOrderId}</span>
                </p>
              ) : null}
            </div>

            {isSuperadmin ? (
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    disabled={replyBusy || detail.status === s.value}
                    className={`btn text-xs py-1.5 ${
                      detail.status === s.value ? "ring-1 ring-brand-500/40" : ""
                    }`}
                    onClick={() => changeStatus(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 max-h-[40vh] overflow-y-auto">
              {(detail.messages || []).map((m, i) => (
                <div key={m._id || i} className="px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="text-xs font-medium text-slate-800">
                      {m.byName || "User"}
                      <span className="text-slate-400 font-normal"> · {m.byRole}</span>
                    </span>
                    <span className="text-[11px] text-slate-400 shrink-0">{fmtDate(m.createdAt)}</span>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{m.text}</p>
                </div>
              ))}
            </div>

            {detailError ? (
              <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{detailError}</div>
            ) : null}

            {detail.status !== "closed" ? (
              <form onSubmit={submitReply} className="space-y-2">
                <textarea
                  className="input min-h-[80px]"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply…"
                  required
                />
                <div className="flex justify-end">
                  <button type="submit" className="btn-primary" disabled={replyBusy || !reply.trim()}>
                    {replyBusy ? "Sending…" : "Send reply"}
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-xs text-slate-500">
                This ticket is closed ({statusLabel(detail.status)}).
              </p>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
