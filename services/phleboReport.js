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

function validYmd(value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return "";
  return s;
}

function periodBounds({ period = "monthly", year, month, quarter, half, from, to } = {}) {
  const y = Number(year) || new Date().getFullYear();
  if (period === "all") return null;
  if (period === "dates") {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    let fromDate = validYmd(from) || today;
    let toDate = validYmd(to) || fromDate;
    if (fromDate > toDate) {
      const swap = fromDate;
      fromDate = toDate;
      toDate = swap;
    }
    return {
      fromDate,
      toDate,
      label: fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`,
    };
  }
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
      "assignedPhlebo assignedPhleboName collectedAt slotDate slotTime totalAmount amount discountAmount " +
        "samples patientName mobileNumber pickupId paymentStatus paymentMethod paymentCollectedMethod " +
        "phleboStatus items clientName city area handover.handedOverAt assignedLabName isRedraw redrawReason " +
        "otpVerifiedVia otpBypassReason otpBypassByName"
    )
    .lean();
}

function money(order) {
  return Number(order.totalAmount ?? order.amount ?? 0) || 0;
}

function paid(order) {
  return String(order.paymentStatus || "").toLowerCase() === "paid";
}

function onTime(order, date) {
  const slot = String(order.slotDate || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(slot) && slot === date;
}

function testLabel(order) {
  return (order.items || [])
    .map((i) => String(i.name || "").trim())
    .filter(Boolean)
    .join(", ");
}

function extraAmount(order) {
  return (order.items || [])
    .filter((i) => i.addedByPhlebo)
    .reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0);
}

function summarize(orders, range) {
  const map = new Map();
  const totals = {
    collections: 0,
    revenue: 0,
    paidRevenue: 0,
    pendingRevenue: 0,
    handedOff: 0,
    onTime: 0,
    tubes: 0,
    rejectedTubes: 0,
    extraRevenue: 0,
    redraws: 0,
  };
  for (const order of orders) {
    const date = orderReportDate(order);
    if (!inRange(date, range)) continue;
    const name = String(order.assignedPhleboName || "").trim() || "Unassigned";
    const key = `${date}|${String(order.assignedPhlebo || name)}`;
    const amount = money(order);
    const isPaid = paid(order);
    const timely = onTime(order, date);
    const tubes = (order.samples || []).length;
    const rejected = (order.samples || []).filter((s) => s.rejected).length;
    const extra = extraAmount(order);
    const handed = order.phleboStatus === "Handed Off" || Boolean(order.handover?.handedOverAt);
    const row = map.get(key) || {
      date: date || "—",
      phleboId: String(order.assignedPhlebo || ""),
      phleboName: name,
      collections: 0,
      revenue: 0,
      paidRevenue: 0,
      pendingRevenue: 0,
      handedOff: 0,
      onTime: 0,
      tubes: 0,
    };
    row.collections += 1;
    row.revenue += amount;
    row.tubes += tubes;
    if (isPaid) row.paidRevenue += amount;
    else row.pendingRevenue += amount;
    if (handed) row.handedOff += 1;
    if (timely) row.onTime += 1;
    map.set(key, row);

    totals.collections += 1;
    totals.revenue += amount;
    if (isPaid) totals.paidRevenue += amount;
    else totals.pendingRevenue += amount;
    if (handed) totals.handedOff += 1;
    if (timely) totals.onTime += 1;
    totals.tubes += tubes;
    totals.rejectedTubes += rejected;
    totals.extraRevenue += extra;
    if (order.isRedraw) totals.redraws += 1;
  }
  const rows = [...map.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.phleboName.localeCompare(b.phleboName);
  });
  totals.avgOrderValue = totals.collections ? Math.round(totals.revenue / totals.collections) : 0;
  totals.onTimeRate = totals.collections ? Math.round((totals.onTime / totals.collections) * 100) : 0;
  return { rows, totals };
}

function orderLines(orders, range) {
  return orders
    .map((order) => {
      const date = orderReportDate(order);
      if (!inRange(date, range)) return null;
      const amount = money(order);
      const tubes = (order.samples || []).length;
      const rejected = (order.samples || []).filter((s) => s.rejected).length;
      return {
        date: date || "—",
        phleboId: String(order.assignedPhlebo || ""),
        phleboName: String(order.assignedPhleboName || "").trim() || "Unassigned",
        pickupId: order.pickupId || "",
        patientName: order.patientName || "",
        mobileNumber: order.mobileNumber || "",
        source: order.clientName || "",
        area: [order.area, order.city].filter(Boolean).join(", "),
        slot: [order.slotDate, order.slotTime].filter(Boolean).join(" "),
        status: order.phleboStatus || "",
        tests: testLabel(order),
        tubes,
        rejectedTubes: rejected,
        paymentStatus: order.paymentStatus || "",
        paymentMethod: order.paymentCollectedMethod || order.paymentMethod || "",
        revenue: amount,
        discount: Number(order.discountAmount) || 0,
        extraRevenue: extraAmount(order),
        onTime: onTime(order, date) ? "Yes" : "No",
        handedOver: order.handover?.handedOverAt ? istDate(order.handover.handedOverAt) : "",
        lab: order.assignedLabName || "",
        redraw: order.isRedraw ? order.redrawReason || "Yes" : "",
        patientVerify: patientVerify(order),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.phleboName.localeCompare(b.phleboName) || a.pickupId.localeCompare(b.pickupId);
    });
}

function patientVerify(order) {
  if (order.otpVerifiedVia === "admin-code") {
    return order.otpBypassByName ? `Admin code · ${order.otpBypassByName}` : "Admin code";
  }
  if (order.otpBypassReason) return `OTP skipped · ${order.otpBypassReason}`;
  return "Patient OTP";
}

function excelOrderRow(r) {
  return {
    Date: r.date,
    "Pickup ID": r.pickupId,
    Patient: r.patientName,
    Mobile: r.mobileNumber,
    "Phlebo name": r.phleboName,
    Source: r.source,
    Area: r.area,
    Slot: r.slot,
    Status: r.status,
    Tests: r.tests,
    Tubes: r.tubes,
    "Rejected tubes": r.rejectedTubes,
    Payment: r.paymentStatus,
    "Payment method": r.paymentMethod,
    Revenue: r.revenue,
    Discount: r.discount,
    "Extra test amount": r.extraRevenue,
    "On time": r.onTime,
    "Handed over": r.handedOver,
    Lab: r.lab,
    Redraw: r.redraw,
    "Patient verify": r.patientVerify,
  };
}

module.exports = {
  periodBounds,
  loadCollectedOrders,
  summarize,
  orderLines,
  excelOrderRow,
};
