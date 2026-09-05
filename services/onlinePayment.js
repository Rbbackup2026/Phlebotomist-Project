const Job = require("../Models/Job");
const { saveAndNotify } = require("./webhook");
const { pushJobToLis } = require("./lisBooking");
const razorpay = require("./razorpay");

/** Phlebo QR is valid for 5 minutes, then a fresh one is issued. */
const QR_TTL_MS = 5 * 60 * 1000;
/** Razorpay close_by / expire_by must be at least 15 minutes from now. */
const RAZORPAY_CLOSE_AFTER_SEC = 15 * 60;

function qrExpiresAt() {
  return new Date(Date.now() + QR_TTL_MS);
}

function razorpayCloseByUnix() {
  return Math.floor(Date.now() / 1000) + RAZORPAY_CLOSE_AFTER_SEC;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function duePaise(job) {
  return Math.round(Number(job.totalAmount || job.amount || 0) * 100);
}

function notesFor(job) {
  return {
    jobId: String(job._id),
    pickupId: String(job.pickupId || ""),
  };
}

function cappedExpiresAt(job) {
  const cap = Date.now() + QR_TTL_MS;
  const stored = job.razorpayQrExpiresAt ? new Date(job.razorpayQrExpiresAt).getTime() : 0;
  if (!stored || Number.isNaN(stored)) return new Date(cap);
  return new Date(Math.min(stored, cap));
}

function qrPublic(job, { includeImage = false } = {}) {
  const status = String(job.razorpayQrStatus || "");
  const active = status === "active" && String(job.paymentStatus || "") !== "Paid";
  return {
    configured: razorpay.isRazorpayConfigured(),
    kind: job.razorpayQrKind || "",
    qrId: active ? job.razorpayQrId || "" : "",
    imageUrl: active && includeImage ? job.razorpayQrImageUrl || "" : "",
    status,
    expiresAt: active ? cappedExpiresAt(job) : null,
    ttlSeconds: Math.round(QR_TTL_MS / 1000),
    amountPaise: job.razorpayQrAmountPaise || 0,
    merchantName:
      String(process.env.RAZORPAY_MERCHANT_NAME || "").trim() ||
      "MODERN DIAGNOSTIC AND RESEARCH CENTRE LIMITED",
  };
}

async function markJobPaidUpi(job, { paymentId, collectedBy } = {}) {
  if (String(job.paymentStatus || "") === "Paid") return job;
  job.paymentStatus = "Paid";
  job.paymentCollectedAt = new Date();
  job.paymentCollectedMethod = "UPI";
  job.paymentCollectedBy = collectedBy || job.assignedPhlebo || job.paymentCollectedBy;
  job.razorpayQrStatus = "paid";
  if (paymentId) job.razorpayPaymentId = String(paymentId);
  await saveAndNotify(job);
  await pushJobToLis(job._id);
  return Job.findById(job._id);
}

async function closeRemote(job) {
  const id = job.razorpayQrId;
  if (!id) return;
  if (job.razorpayQrKind === "link") {
    await razorpay.cancelPaymentLink(id);
  } else {
    await razorpay.closeQr(id);
  }
}

function assertCanCollect(job) {
  if (String(job.paymentStatus || "") === "Paid") {
    throw httpError(400, "Payment already collected");
  }
  if (job.phleboStatus === "Handed Off") {
    throw httpError(400, "Job is handed off — no further edits allowed");
  }
  if (job.phleboStatus !== "Sample Collected") {
    throw httpError(400, "Mark sample collected before collecting payment");
  }
  const paise = duePaise(job);
  if (paise <= 0) throw httpError(400, "No payment due");
  if (paise < 100) throw httpError(400, "Amount too small for UPI (minimum ₹1)");
  return paise;
}

async function reuseOrCreate(job, amountPaise) {
  const remaining = job.razorpayQrExpiresAt
    ? new Date(job.razorpayQrExpiresAt).getTime() - Date.now()
    : 0;
  const sameOpen =
    job.razorpayQrId &&
    job.razorpayQrStatus === "active" &&
    Number(job.razorpayQrAmountPaise) === amountPaise &&
    remaining > 60 * 1000 &&
    remaining <= QR_TTL_MS;

  if (sameOpen) {
    const synced = await syncIfPending(job);
    if (String(synced.paymentStatus) === "Paid") return synced;
    if (synced.razorpayQrImageUrl) return synced;
  }

  if (job.razorpayQrId && job.razorpayQrStatus === "active") {
    await closeRemote(job).catch(() => {});
    job.razorpayQrStatus = "closed";
  }
  return null;
}

async function saveQrOnJob(job, fields) {
  Object.assign(job, fields);
  await job.save();
  return job;
}

async function createViaQrApi(job, amountPaise) {
  const closeBy = razorpayCloseByUnix();
  const qr = await razorpay.createUpiQr({
    name: String(job.pickupId || "Phlebo").slice(0, 40),
    amountPaise,
    description: `${job.patientName || "Patient"} · ${job.pickupId || job._id}`,
    closeBy,
    notes: notesFor(job),
  });
  const imageUrl = await razorpay.displayImageForQr({
    imageUrl: qr.image_url,
    payload: qr.image_url,
  });
  return saveQrOnJob(job, {
    razorpayQrId: qr.id,
    razorpayQrKind: "qr",
    razorpayQrImageUrl: imageUrl || qr.image_url || "",
    razorpayQrStatus: "active",
    razorpayQrExpiresAt: qrExpiresAt(),
    razorpayQrAmountPaise: amountPaise,
    razorpayPaymentId: "",
  });
}

async function createViaPaymentLink(job, amountPaise) {
  const expireBy = razorpayCloseByUnix();
  const args = {
    amountPaise,
    description: `Sample collection ${job.pickupId || ""}`.trim(),
    customer: { name: job.patientName, contact: job.mobileNumber },
    expireBy,
    notes: notesFor(job),
  };
  let link;
  try {
    link = await razorpay.createPaymentLink({ ...args, upiLink: true });
  } catch (e) {
    console.warn("[razorpay] UPI payment link failed, retrying standard link:", e.message);
    link = await razorpay.createPaymentLink({ ...args, upiLink: false });
  }
  const payload = link.short_url || "";
  const imageUrl = payload ? await razorpay.toQrDataUrl(payload) : "";
  return saveQrOnJob(job, {
    razorpayQrId: link.id,
    razorpayQrKind: "link",
    razorpayQrImageUrl: imageUrl,
    razorpayQrStatus: "active",
    razorpayQrExpiresAt: qrExpiresAt(),
    razorpayQrAmountPaise: amountPaise,
    razorpayPaymentId: "",
  });
}

async function openQr(job, { force = false } = {}) {
  const amountPaise = assertCanCollect(job);
  if (force) {
    if (job.razorpayQrId && job.razorpayQrStatus === "active") {
      await closeRemote(job).catch(() => {});
      job.razorpayQrStatus = "closed";
    }
  } else {
    const reused = await reuseOrCreate(job, amountPaise);
    if (reused) return reused;
  }

  try {
    return await createViaQrApi(job, amountPaise);
  } catch (e) {
    console.warn("[razorpay] UPI QR API failed, using payment link:", e.message);
    try {
      return await createViaPaymentLink(job, amountPaise);
    } catch (e2) {
      const err = new Error(e2.message || e.message || "Could not create UPI QR");
      err.status = e2.status || e.status || 502;
      throw err;
    }
  }
}

function firstPaymentId(list) {
  const items = list?.items || list || [];
  if (!Array.isArray(items) || !items.length) return "";
  const captured = items.find((p) => /captured|authorized/i.test(String(p.status || "")));
  return String((captured || items[0]).id || "");
}

async function syncQrCode(job) {
  const qr = await razorpay.fetchQr(job.razorpayQrId);
  const received = Number(qr.payments_amount_received || 0);
  const count = Number(qr.payments_count_received || 0);
  const closed = String(qr.status || "") === "closed";
  if (received >= Number(job.razorpayQrAmountPaise || qr.payment_amount || 0) || count > 0) {
    let paymentId = "";
    try {
      paymentId = firstPaymentId(await razorpay.fetchQrPayments(job.razorpayQrId));
    } catch {
      paymentId = "";
    }
    return markJobPaidUpi(job, { paymentId });
  }
  if (closed && String(job.razorpayQrStatus) === "active") {
    job.razorpayQrStatus = "closed";
    await job.save();
  }
  return job;
}

async function syncPaymentLink(job) {
  const link = await razorpay.fetchPaymentLink(job.razorpayQrId);
  const status = String(link.status || "").toLowerCase();
  if (status === "paid") {
    const payments = link.payments || [];
    const paymentId = payments[0]?.payment_id || payments[0]?.id || "";
    return markJobPaidUpi(job, { paymentId });
  }
  if (status === "cancelled" || status === "expired") {
    if (job.razorpayQrStatus === "active") {
      job.razorpayQrStatus = "closed";
      await job.save();
    }
  }
  return job;
}

async function syncIfPending(job) {
  if (!job) return job;
  if (String(job.paymentStatus) === "Paid") return job;
  if (!job.razorpayQrId || job.razorpayQrStatus !== "active") return job;
  if (!razorpay.isRazorpayConfigured()) return job;
  try {
    if (job.razorpayQrKind === "link") return await syncPaymentLink(job);
    return await syncQrCode(job);
  } catch (e) {
    console.warn("[razorpay] sync failed:", e.message);
    return job;
  }
}

async function cancelQr(job) {
  if (String(job.paymentStatus) === "Paid") return job;
  if (!job.razorpayQrId) return job;
  await closeRemote(job).catch((e) => {
    console.warn("[razorpay] close failed:", e.message);
  });
  job.razorpayQrStatus = "closed";
  await job.save();
  return job;
}

function extractIdsFromEvent(event) {
  const payload = event?.payload || {};
  const qr = payload.qr_code?.entity || payload.qr_code || {};
  const payment = payload.payment?.entity || payload.payment || {};
  const link = payload.payment_link?.entity || payload.payment_link || {};
  const notes = {
    ...(qr.notes || {}),
    ...(payment.notes || {}),
    ...(link.notes || {}),
  };
  return {
    jobId: String(notes.jobId || ""),
    qrId: String(qr.id || ""),
    linkId: String(link.id || ""),
    paymentId: String(payment.id || ""),
    paymentStatus: String(payment.status || ""),
    eventName: String(event?.event || ""),
  };
}

function isPaidEvent(info) {
  const name = info.eventName.toLowerCase();
  if (name.includes("credited") || name.includes("captured") || name.endsWith(".paid")) {
    return true;
  }
  return /captured|authorized/i.test(info.paymentStatus);
}

async function handleWebhookEvent(event) {
  const info = extractIdsFromEvent(event);
  if (!isPaidEvent(info)) return { ignored: true, event: info.eventName };

  let job = null;
  if (info.jobId) job = await Job.findById(info.jobId);
  if (!job && info.qrId) job = await Job.findOne({ razorpayQrId: info.qrId });
  if (!job && info.linkId) job = await Job.findOne({ razorpayQrId: info.linkId });
  if (!job && info.paymentId) job = await Job.findOne({ razorpayPaymentId: info.paymentId });
  if (!job) return { ignored: true, reason: "job not found" };

  if (String(job.paymentStatus) === "Paid") {
    return { ok: true, alreadyPaid: true, jobId: String(job._id) };
  }

  await markJobPaidUpi(job, { paymentId: info.paymentId });
  return { ok: true, jobId: String(job._id) };
}

module.exports = {
  qrPublic,
  openQr,
  syncIfPending,
  cancelQr,
  handleWebhookEvent,
  isRazorpayConfigured: razorpay.isRazorpayConfigured,
};
