/**
 * Push collected+paid jobs to LIS BookingAPINew.
 * Panel_ID = phlebo.lisPanelId (PUPMasterData client code) — API naya client nahi banati.
 */
const Job = require("../Models/Job");
const Phlebotomist = require("../Models/Phlebotomist");

const DEFAULT_LIS_BOOKING_URL =
  "https://lis6.mdrcindia.com/mdrcnew/api/BookingAPI/BookingAPINew";

function bookingEnabled() {
  const flag = String(process.env.LIS_BOOKING_ENABLED || "true").toLowerCase();
  return flag !== "false" && flag !== "0";
}

function bookingUrl() {
  return (
    String(process.env.LIS_BOOKING_API_URL || DEFAULT_LIS_BOOKING_URL).trim() ||
    DEFAULT_LIS_BOOKING_URL
  );
}

function ymd(d) {
  const dt = d instanceof Date ? d : new Date(d || Date.now());
  if (Number.isNaN(dt.getTime())) {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function digitsMobile(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length >= 10) return d.slice(-10);
  return d;
}

function designationFor(gender) {
  const g = String(gender || "").toLowerCase();
  if (g.startsWith("f")) return "Mrs.";
  if (g.startsWith("m")) return "Mr.";
  return "Mr.";
}

function applyAgeFields(doc, body = {}) {
  if (body.age != null && String(body.age).trim() !== "") {
    const n = parseInt(String(body.age).replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n >= 0 && n <= 130) doc.age = String(n);
  }
  if (body.dob != null && String(body.dob).trim() !== "") {
    const d = String(body.dob).trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) doc.dob = d;
  }
  return doc;
}

function lisAgeDob(job) {
  let dob = String(job.dob || "").trim();
  let age = String(job.age || "").replace(/\D/g, "");
  if (!age && dob) {
    const m = dob.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!Number.isNaN(birth.getTime())) {
        const now = new Date();
        let a = now.getFullYear() - birth.getFullYear();
        const md = now.getMonth() - birth.getMonth();
        if (md < 0 || (md === 0 && now.getDate() < birth.getDate())) a -= 1;
        if (a >= 0 && a <= 130) age = String(a);
      }
    }
  }
  return { age, dob };
}

function lisPaymentType(method) {
  const m = String(method || "").toLowerCase();
  if (m.includes("upi")) return "UPI";
  if (m.includes("debit")) return "Debit Card";
  if (m.includes("credit")) return "Credit Card";
  if (m.includes("card")) return "Debit Card";
  if (m.includes("online") || m.includes("paytm") || m.includes("razor") || m.includes("wallet")) {
    return "ONLINE";
  }
  return "CASH";
}

/**
 * Cash at door → LIS Due (Fully UnPaid): paymentType CASH, paymentAmount 0.
 * UPI/online → LIS Paid: same paymentType with paymentAmount = total.
 * Proven on Receipt Reprint: CASH + amount 0 → Paid 0 / Bal = net; CASH + amount → Paid.
 */
function lisBillSettlement(job) {
  const total = Number(job.totalAmount || job.amount || 0);
  const payType = lisPaymentType(job.paymentCollectedMethod || job.paymentMethod);
  const online = payType !== "CASH";
  const paidAmt = online ? total : 0;
  return {
    paymentType: payType,
    advance: "0",
    paymentList: [
      {
        paymentType: payType,
        paymentAmount: paidAmt,
        issueBank: "",
        chequeNo: "",
      },
    ],
  };
}

function isReadyForLis(job) {
  const status = String(job.phleboStatus || "");
  if (status !== "Sample Collected" && status !== "Handed Off") return false;
  const due = Number(job.totalAmount || job.amount || 0);
  if (due > 0 && String(job.paymentStatus || "") !== "Paid") return false;
  return true;
}

function unwrapLis(data) {
  if (typeof data === "string") {
    const s = data.trim();
    if (!s) return {};
    try {
      return unwrapLis(JSON.parse(s));
    } catch {
      return { Message: s };
    }
  }
  if (data && typeof data === "object" && !Array.isArray(data) && data.data != null) {
    if (typeof data.data === "string") {
      const inner = data.data.trim();
      if (!inner) return data;
      try {
        return unwrapLis(JSON.parse(inner));
      } catch {
        return { Message: inner };
      }
    }
    if (typeof data.data === "object") {
      const inner = data.data;
      if (
        inner &&
        (inner.Message ||
          inner.message ||
          inner.code ||
          inner.reportDetails ||
          inner.ledgertransactionno ||
          inner.billId)
      ) {
        return inner;
      }
    }
  }
  return data;
}

