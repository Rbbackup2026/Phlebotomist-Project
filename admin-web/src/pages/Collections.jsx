import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Topbar from "../components/Topbar.jsx";
import Badge from "../components/Badge.jsx";
import Modal from "../components/Modal.jsx";
import { adminApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

const SLOT_W = 100; // px — timeline chip width (room for readable text)
const PHLEBO_W = 188; // px — sticky left column
const DAY_START_H = 7;
const DAY_END_H = 20;

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function hhmm(h, m = 0) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseMins(slotTime) {
  const m = String(slotTime || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

function defaultDaySlots() {
  const out = [];
  for (let h = DAY_START_H; h <= DAY_END_H; h++) out.push(hhmm(h));
  return out;
}

/** Fixed operating-day columns + any free-text / odd job slot times merged in. */
function buildTimelineSlots(jobSlots) {
  const set = new Set(defaultDaySlots());
  (jobSlots || []).forEach((s) => {
    if (s) set.add(String(s));
  });
  return [...set].sort((a, b) => {
    const ma = parseMins(a);
    const mb = parseMins(b);
    if (ma !== null && mb !== null) return ma - mb;
    if (ma !== null) return -1;
    if (mb !== null) return 1;
    return String(a).localeCompare(String(b));
  });
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-700 font-medium">{value || "—"}</div>
    </div>
  );
}

function initials(name) {
  return (
    (name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "?"
  );
}

const AVATAR_COLORS = [
  "bg-violet-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-fuchsia-500",
];
function avatarColor(name) {
  let hash = 0;
  for (const ch of String(name || "")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function cellState(phlebo, jobsInCell) {
  if (jobsInCell.length > 0) {
    return jobsInCell.length >= (phlebo.slotCapacity || 1) ? "occupied" : "partial";
  }
  if (phlebo.onLeave) return "on_leave";
  if (phlebo.dutyStatus !== "on_duty") return "off_duty";
  if (phlebo.atCapacity) return "at_capacity";
  return "available";
}

const CELL_STYLES = {
  occupied: "bg-rose-50 border-rose-200 text-rose-800",
  partial: "bg-sky-50 border-sky-200 text-sky-700",
  available: "bg-emerald-50 border-emerald-200 text-emerald-700",
  at_capacity: "bg-amber-50 border-amber-200 text-amber-700",
  off_duty: "bg-slate-100 border-slate-200 text-slate-400",
  on_leave: "bg-violet-50 border-violet-200 text-violet-700",
};

const STATUS_DOT = {
  occupied: "bg-rose-500",
  partial: "bg-sky-500",
  available: "bg-emerald-500",
  at_capacity: "bg-amber-500",
  off_duty: "bg-slate-400",
  on_leave: "bg-violet-500",
};

const LEGEND = [
  { key: "occupied", label: "Full", cls: CELL_STYLES.occupied },
  { key: "partial", label: "Partial", cls: CELL_STYLES.partial },
  { key: "available", label: "Free", cls: CELL_STYLES.available },
  { key: "at_capacity", label: "Day full", cls: CELL_STYLES.at_capacity },
  { key: "on_leave", label: "Leave", cls: CELL_STYLES.on_leave },
  { key: "off_duty", label: "Off", cls: CELL_STYLES.off_duty },
  { key: "tight", label: "⚠ Tight", cls: "bg-white border-amber-300" },
];

export default function Collections() {
  const { user } = useAuth();
  const canManage = user?.role === "admin";
  const todayStr = ymd(new Date());
  const [date, setDate] = useState(todayStr);
  const [slotsFromApi, setSlotsFromApi] = useState([]);
  const [phlebos, setPhlebos] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailFor, setDetailFor] = useState(null);
  const [chooserJobs, setChooserJobs] = useState(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("board"); // board | list
  const [statusFilter, setStatusFilter] = useState(() => new Set());
  const unassignedRef = useRef(null);
  const boardScrollRef = useRef(null);

  const [leaveModalFor, setLeaveModalFor] = useState(null);
  const [leaveList, setLeaveList] = useState([]);
  const [leaveForm, setLeaveForm] = useState({ fromDate: "", toDate: "", reason: "" });
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  const [assignCellFor, setAssignCellFor] = useState(null);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState("");

  const [reassignForm, setReassignForm] = useState({ slotDate: "", slotTime: "", phleboId: "" });
  const [reassignSaving, setReassignSaving] = useState(false);
  const [reassignError, setReassignError] = useState("");

  // Tick every minute so the "now" line moves on Live · Today.
  const [nowMins, setNowMins] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date();
      setNowMins(n.getHours() * 60 + n.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  async function load(d) {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.collections(d);
      setSlotsFromApi(res.slots || []);
      setPhlebos(res.phlebos || []);
      setJobs(res.jobs || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const slots = useMemo(() => buildTimelineSlots(slotsFromApi), [slotsFromApi]);

  const jobsByPhleboSlot = useMemo(() => {
    const map = {};
    jobs.forEach((j) => {
      if (!j.assignedPhlebo) return;
      const key = `${j.assignedPhlebo}__${j.slotTime}`;
      (map[key] = map[key] || []).push(j);
    });
    return map;
  }, [jobs]);

  const unassignedJobs = useMemo(
    () => jobs.filter((j) => !j.assignedPhlebo).sort((a, b) => (a.slotTime > b.slotTime ? 1 : -1)),
    [jobs]
  );

  const locationSummaryByZone = useMemo(() => {
    const byZone = {};
    phlebos.forEach((p) => {
      const zone = p.zone || p.city || "Zone not set";
      const row =
        byZone[zone] ||
        (byZone[zone] = { zone, total: 0, available: 0, atCapacity: 0, onLeave: 0, offDuty: 0 });
      row.total += 1;
      if (p.onLeave) row.onLeave += 1;
      else if (p.dutyStatus !== "on_duty") row.offDuty += 1;
      else if (p.atCapacity) row.atCapacity += 1;
      else row.available += 1;
    });
    return byZone;
  }, [phlebos]);

  const groupedPhlebos = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? phlebos.filter((p) => `${p.name} ${p.zone} ${p.city}`.toLowerCase().includes(q))
      : phlebos;
    const byZone = {};
    filtered.forEach((p) => {
      const zone = p.zone || p.city || "Zone not set";
      (byZone[zone] = byZone[zone] || []).push(p);
    });
    return Object.keys(byZone)
      .sort((a, b) => a.localeCompare(b))
      .map((zone) => ({
        zone,
        summary: locationSummaryByZone[zone],
        rows: byZone[zone].sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [phlebos, search, locationSummaryByZone]);

  const listRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? phlebos.filter((p) => `${p.name} ${p.zone} ${p.city}`.toLowerCase().includes(q))
      : [...phlebos];
    const rank = (p) => {
      if (p.onLeave) return 3;
      if (p.dutyStatus !== "on_duty") return 2;
      if (p.atCapacity) return 1;
      return 0;
    };
    return filtered.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [phlebos, search]);

  const kpis = useMemo(
    () => ({
      total: phlebos.length,
      available: phlebos.filter((p) => !p.onLeave && p.dutyStatus === "on_duty" && !p.atCapacity)
        .length,
      unassigned: unassignedJobs.length,
      tight: jobs.filter((j) => j.tightSchedule).length,
    }),
    [phlebos, unassignedJobs, jobs]
  );

  const dayLabel =
    date === todayStr ? "Live · Today" : date < todayStr ? "Past" : "Upcoming";

  // Pixel offset of "now" inside the scrollable slot strip (0 = start of first slot).
  const nowOffsetPx = useMemo(() => {
    if (date !== todayStr || slots.length === 0) return null;
    const minsList = slots.map(parseMins);
    const first = minsList.find((m) => m !== null);
    const lastIdx = [...minsList].reverse().findIndex((m) => m !== null);
    const last = lastIdx >= 0 ? minsList[minsList.length - 1 - lastIdx] : null;
    if (first == null || last == null) return null;
    if (nowMins < first - 30 || nowMins > last + 60) return null;

    // Place between slots by linear interpolation on known HH:MM columns.
    let prevI = -1;
    let nextI = -1;
    for (let i = 0; i < minsList.length; i++) {
      if (minsList[i] == null) continue;
      if (minsList[i] <= nowMins) prevI = i;
      if (minsList[i] >= nowMins && nextI < 0) nextI = i;
    }
    if (prevI < 0 && nextI >= 0) return nextI * SLOT_W;
    if (nextI < 0 && prevI >= 0) return (prevI + 1) * SLOT_W;
    if (prevI === nextI) return prevI * SLOT_W + SLOT_W / 2;
    const t0 = minsList[prevI];
    const t1 = minsList[nextI];
    const frac = t1 === t0 ? 0.5 : (nowMins - t0) / (t1 - t0);
    return prevI * SLOT_W + frac * (nextI - prevI) * SLOT_W;
  }, [date, todayStr, slots, nowMins]);

  // On first load of today, scroll timeline so "now" is roughly in view.
  useEffect(() => {
    if (nowOffsetPx == null || !boardScrollRef.current || loading) return;
    const el = boardScrollRef.current;
    const target = Math.max(0, nowOffsetPx - el.clientWidth * 0.35);
    el.scrollLeft = target;
    // only when date/slots settle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, date, slots.length]);

  function toggleStatusFilter(key) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openDetail(job) {
    setDetailFor(job);
    setReassignForm({
      slotDate: job.slotDate,
      slotTime: job.slotTime,
      phleboId: job.assignedPhlebo || "",
    });
    setReassignError("");
  }

  function openCell(phlebo, slot, jobsInCell) {
    if (jobsInCell.length === 1) openDetail(jobsInCell[0]);
    else if (jobsInCell.length > 1) setChooserJobs(jobsInCell);
    else if (canManage) {
      setAssignCellFor({ phlebo, slot });
      setAssignError("");
    }
  }

  function nextFreeSlot(phlebo) {
    for (const s of slots) {
      const jobsInCell = jobsByPhleboSlot[`${phlebo._id}__${s}`] || [];
      if (cellState(phlebo, jobsInCell) === "available") return s;
    }
    return null;
  }

  async function assignToCell(job) {
    if (!assignCellFor) return;
    setAssignSaving(true);
    setAssignError("");
    try {
      await adminApi.rescheduleOrder(job._id, {
        slotDate: date,
        slotTime: assignCellFor.slot,
        phleboId: assignCellFor.phlebo._id,
      });
      setAssignCellFor(null);
      await load(date);
    } catch (e) {
      setAssignError(e.message);
    } finally {
      setAssignSaving(false);
    }
  }

  async function submitReassign(e) {
    e.preventDefault();
    if (!detailFor) return;
    if (!reassignForm.slotDate || !reassignForm.slotTime) {
      return setReassignError("Slot date and time are required");
    }
    setReassignSaving(true);
    setReassignError("");
    try {
      await adminApi.rescheduleOrder(detailFor._id, {
        slotDate: reassignForm.slotDate,
        slotTime: reassignForm.slotTime,
        phleboId: reassignForm.phleboId || undefined,
      });
      setDetailFor(null);
      await load(date);
    } catch (e2) {
      setReassignError(e2.message);
    } finally {
      setReassignSaving(false);
    }
  }

  async function openLeaveModal(phlebo) {
    setLeaveModalFor(phlebo);
    setLeaveForm({ fromDate: date, toDate: date, reason: "" });
    setLeaveError("");
    setLeaveList([]);
    try {
      const res = await adminApi.phleboLeaves(phlebo._id);
      setLeaveList(res.leaves || []);
    } catch {
      /* non-fatal */
    }
  }

  async function submitLeave(e) {
    e.preventDefault();
    if (!leaveModalFor) return;
    if (!leaveForm.fromDate || !leaveForm.toDate) return setLeaveError("From and to dates are required");
    setLeaveSaving(true);
    setLeaveError("");
    try {
      await adminApi.markLeave(leaveModalFor._id, leaveForm);
      const res = await adminApi.phleboLeaves(leaveModalFor._id);
      setLeaveList(res.leaves || []);
      await load(date);
    } catch (e2) {
      setLeaveError(e2.message);
    } finally {
      setLeaveSaving(false);
    }
  }

  async function removeLeave(leaveId) {
    if (!leaveModalFor) return;
    try {
      await adminApi.cancelLeave(leaveId);
      const res = await adminApi.phleboLeaves(leaveModalFor._id);
      setLeaveList(res.leaves || []);
      await load(date);
    } catch (e) {
      alert(e.message);
    }
  }

  function scrollToUnassigned() {
    unassignedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const boardMinW = PHLEBO_W + slots.length * SLOT_W;

  return (
    <>
      <Topbar
        title="Collections Tracking"
        subtitle="Dispatch board — every phlebo’s every slot at a glance"
      />

      {/* Sticky under Topbar — date, KPIs, search, legend in one strip */}
      <div className="sticky top-[4.75rem] md:top-[5.25rem] z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90 shadow-sm">
        <div className="px-4 md:px-6 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
              <button
                type="button"
                className="px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setDate((d) => addDays(d, -1))}
                aria-label="Previous day"
              >
                ◀
              </button>
              <input
                type="date"
                className="border-x border-slate-200 px-2 py-1.5 text-sm focus:outline-none w-[138px]"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <button
                type="button"
                className="px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setDate((d) => addDays(d, 1))}
                aria-label="Next day"
              >
                ▶
              </button>
            </div>
            {date !== todayStr ? (
              <button type="button" className="btn-secondary !py-1.5 !text-xs" onClick={() => setDate(todayStr)}>
                Today
              </button>
            ) : null}
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                date === todayStr
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {dayLabel}
            </span>

            <div className="hidden sm:flex items-center gap-1.5 ml-1">
              <KpiChip label="Phlebos" value={kpis.total} />
              <KpiChip
                label="Free"
                value={kpis.available}
                tone="emerald"
                active={statusFilter.has("available") && statusFilter.size === 1}
                onClick={() => {
                  setStatusFilter(new Set(statusFilter.has("available") && statusFilter.size === 1 ? [] : ["available"]));
                  setView("board");
                }}
              />
              <KpiChip
                label="Unassigned"
                value={kpis.unassigned}
                tone="amber"
                onClick={() => {
                  if (kpis.unassigned > 0) scrollToUnassigned();
                }}
              />
              <KpiChip
                label="Tight"
                value={kpis.tight}
                tone="rose"
                active={statusFilter.has("tight") && statusFilter.size === 1}
                onClick={() => {
                  setStatusFilter(new Set(statusFilter.has("tight") && statusFilter.size === 1 ? [] : ["tight"]));
                  setView("board");
                }}
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <input
                className="input !py-1.5 w-40 md:w-48 text-sm"
                placeholder="Search phlebo / zone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium">
                <button
                  type="button"
                  onClick={() => setView("board")}
                  className={`px-3 py-1.5 ${
                    view === "board" ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Board
                </button>
                <button
                  type="button"
                  onClick={() => setView("list")}
                  className={`px-3 py-1.5 border-l border-slate-200 ${
                    view === "list" ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  List
                </button>
              </div>
              <button type="button" className="btn-secondary !py-1.5 !text-xs" onClick={() => load(date)}>
                ⟳
              </button>
            </div>
          </div>

          {/* Mobile KPIs */}
          <div className="flex sm:hidden items-center gap-1.5 overflow-x-auto pb-0.5">
            <KpiChip label="Phlebos" value={kpis.total} />
            <KpiChip label="Free" value={kpis.available} tone="emerald" />
            <KpiChip label="Unassigned" value={kpis.unassigned} tone="amber" onClick={scrollToUnassigned} />
            <KpiChip label="Tight" value={kpis.tight} tone="rose" />
          </div>

          {view === "board" ? (
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              <span className="text-slate-400 mr-1 shrink-0">Filter:</span>
              {LEGEND.map((item) => (
                <LegendChip
                  key={item.key}
                  active={statusFilter.has(item.key)}
                  cls={item.cls}
                  label={item.label}
                  onClick={() => toggleStatusFilter(item.key)}
                />
              ))}
              {statusFilter.size > 0 ? (
                <button
                  type="button"
                  onClick={() => setStatusFilter(new Set())}
                  className="text-slate-400 hover:text-slate-700 underline underline-offset-2 ml-1"
                >
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="p-3 md:p-5 space-y-3">
        {error ? (
          <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div>
        ) : null}

        {/* Unassigned — priority strip */}
        {unassignedJobs.length > 0 ? (
          <div
            ref={unassignedRef}
            className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 sticky top-[8.75rem] md:top-[9.5rem] z-10"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0 animate-pulse" />
                <div className="text-sm font-semibold text-amber-900 truncate">
                  Needs assignment · {unassignedJobs.length}
                </div>
                <span className="hidden md:inline text-xs text-amber-700/80 truncate">
                  Click a free green slot on the board to drop one in
                </span>
              </div>
              <Link to="/orders?phleboStatus=NeedsAssign" className="text-sm text-brand-600 font-medium shrink-0">
                Orders →
              </Link>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              {unassignedJobs.map((j) => (
                <button
                  key={j._id}
                  type="button"
                  onClick={() => openDetail(j)}
                  className="shrink-0 w-44 rounded-lg border border-dashed border-amber-300 bg-white/80 hover:bg-white px-2.5 py-2 text-left transition-colors"
                >
                  <div className="text-xs font-semibold text-amber-700">{j.slotTime}</div>
                  <div className="text-sm font-medium text-slate-800 truncate">{j.patientName}</div>
                  <div className="text-xs text-slate-400 truncate font-mono">
                    {j.pickupId || "no pickup id"}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-xl border border-slate-100 bg-white px-4 py-12 text-center text-slate-400 text-sm">
            Loading…
          </div>
        ) : phlebos.length === 0 ? (
          <div className="rounded-xl border border-slate-100 bg-white px-4 py-12 text-center text-slate-400 text-sm">
            No phlebos found
          </div>
        ) : groupedPhlebos.length === 0 ? (
          <div className="rounded-xl border border-slate-100 bg-white px-4 py-12 text-center text-slate-400 text-sm">
            No phlebos match your search
          </div>
        ) : view === "list" ? (
          <ListView
            rows={listRows}
            nextFreeSlot={nextFreeSlot}
            onLeave={openLeaveModal}
            canManage={canManage}
          />
        ) : (
          <div className="space-y-4">
            {groupedPhlebos.map((group, gi) => (
              <section key={group.zone} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <ZoneHeader zone={group.zone} count={group.rows.length} summary={group.summary} />

                <div
                  ref={gi === 0 ? boardScrollRef : undefined}
                  className="overflow-x-auto relative"
                >
                  <div style={{ minWidth: boardMinW }} className="relative">
                    {/* Time header */}
                    <div className="flex border-b border-slate-100 bg-slate-50/80 sticky top-0 z-[5]">
                      <div
                        className="shrink-0 sticky left-0 z-[6] bg-slate-50 border-r border-slate-100 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                        style={{ width: PHLEBO_W }}
                      >
                        Phlebo
                      </div>
                      {slots.map((s) => {
                        const mins = parseMins(s);
                        const isPast =
                          date < todayStr || (date === todayStr && mins !== null && mins < nowMins - 30);
                        const isCurrentBucket =
                          date === todayStr &&
                          mins !== null &&
                          Math.abs(mins - nowMins) < 30;
                        return (
                          <div
                            key={s}
                            className={`shrink-0 px-1 py-2.5 text-center border-r border-slate-50 ${
                              isCurrentBucket
                                ? "bg-emerald-50 text-emerald-800 font-semibold"
                                : isPast
                                ? "text-slate-300"
                                : "text-slate-600"
                            }`}
                            style={{ width: SLOT_W }}
                          >
                            <div className="text-xs font-semibold tabular-nums leading-none">{s}</div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Now marker */}
                    {nowOffsetPx != null ? (
                      <div
                        className="pointer-events-none absolute top-0 bottom-0 z-[4] w-px bg-rose-500"
                        style={{ left: PHLEBO_W + nowOffsetPx }}
                        title="Now"
                      >
                        <span className="absolute top-8 left-1/2 -translate-x-1/2 rounded bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 leading-none whitespace-nowrap">
                          NOW
                        </span>
                      </div>
                    ) : null}

                    {group.rows.map((p) => (
                      <PhleboTimelineRow
                        key={p._id}
                        phlebo={p}
                        slots={slots}
                        jobsByPhleboSlot={jobsByPhleboSlot}
                        statusFilter={statusFilter}
                        canManage={canManage}
                        onOpenCell={openCell}
                        onLeave={openLeaveModal}
                      />
                    ))}
                  </div>
                </div>
              </section>
            ))}

            <p className="text-xs text-slate-400 px-1">
              Tip: click a green cell to assign an unassigned order. Click a booked cell for details / reschedule.
              {canManage ? "" : " (Read-only — only City Admin can assign)"}
            </p>
          </div>
        )}
      </div>

      <Modal open={!!chooserJobs} onClose={() => setChooserJobs(null)} title="Jobs in this slot">
        {chooserJobs ? (
          <div className="space-y-1.5">
            {chooserJobs.map((j) => (
              <button
                key={j._id}
                type="button"
                onClick={() => {
                  openDetail(j);
                  setChooserJobs(null);
                }}
                className="w-full flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:border-brand-300 hover:bg-brand-50/50"
              >
                <div>
                  <div className="text-sm font-medium text-slate-800">{j.patientName}</div>
                  <div className="text-xs text-slate-400">{j.pickupId || "—"}</div>
                </div>
                <Badge>{j.phleboStatus}</Badge>
              </button>
            ))}
          </div>
        ) : null}
      </Modal>

      <Modal open={!!detailFor} onClose={() => setDetailFor(null)} title="Order details" width="max-w-lg">
        {detailFor ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pickup ID" value={detailFor.pickupId} />
              <Field label="Patient" value={detailFor.patientName} />
              <Field label="Mobile" value={detailFor.mobileNumber} />
              <Field label="Slot" value={`${detailFor.slotDate} · ${detailFor.slotTime}`} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{detailFor.status}</Badge>
              <Badge>{detailFor.phleboStatus || "Unassigned"}</Badge>
              <Badge>{detailFor.paymentStatus}</Badge>
              {detailFor.isRedraw ? (
                <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2.5 py-0.5 text-xs font-medium">
                  Redraw
                </span>
              ) : null}
              {detailFor.rescheduleRequested ? (
                <span className="inline-flex items-center rounded-full bg-rose-50 text-rose-700 px-2.5 py-0.5 text-xs font-medium">
                  Patient asked to reschedule
                </span>
              ) : null}
            </div>
            {detailFor.tightSchedule ? (
              <div className="rounded-lg bg-amber-50 text-amber-700 text-xs px-3 py-2">
                ⚠ Tight schedule{detailFor.tightScheduleNote ? `: ${detailFor.tightScheduleNote}` : ""}
              </div>
            ) : null}

            {canManage && !["Sample Collected", "Handed Off"].includes(detailFor.phleboStatus) ? (
              <div className="rounded-xl border border-slate-100 p-3">
                <div className="label mb-2">Assign / reschedule</div>
                {reassignError ? (
                  <div className="rounded-lg bg-rose-50 text-rose-700 text-xs px-3 py-2 mb-2">
                    {reassignError}
                  </div>
                ) : null}
                <form onSubmit={submitReassign} className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label">Slot date</label>
                      <input
                        className="input !py-1 text-xs"
                        placeholder="YYYY-MM-DD"
                        value={reassignForm.slotDate}
                        onChange={(e) => setReassignForm({ ...reassignForm, slotDate: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Slot time</label>
                      <input
                        className="input !py-1 text-xs"
                        placeholder="e.g. 14:00"
                        value={reassignForm.slotTime}
                        onChange={(e) => setReassignForm({ ...reassignForm, slotTime: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label">Phlebo</label>
                    <select
                      className="input !py-1 text-xs"
                      value={reassignForm.phleboId}
                      onChange={(e) => setReassignForm({ ...reassignForm, phleboId: e.target.value })}
                    >
                      <option value="">Unassign / leave for auto-assign</option>
                      {phlebos.map((p) => (
                        <option key={p._id} value={p._id}>
                          {p.name} · {p.zone || p.city || "—"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" disabled={reassignSaving} className="btn-primary w-full !py-1.5 text-xs">
                    {reassignSaving ? "Saving…" : "Save slot / phlebo"}
                  </button>
                </form>
              </div>
            ) : null}

            <Link
              to="/orders"
              className="inline-block text-xs text-brand-600 font-medium"
              onClick={() => setDetailFor(null)}
            >
              Full order details / actions → Orders page
            </Link>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!assignCellFor}
        onClose={() => setAssignCellFor(null)}
        title={assignCellFor ? `Assign to ${assignCellFor.phlebo.name} · ${assignCellFor.slot}` : "Assign"}
      >
        {assignCellFor ? (
          <div className="space-y-3">
            {assignError ? (
              <div className="rounded-lg bg-rose-50 text-rose-700 text-xs px-3 py-2">{assignError}</div>
            ) : null}
            {unassignedJobs.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                No unassigned orders for this date
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-1.5">
                {unassignedJobs.map((j) => (
                  <button
                    key={j._id}
                    type="button"
                    disabled={assignSaving}
                    onClick={() => assignToCell(j)}
                    className="w-full flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:border-brand-300 hover:bg-brand-50/50 transition-colors disabled:opacity-50"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-800">{j.patientName}</div>
                      <div className="text-xs text-slate-400">
                        {j.pickupId || "—"} · current slot {j.slotTime}
                      </div>
                    </div>
                    <Badge>{j.phleboStatus || "Unassigned"}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!leaveModalFor}
        onClose={() => setLeaveModalFor(null)}
        title={leaveModalFor ? `Leave — ${leaveModalFor.name}` : "Leave"}
      >
        {leaveModalFor ? (
          <div className="space-y-3">
            {leaveError ? (
              <div className="rounded-lg bg-rose-50 text-rose-700 text-xs px-3 py-2">{leaveError}</div>
            ) : null}
            <form onSubmit={submitLeave} className="flex flex-wrap items-end gap-2">
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
              <button type="submit" disabled={leaveSaving} className="btn-primary !py-1.5 text-xs">
                {leaveSaving ? "Saving…" : "Mark leave"}
              </button>
            </form>
            {leaveList.length === 0 ? (
              <div className="text-xs text-slate-400">No leave records</div>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {leaveList.map((l) => (
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
        ) : null}
      </Modal>
    </>
  );
}

function KpiChip({ label, value, tone = "slate", active, onClick }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-800",
    rose: "bg-rose-50 text-rose-700",
  };
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm shrink-0 ${tones[tone]} ${
        onClick ? "hover:brightness-95 cursor-pointer" : ""
      } ${active ? "ring-2 ring-offset-1 ring-slate-400" : ""}`}
    >
      <span className="font-bold tabular-nums">{value}</span>
      <span className="opacity-80">{label}</span>
    </Comp>
  );
}

function LegendChip({ active, cls, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 transition-colors ${
        active ? "border-brand-300 bg-brand-50" : "border-transparent hover:bg-slate-50"
      }`}
    >
      <span
        className={`inline-flex items-center justify-center h-3.5 w-3.5 rounded-sm border shrink-0 ${cls} ${
          active ? "ring-1 ring-brand-400" : ""
        }`}
      >
        {active ? <span className="text-[10px] leading-none">✓</span> : null}
      </span>
      <span className={active ? "text-slate-800 font-medium" : "text-slate-600"}>{label}</span>
    </button>
  );
}

function ZoneHeader({ zone, count, summary }) {
  const bits = [];
  if (summary) {
    if (summary.available) bits.push(`${summary.available} free`);
    if (summary.atCapacity) bits.push(`${summary.atCapacity} day-full`);
    if (summary.onLeave) bits.push(`${summary.onLeave} leave`);
    if (summary.offDuty) bits.push(`${summary.offDuty} off`);
  }
  const freePct = summary?.total ? Math.round((summary.available / summary.total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 bg-white">
      <div className="min-w-0 flex items-baseline gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700 truncate">{zone}</h2>
        <span className="text-xs text-slate-400 shrink-0">{count}</span>
      </div>
      <div className="hidden sm:block h-1.5 w-24 rounded-full bg-slate-100 overflow-hidden shrink-0">
        <div className="h-full bg-emerald-500" style={{ width: `${freePct}%` }} />
      </div>
      <div className="text-xs text-slate-500 truncate">{bits.join(" · ") || "—"}</div>
    </div>
  );
}

function PhleboTimelineRow({
  phlebo: p,
  slots,
  jobsByPhleboSlot,
  statusFilter,
  canManage,
  onOpenCell,
  onLeave,
}) {
  const dutyLabel = p.onLeave ? "leave" : p.dutyStatus === "on_duty" ? "on" : "off";
  const dutyCls = p.onLeave
    ? "text-violet-600"
    : p.dutyStatus === "on_duty"
    ? "text-emerald-600"
    : "text-slate-400";

  return (
    <div className="flex border-b border-slate-50 last:border-b-0 hover:bg-slate-50/40">
      <div
        className="shrink-0 sticky left-0 z-[3] bg-white border-r border-slate-100 px-2.5 py-2 flex items-center gap-2.5"
        style={{ width: PHLEBO_W }}
      >
        <div
          className={`h-9 w-9 rounded-full ${avatarColor(
            p.name
          )} text-white text-xs font-bold flex items-center justify-center shrink-0`}
        >
          {initials(p.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium text-slate-800 truncate leading-tight">{p.name}</div>
          <div className="flex items-center gap-1.5 text-xs leading-tight mt-0.5">
            <span className={`font-semibold ${dutyCls}`}>{dutyLabel}</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500 tabular-nums">
              {p.jobsToday}/{p.maxDailyJobs}
            </span>
            <button
              type="button"
              onClick={() => onLeave(p)}
              className="text-violet-500 hover:text-violet-700 font-medium ml-auto"
            >
              Leave
            </button>
          </div>
          <div className="mt-1 h-1 w-full max-w-[100px] rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-brand-500"
              style={{
                width: `${Math.min(100, ((p.jobsToday || 0) / (p.maxDailyJobs || 1)) * 100)}%`,
              }}
            />
          </div>
        </div>
      </div>

      {slots.map((s) => {
        const jobsInCell = jobsByPhleboSlot[`${p._id}__${s}`] || [];
        const state = cellState(p, jobsInCell);
        const hasTight = jobsInCell.some((j) => j.tightSchedule);
        const clickable = jobsInCell.length > 0 || canManage;
        const matchesFilter =
          statusFilter.size === 0 ||
          statusFilter.has(state) ||
          (statusFilter.has("tight") && hasTight);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onOpenCell(p, s, jobsInCell)}
            disabled={!clickable}
            title={
              hasTight
                ? jobsInCell
                    .map((j) => j.tightScheduleNote)
                    .filter(Boolean)
                    .join(" · ")
                : jobsInCell.length === 0 && canManage
                ? "Click → assign order"
                : undefined
            }
            className={`relative shrink-0 border-r border-slate-50 px-1.5 py-1.5 text-left transition-all ${
              CELL_STYLES[state]
            } ${clickable ? "hover:brightness-95 cursor-pointer" : "cursor-default"} ${
              matchesFilter ? "" : "opacity-15 grayscale"
            }`}
            style={{ width: SLOT_W, minHeight: 64 }}
          >
            {hasTight ? (
              <span className="absolute top-1 right-1.5 text-amber-500 text-xs">⚠</span>
            ) : null}
            {jobsInCell.length > 0 ? (
              <>
                {jobsInCell.length > 1 ? (
                  <div className="text-[11px] font-bold opacity-70">
                    {jobsInCell.length}/{p.slotCapacity || 1}
                  </div>
                ) : null}
                <div className="text-xs font-semibold truncate leading-tight">
                  {jobsInCell[0].patientName}
                </div>
                <div className="truncate opacity-60 font-mono text-[11px] leading-tight">
                  {jobsInCell[0].pickupId || "—"}
                </div>
                <div className="mt-0.5 flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[state]}`} />
                  <span className="opacity-70 text-[11px] truncate">{jobsInCell[0].phleboStatus}</span>
                </div>
              </>
            ) : (
              <span className="text-xs italic opacity-80 leading-tight block pt-1.5">
                {state === "on_leave"
                  ? "Leave"
                  : state === "off_duty"
                  ? "Off"
                  : state === "at_capacity"
                  ? "Full"
                  : "Free"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ListView({ rows, nextFreeSlot, onLeave, canManage }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
              <th className="px-3 py-2.5 font-semibold">Phlebo</th>
              <th className="px-3 py-2.5 font-semibold">Zone</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Jobs today</th>
              <th className="px-3 py-2.5 font-semibold">Next free</th>
              <th className="px-3 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const free = nextFreeSlot(p);
              const status = p.onLeave
                ? { t: "On leave", c: "text-violet-700 bg-violet-50" }
                : p.dutyStatus !== "on_duty"
                ? { t: "Off duty", c: "text-slate-600 bg-slate-100" }
                : p.atCapacity
                ? { t: "Day full", c: "text-amber-700 bg-amber-50" }
                : { t: "Available", c: "text-emerald-700 bg-emerald-50" };
              return (
                <tr key={p._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-8 w-8 rounded-full ${avatarColor(
                          p.name
                        )} text-white text-xs font-bold flex items-center justify-center shrink-0`}
                      >
                        {initials(p.name)}
                      </div>
                      <span className="font-medium text-slate-800">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{p.zone || p.city || "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${status.c}`}>
                      {status.t}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">
                    {p.jobsToday}/{p.maxDailyJobs}
                    <div className="mt-1 h-1 w-16 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-brand-500"
                        style={{
                          width: `${Math.min(100, ((p.jobsToday || 0) / (p.maxDailyJobs || 1)) * 100)}%`,
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {free ? (
                      <span className="font-semibold text-emerald-600 tabular-nums">{free}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => onLeave(p)}
                        className="text-sm text-violet-600 hover:text-violet-800 font-medium"
                      >
                        Leave
                      </button>
                    ) : (
                      <span className="text-slate-300 text-sm">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
