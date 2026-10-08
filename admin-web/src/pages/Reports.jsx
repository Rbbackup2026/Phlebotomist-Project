import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { adminApi } from "../api.js";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function inr(n) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}

export default function Reports() {
  const now = new Date();
  const [period, setPeriod] = useState("monthly");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [half, setHalf] = useState(now.getMonth() < 6 ? 1 : 2);
  const [phleboId, setPhleboId] = useState("");
  const [phlebos, setPhlebos] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  function params(extra = {}) {
    return {
      period,
      year,
      month,
      quarter,
      half,
      phleboId,
      ...extra,
    };
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.phleboReport(params());
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    adminApi
      .phlebos()
      .then((res) => setPhlebos(res.phlebos || []))
      .catch(() => setPhlebos([]));
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, year, month, quarter, half, phleboId]);

  async function download(scope) {
    setDownloading(scope);
    setError("");
    try {
      await adminApi.downloadPhleboReport(
        scope === "all" ? { scope: "all", period: "all" } : params()
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloading("");
    }
  }

  const rows = data?.rows || [];
  const totals = data?.totals || { collections: 0, revenue: 0 };

  return (
    <>
      <Topbar
        title="Reports"
        subtitle="Date-wise sample collection and revenue by phlebo"
      />
      <div className="p-4 md:p-8 space-y-4">
        <div className="card p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Period</label>
            <select className="input w-40" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="half">Half yearly</option>
            </select>
          </div>
          <div>
            <label className="label">Year</label>
            <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          {period === "monthly" ? (
            <div>
              <label className="label">Month</label>
              <select className="input w-40" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {period === "quarterly" ? (
            <div>
              <label className="label">Quarter</label>
              <select className="input w-44" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
                <option value={1}>Q1 · Jan–Mar</option>
                <option value={2}>Q2 · Apr–Jun</option>
                <option value={3}>Q3 · Jul–Sep</option>
                <option value={4}>Q4 · Oct–Dec</option>
              </select>
            </div>
          ) : null}
          {period === "half" ? (
            <div>
              <label className="label">Half year</label>
              <select className="input w-48" value={half} onChange={(e) => setHalf(Number(e.target.value))}>
                <option value={1}>H1 · Jan–Jun</option>
                <option value={2}>H2 · Jul–Dec</option>
              </select>
            </div>
          ) : null}
          <div>
            <label className="label">Phlebo</label>
            <select className="input w-48" value={phleboId} onChange={(e) => setPhleboId(e.target.value)}>
              <option value="">All phlebos</option>
              {phlebos.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={!!downloading}
              onClick={() => download("period")}
            >
              {downloading === "period" ? "Downloading…" : "Download date-wise"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!!downloading}
              onClick={() => download("all")}
            >
              {downloading === "all" ? "Downloading…" : "Download all data"}
            </button>
          </div>
        </div>

        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="card p-4">
            <div className="text-xs text-slate-400">Period</div>
            <div className="text-lg font-semibold text-slate-800">{data?.label || "—"}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-slate-400">Total sample collection</div>
            <div className="text-lg font-semibold text-slate-800">{totals.collections}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-slate-400">Revenue</div>
            <div className="text-lg font-semibold text-slate-800">{inr(totals.revenue)}</div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Phlebo name</th>
                  <th className="text-right px-4 py-3 font-medium">Total sample collection</th>
                  <th className="text-right px-4 py-3 font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      Loading report…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      No collected samples in this period
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={`${row.date}-${row.phleboName}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{row.date}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{row.phleboName}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{row.collections}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800">{inr(row.revenue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {!loading && rows.length > 0 ? (
                <tfoot className="bg-slate-50 font-semibold text-slate-800">
                  <tr>
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right">{totals.collections}</td>
                    <td className="px-4 py-3 text-right">{inr(totals.revenue)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