function lisSuccess(data) {
  const d = unwrapLis(data);
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  if (d.status === false) return false;
  const hasLedger = !!pickLedger(d);
  const hasReports = Array.isArray(d.reportDetails) && d.reportDetails.length > 0;
  const msg = String(d.Message || d.message || "").toLowerCase();
  if (msg === "success" || String(d.code) === "200" || d.status === true) {
    return hasLedger || hasReports;
  }
  return hasLedger || hasReports;
}

function pickLedger(data) {
  if (!data) return "";
  if (Array.isArray(data) && data[0]) return pickLedger(data[0]);
  if (data.ledgertransactionno) return String(data.ledgertransactionno);
  if (data.LedgerTransactionNo) return String(data.LedgerTransactionNo);
  const row = Array.isArray(data.reportDetails) && data.reportDetails[0];
  return row ? String(row.ledgertransactionno || row.LedgerTransactionNo || "") : "";
}

function isAlreadyRegistered(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("already registered") || s.includes("unique order number");
}

const DEFAULT_LIS_STATUS_URL =
  "https://lis6.mdrcindia.com/mdrcnew/api/BookingAPI/TestStatusAPI";

function statusUrl() {
  return (
    String(process.env.LIS_STATUS_API_URL || DEFAULT_LIS_STATUS_URL).trim() ||
    DEFAULT_LIS_STATUS_URL
  );
}

async function lookupLisStatus(orderNumber) {
  const id = String(orderNumber || "").trim();
  if (!id) return null;
  const payloads = [{ WorkOrderID: id }, { OrderNumber: id }, { orderNumber: id }];
  for (const body of payloads) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(statusUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (row && (row.LedgerTransactionNo || row.ledgertransactionno || row.BarcodeNo || row.billId)) {
        return data;
      }
    } catch {
      /* try next shape */
    }
  }
  return null;
}

function applyLisSuccess(job, body = {}) {
  const unwrapped = unwrapLis(body);
  const row = Array.isArray(unwrapped) ? unwrapped[0] : unwrapped;
  const first =
    (row && Array.isArray(row.reportDetails) && row.reportDetails[0]) ||
    (row && !Array.isArray(row) ? row : {}) ||
    {};
  job.lisBookingStatus = "success";
  job.lisBookingError = "";
  job.lisBookedAt = job.lisBookedAt || new Date();
  job.lisLedgerNo = pickLedger(unwrapped) || job.lisLedgerNo || "";
  job.lisBillId = String(
    (row && (row.billId || row.BillId)) || job.pickupId || job.lisBillId || ""
  ).trim();
  job.lisSampleId = String(
    first.sampleId || first.BarcodeNo || first.barcodeNo || job.lisSampleId || ""
  ).trim();
  job.lisReportUrl = String((row && row.url) || job.lisReportUrl || "").trim();
  job.lisReportPassword = String(
    (row && (row.Password_web || first.Password_web)) || job.lisReportPassword || ""
  ).trim();
  return job;
}

function buildTestList(job) {
  const rows = [];
  for (const item of job.items || []) {
    const testID = String(item.productId || item.sku || "").trim();
    if (!testID || /^manual-/i.test(testID) || /^hist-/i.test(testID)) continue;
    const testCode = String(item.sku || item.productId || "").trim() || testID;
    const qty = Math.max(1, Number(item.quantity) || 1);
    const unit = Number(item.price) || 0;
    rows.push({
      testID,
      testCode,
      Rate: unit * qty,
      integrationCode: "",
      dictionaryId: "",
      DiscountAmt: 0,
    });
  }
  return rows;
}

