import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Topbar from "../components/Topbar.jsx";
import StatCard from "../components/StatCard.jsx";
import DateRangeBar from "../components/DateRangeBar.jsx";
import Badge from "../components/Badge.jsx";
import Modal from "../components/Modal.jsx";
import { useDateRange } from "../hooks/useDateRange.js";
import { adminApi, authApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { visibleClients, isHiddenClient } from "../utils/clients.js";

export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === "superadmin") return <SuperadminOverview />;
  if (user?.role === "lab") return <LabDashboard />;
  return <CityDashboard />;
}

/**
 * Lab role ke paas /admin/analytics ka access nahi hai (wo admin/superadmin
 * ke liye reserved hai) — is liye Lab ko uska apna halka dashboard milta hai,
 * jo GET /admin/orders se hi banta hai (ye route already assignedLab scope
 * se sirf isi lab ke samples deta hai, koi extra permission nahi chahiye).
 */
function LabDashboard() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .orders({ limit: 200 })
      .then((d) => setOrders(d.orders || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const DONE = ["Sample Collected", "Handed Off"];
  const total = orders.length;
  const collected = orders.filter((o) => DONE.includes(o.phleboStatus)).length;
  const inTransit = orders.filter((o) => !DONE.includes(o.phleboStatus)).length;

  return (
    <>
      <Topbar title="Dashboard" subtitle="Samples assigned to your lab" />
      <div className="p-4 md:p-8 space-y-6">
        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}
        {loading ? (
          <div className="text-slate-500 text-sm">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard label="Total assigned" value={total} onClick={() => navigate("/orders")} />
              <StatCard
                label="Sample collected"
                value={collected}
                accent="green"
                onClick={() => navigate("/orders")}
              />
              <StatCard
                label="Awaiting collection"
                value={inTransit}
                accent="amber"
                onClick={() => navigate("/orders")}
              />
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Recent samples</h3>
              {orders.length === 0 ? (
                <p className="text-sm text-slate-400">No samples have been assigned to your lab yet</p>
              ) : (
                <div className="space-y-2">
                  {orders.slice(0, 8).map((o) => (
                    <button
                      key={o._id}
                      onClick={() => navigate("/orders")}
                      className="w-full flex items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50 text-left"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-800">{o.patientName}</div>
                        <div className="text-xs text-slate-400">
                          {o.slotDate} · {o.slotTime}
                        </div>
                      </div>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {o.phleboStatus || "Unassigned"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Superadmin ka "alag" dashboard — sirf oversight, koi Assign/Edit button nahi.
 * Har city ek row: uska admin, orders, phlebos, labs. Kisi bhi row ka data edit
 * karne ka option yahan nahi hai — wo sirf us city ke Admin se hota hai.
 * Visual theme jaanbujh kar violet/"console" hai — Sidebar aur login page ke
 * saath match karta hai taaki superadmin ka experience turant alag pehchana jaaye.
 */
function SuperadminOverview() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState(null);
  const [flash, setFlash] = useState(false);

  const [detailView, setDetailView] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailSearch, setDetailSearch] = useState("");
  const [ordersList, setOrdersList] = useState(null);
  const [phlebosList, setPhlebosList] = useState(null);
  const [labsList, setLabsList] = useState(null);

  useEffect(() => {
    adminApi
      .analyticsByCity()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function focusMetric(key) {
    setSortKey(key);
    setFlash(true);
    document.getElementById("cities-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => setFlash(false), 900);
  }

  async function openDetail(view) {
    setDetailView(view);
    setDetailSearch("");
    setDetailError("");
    const alreadyLoaded =
      (view === "orders" && ordersList) || (view === "phlebos" && phlebosList) || (view === "labs" && labsList);
    if (alreadyLoaded) return;
    setDetailLoading(true);
    try {
      if (view === "orders") {
        const d = await adminApi.orders({ limit: 200 });
        setOrdersList(d.orders || []);
      } else if (view === "phlebos") {
        const d = await adminApi.phlebos();
        setPhlebosList(d.phlebos || []);
      } else if (view === "labs") {
        const d = await authApi.labs();
        setLabsList(d.labs || []);
      }
    } catch (e) {
      setDetailError(e.message);
    } finally {
      setDetailLoading(false);
    }
  }

  const q = detailSearch.trim().toLowerCase();
  const filteredOrders = (ordersList || []).filter(
    (o) => !q || `${o.patientName} ${o.city}`.toLowerCase().includes(q)
  );
  const filteredPhlebos = (phlebosList || []).filter(
    (p) => !q || `${p.name} ${p.city} ${p.phone}`.toLowerCase().includes(q)
  );
  const filteredLabs = (labsList || []).filter(
    (l) => !q || `${l.name} ${l.city} ${l.email}`.toLowerCase().includes(q)
  );

  const sortedCities = (() => {
    const list = [...(data?.cities || [])];
    if (sortKey === "orders") return list.sort((a, b) => b.totalOrders - a.totalOrders);
    if (sortKey === "phlebos") return list.sort((a, b) => b.totalPhlebos - a.totalPhlebos);
    if (sortKey === "labs") return list.sort((a, b) => b.totalLabs - a.totalLabs);
    return list.sort((a, b) => (a.city || "").localeCompare(b.city || ""));
  })();

  const stats = [
    { label: "Cities live", value: data?.totals?.totalCities || 0, icon: "🏙️", key: "cities" },
    { label: "Total orders", value: data?.totals?.totalOrders || 0, icon: "🧾", key: "orders" },
    { label: "Phlebotomists", value: data?.totals?.totalPhlebos || 0, icon: "🧑‍⚕️", key: "phlebos" },
    { label: "Labs", value: data?.totals?.totalLabs || 0, icon: "🧪", key: "labs" },
  ];

  return (
    <>
      <Topbar title="All Cities" subtitle="Read-only overview — city Admins manage their own data" />
      <div className="p-4 md:p-8 space-y-6">
        <div
          className="rounded-2xl bg-gradient-to-r from-violet-100 via-violet-50 to-white border border-violet-100 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          style={{ boxShadow: "0 2px 4px rgba(109,40,217,0.05), 0 12px 28px -10px rgba(109,40,217,0.20)" }}
        >
          <div>
            <div className="text-violet-500 text-xs font-medium uppercase tracking-wide">Superadmin</div>
            <h2 className="text-slate-900 text-xl font-semibold mt-1">Platform-wide overview</h2>
            <p className="text-slate-500 text-sm mt-1">
              Each city&apos;s Admin manages its data — view-only here
            </p>
          </div>
          <button
            onClick={() => navigate("/team")}
            className="rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-white text-sm font-medium px-4 py-2.5 transition-all shrink-0"
            style={{ boxShadow: "0 2px 4px rgba(124,58,237,0.2), 0 8px 16px -6px rgba(124,58,237,0.4)" }}
          >
            + Create city admin
          </button>
        </div>

        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}
        {loading ? (
          <div className="text-slate-500 text-sm">Loading…</div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {stats.map((s) => (
                <button
                  key={s.label}
                  onClick={() => (s.key === "cities" ? focusMetric(s.key) : openDetail(s.key))}
                  className={`card-3d p-5 text-left w-full cursor-pointer ${
                    sortKey === s.key ? "ring-2 ring-violet-400" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-100 to-violet-200 text-violet-600 flex items-center justify-center text-base shrink-0"
                      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)" }}
                    >
                      {s.icon}
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-slate-900 leading-none">{s.value}</div>
                      <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div
              id="cities-table"
              className={`card-3d overflow-hidden scroll-mt-6 transition-shadow ${
                flash ? "ring-2 ring-violet-400" : ""
              }`}
            >
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Cities</h3>
                {sortKey ? (
                  <button
                    onClick={() => setSortKey(null)}
                    className="text-xs text-violet-600 hover:underline"
                  >
                    Sorted by {stats.find((s) => s.key === sortKey)?.label || "city"} · Reset
                  </button>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">City</th>
                      <th className="text-left px-4 py-3 font-medium">Admin</th>
                      <th className="text-left px-4 py-3 font-medium">Orders</th>
                      <th className="text-left px-4 py-3 font-medium">Phlebos</th>
                      <th className="text-left px-4 py-3 font-medium">Labs</th>
                      <th className="text-left px-4 py-3 font-medium">Cash pending</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedCities.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                          No city admin yet —{" "}
                          <button
                            onClick={() => navigate("/team")}
                            className="text-violet-600 font-medium hover:underline"
                          >
                            Create one on the Team page
                          </button>
                        </td>
                      </tr>
                    ) : (
                      sortedCities.map((c) => (
                        <tr key={c.adminId} className="hover:bg-violet-50/40 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-800">{c.city}</td>
                          <td className="px-4 py-3 text-slate-600">
                            <div className="flex items-center gap-2.5">
                              <div className="h-7 w-7 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold flex items-center justify-center shrink-0">
                                {(c.adminName || "?").charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div>{c.adminName}</div>
                                <div className="text-xs text-slate-400">{c.adminEmail}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {c.completedOrders}/{c.totalOrders} done
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {c.activePhlebos}/{c.totalPhlebos}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{c.totalLabs}</td>
                          <td className="px-4 py-3 text-slate-600">₹{c.cashPending || 0}</td>
                          <td className="px-4 py-3">
                            <Badge>{c.adminActive ? "active" : "suspended"}</Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <Modal
        open={!!detailView}
        onClose={() => setDetailView(null)}
        title={
          detailView === "orders"
            ? "All orders (read-only)"
            : detailView === "phlebos"
            ? "All phlebotomists (read-only)"
            : detailView === "labs"
            ? "All labs (read-only)"
            : ""
        }
        width="max-w-xl"
      >
        <div className="space-y-3">
          {detailError ? (
            <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{detailError}</div>
          ) : null}
          <input
            className="input"
            placeholder="Search…"
            value={detailSearch}
            onChange={(e) => setDetailSearch(e.target.value)}
          />

          {detailLoading ? (
            <div className="text-sm text-slate-400 text-center py-8">Loading…</div>
          ) : detailView === "orders" ? (
            <div className="max-h-[60vh] overflow-y-auto space-y-1.5">
              {filteredOrders.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No orders found</p>
              ) : (
                filteredOrders.map((o) => (
                  <div
                    key={o._id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-800">{o.patientName}</div>
                      <div className="text-xs text-slate-400">
                        {o.city || "—"} · {o.slotDate} {o.slotTime}
                      </div>
                    </div>
                    <Badge>{o.phleboStatus || "Unassigned"}</Badge>
                  </div>
                ))
              )}
              {ordersList && ordersList.length >= 200 ? (
                <p className="text-xs text-slate-400 text-center pt-1">
                  Showing first 200 only — view the full list via that city&apos;s Admin
                </p>
              ) : null}
            </div>
          ) : detailView === "phlebos" ? (
            <div className="max-h-[60vh] overflow-y-auto space-y-1.5">
              {filteredPhlebos.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No phlebotomists found</p>
              ) : (
                filteredPhlebos.map((p) => (
                  <div
                    key={p._id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-800">{p.name}</div>
                      <div className="text-xs text-slate-400">
                        {p.city || "—"} · {p.phone}
                      </div>
                    </div>
                    <Badge>{p.status}</Badge>
                  </div>
                ))
              )}
            </div>
          ) : detailView === "labs" ? (
            <div className="max-h-[60vh] overflow-y-auto space-y-1.5">
              {filteredLabs.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No labs found</p>
              ) : (
                filteredLabs.map((l) => (
                  <div
                    key={l._id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-800">{l.name}</div>
                      <div className="text-xs text-slate-400">
                        {l.city || "—"} · {l.email}
                      </div>
                    </div>
                    <Badge>{l.isActive === false ? "inactive" : "active"}</Badge>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

function CityDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const { preset, range, applyPreset, setCustom } = useDateRange("30d");

  function load(r) {
    setLoading(true);
    setError("");
    adminApi
      .analytics(r)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const byClient = data?.jobsByClient || {};
  const visibleByClient = Object.entries(byClient).filter(([slug]) => !isHiddenClient(slug));
  const maxClientJobs = Math.max(1, ...visibleByClient.map(([, count]) => count), 1);

  const goOrders = (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    navigate(`/orders${qs ? `?${qs}` : ""}`);
  };

  return (
    <>
      <Topbar title="Dashboard" subtitle="Live overview across all sources" />
      <div className="p-4 md:p-8 space-y-6">
        <DateRangeBar preset={preset} range={range} onPreset={applyPreset} onCustom={setCustom} />

        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}
        {loading ? (
          <div className="text-slate-500 text-sm">Loading…</div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Total Orders" value={data.totalOrders} onClick={() => goOrders()} />
              <StatCard
                label="Completed"
                value={data.completedOrders}
                hint={`${data.completionRate}%`}
                accent="green"
                onClick={() => goOrders()}
              />
              <StatCard
                label="Unassigned"
                value={data.unassignedOrders}
                accent="amber"
                onClick={() => goOrders({ phleboStatus: "NeedsAssign" })}
              />
              <StatCard
                label="Rejected"
                value={data.rejectedOrders}
                accent="rose"
                onClick={() => goOrders({ phleboStatus: "Rejected" })}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <StatCard
                label="Active Phlebotomists"
                value={`${data.activePhlebos} / ${data.totalPhlebos}`}
                onClick={() => navigate("/phlebos")}
              />
              <StatCard
                label="Sources"
                value={visibleClients(data.clients || []).length}
                onClick={() => goOrders()}
              />
              <StatCard
                label="Cash awaiting settlement"
                value={`₹${data.totalCashPending || 0}`}
                hint={data.totalCashPendingCount ? `${data.totalCashPendingCount} orders` : undefined}
                accent="amber"
                onClick={() => navigate("/payments")}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Orders by Source</h3>
                <div className="space-y-3">
                  {visibleByClient.length === 0 ? (
                    <p className="text-sm text-slate-400">No orders yet</p>
                  ) : (
                    visibleByClient.map(([slug, count]) => (
                      <button
                        key={slug}
                        onClick={() => goOrders({ clientSlug: slug })}
                        className="w-full text-left group"
                      >
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span className="font-medium text-slate-700 group-hover:text-brand-600">
                            {slug}
                          </span>
                          <span>{count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-brand-500 group-hover:bg-brand-600"
                            style={{ width: `${(count / maxClientJobs) * 100}%` }}
                          />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="card p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Sources</h3>
                <div className="space-y-2">
                  {visibleClients(data.clients || []).length === 0 ? (
                    <p className="text-sm text-slate-400">No sources yet</p>
                  ) : (
                    visibleClients(data.clients || []).map((c) => (
                      <button
                        key={c._id}
                        onClick={() => goOrders({ clientSlug: c.slug })}
                        className="w-full flex items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50 text-left"
                      >
                        <div>
                          <div className="text-sm font-medium text-slate-800">{c.name}</div>
                          <div className="text-xs text-slate-400">{c.slug}</div>
                        </div>
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            c.status === "active"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {c.status}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
