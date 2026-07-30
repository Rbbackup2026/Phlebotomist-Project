import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { adminApi } from "../api.js";

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function fmtTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function hoursBetween(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.round((ms / 3600000) * 10) / 10;
}

export default function Attendance() {
  const [date, setDate] = useState(todayYmd());
  const [phlebos, setPhlebos] = useState([]);
  const [phleboId, setPhleboId] = useState("");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [att, ph] = await Promise.all([
        adminApi.attendance({ date, phleboId: phleboId || undefined }),
        phlebos.length ? Promise.resolve({ phlebos }) : adminApi.phlebos(),
      ]);
      setRecords(att.records || []);
      if (!phlebos.length) setPhlebos(ph.phlebos || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, phleboId]);

  const checkedInNow = records.filter((r) => r.checkInAt && !r.checkOutAt).length;

  return (
    <>
      <Topbar title="Attendance" subtitle="Phlebo shift check-in / check-out log" />
      <div className="p-4 md:p-8 space-y-4">
        <div className="card p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Phlebo</label>
            <select className="input w-52" value={phleboId} onChange={(e) => setPhleboId(e.target.value)}>
              <option value="">All phlebos</option>
              {phlebos.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto text-sm text-slate-500">
            {checkedInNow > 0 ? (
              <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 font-medium">
                {checkedInNow} currently checked in
              </span>
            ) : null}
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
                  <th className="text-left px-4 py-3 font-medium">Phlebo</th>
                  <th className="text-left px-4 py-3 font-medium">City</th>
                  <th className="text-left px-4 py-3 font-medium">Check-in</th>
                  <th className="text-left px-4 py-3 font-medium">Check-out</th>
                  <th className="text-left px-4 py-3 font-medium">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      No attendance records for this date
                    </td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr key={r._id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{r.phleboName}</td>
                      <td className="px-4 py-3 text-slate-600">{r.city || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{fmtTime(r.checkInAt)}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {r.checkOutAt ? (
                          fmtTime(r.checkOutAt)
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-xs font-medium">
                            Still on shift
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {hoursBetween(r.checkInAt, r.checkOutAt) ?? "—"}
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