function buildPayload(job, phlebo) {
  const panelId = String(phlebo.lisPanelId || "").trim();
  const centreId = String(phlebo.lisCentreId || "1").trim() || "1";
  const total = Number(job.totalAmount || job.amount || 0);
  const pay = lisBillSettlement(job);
  const orderNumber = String(job.pickupId || job._id).trim();
  const testList = buildTestList(job);
  const { age, dob } = lisAgeDob(job);

  return {
    Panel_ID: panelId,
    CentreID: centreId,
    mobile: digitsMobile(job.mobileNumber),
    email: "",
    designation: designationFor(job.gender),
    fullName: String(job.patientName || "").trim(),
    age,
    gender: String(job.gender || "").trim() || "Male",
    area: String(job.area || "").trim(),
    city: String(job.city || "").trim(),
    Address: String(job.address || "").trim(),
    patientType: "",
    labPatientId: "",
    pincode: String(job.pincode || "").trim(),
    patientId: "",
    dob,
    passportNo: "",
    panNumber: "",
    aadharNumber: "",
    insuranceNo: "",
    nationality: "Indian",
    ethnicity: "",
    nationalIdentityNumber: "",
    workerCode: "",
    doctorCode: "",
    billDetails: {
      emergencyFlag: "0",
      totalAmount: total,
      advance: pay.advance,
      billDate: ymd(job.collectedAt || job.paymentCollectedAt || new Date()),
      paymentType: pay.paymentType,
      referralName: "",
      otherReferral: "",
      sampleId: "",
      orderNumber,
      referralIdLH: "",
      organisationName: String(phlebo.lisCompanyName || phlebo.name || "").trim(),
      additionalAmount: "0",
      organizationIdLH: "",
      comments: orderNumber,
      testList,
      paymentList: pay.paymentList,
    },
  };
}

function isEmptyLisBody(raw, data) {
  const t = String(raw || "").trim();
  if (!t || t === "{}" || t === "[]" || t === "null") return true;
  if (data && typeof data === "object" && !Array.isArray(data) && !Object.keys(data).length) return true;
  return false;
}

function withOrderNumber(payload, orderNumber) {
  const next = JSON.parse(JSON.stringify(payload));
  next.billDetails.orderNumber = orderNumber;
  next.billDetails.comments = orderNumber;
  return next;
}

async function postLis(payload) {
  const url = bookingUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await res.text();
    let data = {};
    const trimmed = String(raw || "").trim();
    if (trimmed) {
      try {
        data = JSON.parse(trimmed);
      } catch {
        data = { Message: snippetFromRaw(trimmed) };
      }
    }
    return { httpStatus: res.status, data, raw: trimmed };
  } finally {
    clearTimeout(timer);
  }
}

function snippetFromRaw(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const mysql = s.match(/MySql[^<\n]{0,400}/i);
  if (mysql) return mysql[0].trim();
  const table = s.match(/Table '[^']+' doesn't exist[^<\n]{0,80}/i);
  if (table) return table[0].trim();
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function errorMessage(data, httpStatus, raw) {
  const d = unwrapLis(data);
  if (typeof d === "string" && d.trim()) return d.trim().slice(0, 800);
  if (Array.isArray(d)) {
    if (!d.length) return "LIS returned empty [] — payload reject (often missing/invalid fields)";
    return JSON.stringify(d).slice(0, 800);
  }
  const nested = d && typeof d.data === "string" ? d.data.trim() : "";
  if (nested) return nested.slice(0, 800);
  const msg = d && (d.Message || d.message || d.error);
  if (msg && String(msg).trim()) return String(msg).trim().slice(0, 800);
  const snippet = snippetFromRaw(raw);
  if (snippet && snippet !== "{}") return snippet.slice(0, 800);
  return `LIS HTTP ${httpStatus} (empty body)`;
}

