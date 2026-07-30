import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { adminApi } from "../api.js";

function fmt(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LabTat() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.labTat();
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markReady(orderId) {
    setMarking(orderId);
    try {
      await adminApi.markReportReady(orderId);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setMarking(null);
    }
  }

  const orders = (data?.orders || []).filter((o) =>
    `${o.patientName} ${o.labName}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <Topbar title="Lab TAT" subtitle="Turnaround from sample handover to report-ready" />
      <div className="p-4 md:p-8 space-y-4">
        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}

        {data?.labs?.length ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.labs.map((l) => (
              <div key={l.labName} className="card p-4">
                <div className="text-sm font-semibold text-slate-700 truncate">{l.labName}</div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                    {l.total} total
                  </span>
                  {l.pending > 0 ? (
                    <span className="text-xs bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
                      {l.pending} pending
                    </span>
                  ) : null}
                  {l.delayed > 0 ? (
                    <span className="text-xs bg-rose-50 text-rose-700 rounded-full px-2 py-0.5">
                      {l.delayed} delayed
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  Avg TAT: {l.avgTatHours !== null ? `${l.avgTatHours}h` : "—"}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <input
            className="input max-w-xs"
            placeholder="Search patient, lab…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="text-xs text-slate-400 ml-auto">
            SLA: {data?.slaHours ?? 24}h · red = pending &amp; overdue, green = report ready
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Patient</th>
                  <th className="text-left px-4 py-3 font-medium">Lab</th>
                  <th className="text-left px-4 py-3 font-medium">Handed off</th>
                  <th className="text-left px-4 py-3 font-medium">Report status</th>
                  <th className="text-left px-4 py-3 font-medium">TAT</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No handed-off samples found
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => (
                    <tr key={o.orderId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{o.patientName}</td>
                      <td className="px-4 py-3 text-slate-600">{o.labName}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{fmt(o.handedOverAt)}</td>
                      <td className="px-4 py-3">
                        {o.reportReadyAt ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-xs font-medium">
                            ✓ Ready · {fmt(o.reportReadyAt)}
                          </span>
                        ) : o.delayed ? (
                          <span className="inline-flex items-center rounded-full bg-rose-50 text-rose-700 px-2.5 py-0.5 text-xs font-medium">
                            ⚠ Delayed
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2.5 py-0.5 text-xs font-medium">
                            ⏳ Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {o.tatHours !== null ? `${o.tatHours}h` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!o.reportReadyAt ? (
                          <button
                            className="btn-secondary"
                            disabled={marking === o.orderId}
                            onClick={() => markReady(o.orderId)}
                          >
                            {marking === o.orderId ? "Saving…" : "Mark report ready"}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
