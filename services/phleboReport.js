const mongoose = require("mongoose");
const Order = require("../Models/Order");

const COLLECTED = ["Sample Collected", "Handed Off"];
const TZ = "Asia/Kolkata";

function pad(n) {
  return String(n).padStart(2, "0");
}

function ymdLabel(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function lastDayOfMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

function periodBounds({ period = "monthly", year, month, quarter, half } = {}) {
  const y = Number(year) || new Date().getFullYear();
  if (period === "all") return null;
  if (period === "quarterly") {
    const q = Math.min(4, Math.max(1, Number(quarter) || 1));
    const start = (q - 1) * 3 + 1;
    const end = start + 2;
    return {
      fromDate: ymdLabel(y, start, 1),
      toDate: ymdLabel(y, end, lastDayOfMonth(y, end)),
      label: `${y} Q${q}`,
    };
  }
  if (period === "half") {
    const h = Number(half) === 2 ? 2 : 1;
    const start = h === 1 ? 1 : 7;
    const end = h === 1 ? 6 : 12;
    return {
      fromDate: ymdLabel(y, start, 1),
      toDate: ymdLabel(y, end, lastDayOfMonth(y, end)),
      label: `${y} ${h === 1 ? "H1 (Jan–Jun)" : "H2 (Jul–Dec)"}`,
    };
  }
  const m = Math.min(12, Math.max(1, Number(month) || new Date().getMonth() + 1));
  const monthName = new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long" });
  return {
    fromDate: ymdLabel(y, m, 1),
    toDate: ymdLabel(y, m, lastDayOfMonth(y, m)),
    label: `${monthName} ${y}`,
  };
}

function istDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function orderReportDate(order) {
  const fromCollected = istDate(order.collectedAt);
  if (fromCollected) return fromCollected;
  const slot = String(order.slotDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(slot)) return slot.slice(0, 10);
  return "";
}

function inRange(dateStr, range) {
  if (!range) return true;
  if (!dateStr) return false;
  return dateStr >= range.fromDate && dateStr <= range.toDate;
}

async function loadCollectedOrders(scopeFilter, { phleboId } = {}) {
  const filter = {
    ...scopeFilter,
    status: { $ne: "Cancelled" },
    phleboStatus: { $in: COLLECTED },
  };
  if (phleboId && mongoose.Types.ObjectId.isValid(phleboId)) filter.assignedPhlebo = phleboId;
  return Order.find(filter)
    .select(
      "assignedPhlebo assignedPhleboName collectedAt slotDate totalAmount amount samples patientName pickupId paymentStatus"
    )
    .lean();
}

function summarize(orders, range) {
  const map = new Map();
  let collections = 0;
  let revenue = 0;
  for (const order of orders) {
    const date = orderReportDate(order);
    if (!inRange(date, range)) continue;
    const name = String(order.assignedPhleboName || "").trim() || "Unassigned";
    const key = `${date}|${String(order.assignedPhlebo || name)}`;
    const amount = Number(order.totalAmount ?? order.amount ?? 0) || 0;
    const row = map.get(key) || {
      date: date || "—",
      phleboName: name,
      collections: 0,
      revenue: 0,
    };
    row.collections += 1;
    row.revenue += amount;
    map.set(key, row);
    collections += 1;
    revenue += amount;
  }
  const rows = [...map.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.phleboName.localeCompare(b.phleboName);
  });
  return {
    rows,
    totals: {
      collections,
      revenue,
    },
  };
}

function orderLines(orders, range) {
  return orders
    .map((order) => {
      const date = orderReportDate(order);
      if (!inRange(date, range)) return null;
      return {
        date: date || "—",
        phleboName: String(order.assignedPhleboName || "").trim() || "Unassigned",
        pickupId: order.pickupId || "",
        patientName: order.patientName || "",
        collections: 1,
        revenue: Number(order.totalAmount ?? order.amount ?? 0) || 0,
        paymentStatus: order.paymentStatus || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.phleboName.localeCompare(b.phleboName);
    });
}

module.exports = {
  periodBounds,
  loadCollectedOrders,
  summarize,
  orderLines,
};