async function pushJobToLis(jobId, { force = false } = {}) {
  if (!bookingEnabled()) return { skipped: true, reason: "disabled" };

  const job = await Job.findById(jobId);
  if (!job) return { skipped: true, reason: "missing job" };

  if (!force && job.lisBookingStatus === "success" && job.lisLedgerNo) {
    return { skipped: true, reason: "already booked", ledger: job.lisLedgerNo };
  }

  if (!isReadyForLis(job)) {
    return { skipped: true, reason: "not collected+paid" };
  }

  if (!job.assignedPhlebo) {
    job.lisBookingStatus = "skipped";
    job.lisBookingError = "No assigned phlebo";
    await job.save();
    return { skipped: true, reason: "no phlebo" };
  }

  const phlebo = await Phlebotomist.findById(job.assignedPhlebo);
  const panelId = String(phlebo?.lisPanelId || "").trim();
  if (!phlebo || !panelId) {
    job.lisBookingStatus = "skipped";
    job.lisBookingError =
      "Phlebo pe LIS client code (Panel_ID) nahi hai — admin mein PUPMasterData number save karo";
    await job.save();
    return { skipped: true, reason: "no panel id" };
  }

  const testList = buildTestList(job);
  if (!testList.length) {
    job.lisBookingStatus = "failed";
    job.lisBookingError = "No LIS test codes on job items (itemid/sku missing)";
    await job.save();
    return { ok: false, error: job.lisBookingError };
  }

  job.lisBookingStatus = "pending";
  job.lisBookingError = "";
  job.lisPanelId = panelId;
  job.lisCompanyName = String(phlebo.lisCompanyName || phlebo.name || "").trim();
  job.lisCentreId = String(phlebo.lisCentreId || "1").trim() || "1";
  await job.save();

  let payload = buildPayload(job, phlebo);
  const { age, dob } = lisAgeDob(job);
  if (!age && !dob) {
    job.lisBookingStatus = "failed";
    job.lisBookingError = "Please enter Date of Birth,either Age.";
    await job.save();
    return { ok: false, error: job.lisBookingError };
  }

  let httpStatus = 0;
  let data = {};
  let raw = "";
  try {
    const result = await postLis(payload);
    httpStatus = result.httpStatus;
    data = result.data;
    raw = result.raw || "";
  } catch (err) {
    job.lisBookingStatus = "failed";
    job.lisBookingError = err.message || "LIS booking request failed";
    await job.save();
    console.warn("[lis-booking]", job.pickupId || job._id, job.lisBookingError);
    return { ok: false, error: job.lisBookingError };
  }

  let body = unwrapLis(data);
  if (!lisSuccess(body)) {
    const errText = errorMessage(data, httpStatus, raw);
    const locked = isAlreadyRegistered(errText) || isEmptyLisBody(raw, data);
    if (locked) {
      const found = await lookupLisStatus(job.pickupId || job._id);
      applyLisSuccess(job, found || {});
      if (job.lisLedgerNo) {
        await job.save();
        console.log(
          `[lis-booking] ${job.pickupId || job._id} already in LIS ledger ${job.lisLedgerNo}`
        );
        return { ok: true, alreadyRegistered: true, job };
      }
      const retryNo = `${job.pickupId || job._id}-R${Date.now().toString(36).slice(-6)}`;
      console.warn(
        `[lis-booking] retry ${job.pickupId || job._id} as ${retryNo} pay ${payload.billDetails.paymentType}`
      );
      try {
        const retry = await postLis(withOrderNumber(payload, retryNo));
        httpStatus = retry.httpStatus;
        data = retry.data;
        raw = retry.raw || "";
        body = unwrapLis(data);
      } catch (err) {
        job.lisBookingStatus = "failed";
        job.lisBookingError = err.message || "LIS booking retry failed";
        await job.save();
        console.warn("[lis-booking]", job.pickupId || job._id, job.lisBookingError);
        return { ok: false, error: job.lisBookingError };
      }
    }
  }

  if (!lisSuccess(body)) {
    const errText = errorMessage(data, httpStatus, raw);
    job.lisBookingStatus = "failed";
    job.lisBookingError = errText;
    await job.save();
    console.warn(
      "[lis-booking] fail",
      job.pickupId || job._id,
      job.lisBookingError,
      `pay ${payload.billDetails.paymentType} amt ${payload.billDetails.paymentList?.[0]?.paymentAmount}`,
      (raw || "").slice(0, 200)
    );
    return { ok: false, error: job.lisBookingError, data: body };
  }

  applyLisSuccess(job, body);
  if (!job.lisLedgerNo) {
    job.lisBookingStatus = "failed";
    job.lisBookingError = "LIS did not return Lab No (MGUR) — Patient Detail mein save nahi hua";
    await job.save();
    console.warn("[lis-booking] fail", job.pickupId || job._id, job.lisBookingError);
    return { ok: false, error: job.lisBookingError, data: body };
  }
  await job.save();

  console.log(
    `[lis-booking] ${job.pickupId || job._id} → panel ${panelId} ledger ${job.lisLedgerNo}`
  );
  return { ok: true, job };
}

function scheduleLisBooking(jobId) {
  if (!jobId) return;
  setImmediate(() => {
    pushJobToLis(jobId).catch((err) => {
      console.warn("[lis-booking] background", err.message);
    });
  });
}

module.exports = {
  pushJobToLis,
  scheduleLisBooking,
  isReadyForLis,
  buildPayload,
  applyAgeFields,
};
