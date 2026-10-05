const crypto = require("crypto");
const Client = require("../Models/Client");
const Phlebotomist = require("../Models/Phlebotomist");

function isoOffset(date = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return isoOffset(new Date());
  const tzo = -d.getTimezoneOffset();
  const sign = tzo >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(tzo) / 60)).padStart(2, "0");
  const mm = String(Math.abs(tzo) % 60).padStart(2, "0");
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  return `${local}${sign}${hh}:${mm}`;
}

function isFrappeWebhook(client) {
  const type = String(client.webhookAuthType || "").toLowerCase();
  if (type === "frappe") return true;
  if (type === "hmac") return false;
  return /crm\.mdrcindia\.net|ingest_phlebo_event/i.test(client.webhookUrl || "");
}

function mapPartnerEvent(order, hint) {
  if (hint) return hint;
  if (order.status === "Cancelled") return "order.cancelled";
  switch (order.phleboStatus) {
    case "Unassigned":
      return "order.unassigned";
    case "Assigned":
    case "Accepted":
      return "order.assigned";
    case "Rejected":
      return "order.rejected";
    case "En Route":
    case "Arrived":
    case "OTP Verified":
    case "Consent Done":
      return "order.in_progress";
    case "Sample Collected":
    case "Handed Off":
      return "order.collected";
    default:
      return "order.status_changed";
  }
}

function frappeToken(client) {
  const raw = String(client.webhookToken || process.env.CRM_WEBHOOK_FRAPPE_TOKEN || "").trim();
  if (!raw) return "";
  return raw.toLowerCase().startsWith("token ") ? raw : `token ${raw}`;
}

/**
 * Partner website / CRM ko status update bhejo (fire-and-forget).
 * opts.event — CRM named event (order.assigned, order.rescheduled, …)
 */
async function notifyPartner(order, opts = {}) {
  try {
    const client = await Client.findById(order.clientId);
    if (!client || !client.webhookUrl || client.status !== "active") {
      return { skipped: true };
    }

    const orderId = String(order._id);
    const event = mapPartnerEvent(order, opts.event);
    const now = isoOffset(order.updatedAt || new Date());

    let assignedPhleboEmployeeId = "";
    if (order.assignedPhlebo) {
      const phlebo = await Phlebotomist.findById(order.assignedPhlebo).select("employeeId").lean();
      assignedPhleboEmployeeId = phlebo?.employeeId || "";
    }

    const payload = {
      event,
      occurredAt: now,
      orderId,
      jobId: orderId,
      externalOrderId: order.externalOrderId,
      pickupId: order.pickupId || null,
      clientSlug: client.slug,
      phleboStatus: order.phleboStatus,
      status: order.status,
      assignedPhleboName: order.assignedPhleboName || "",
      assignedPhleboId: order.assignedPhlebo ? String(order.assignedPhlebo) : null,
      assignedPhleboEmployeeId,
      slotDate: order.slotDate || "",
      slotTime: order.slotTime || "",
      paymentStatus: order.paymentStatus,
      paymentCollectedMethod: order.paymentCollectedMethod || null,
      cancelReason: order.cancelReason || order.rejectedReason || null,
      collectedAt: order.collectedAt,
      arrivedAt: order.arrivedAt,
      rejectedReason: order.rejectedReason || "",
      items: (order.items || []).map((i) => ({
        productId: i.productId,
        name: i.name,
        category: i.category || "",
        price: i.price,
        quantity: i.quantity || 1,
        addedByPhlebo: !!i.addedByPhlebo,
      })),
      amount: order.amount,
      totalAmount: order.totalAmount,
      samples: (order.samples || []).map((s) => ({
        barcode: s.barcode,
        sampleType: s.sampleType,
      })),
      handover: order.handover?.completed
        ? {
            completed: true,
            barcodes: order.handover.barcodes || [],
            handedOverAt: order.handover.handedOverAt,
          }
        : null,
      updatedAt: now,
    };

    const body = JSON.stringify(payload);
    const headers = { "Content-Type": "application/json" };
    const frappe = isFrappeWebhook(client);

    if (frappe) {
      const auth = frappeToken(client);
      if (!auth) {
        console.warn(`[webhook] ${client.slug} Frappe token missing — set webhookToken or CRM_WEBHOOK_FRAPPE_TOKEN`);
      } else {
        headers.Authorization = auth;
      }
    } else {
      const signBase = [
        payload.externalOrderId || "",
        payload.jobId || "",
        payload.phleboStatus || "",
        payload.status || "",
      ].join("|");
      headers["X-Phlebo-Signature"] = crypto
        .createHmac("sha256", client.webhookSecret || "")
        .update(signBase)
        .digest("hex");
      headers["X-Phlebo-Client"] = client.slug;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(client.webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    order.lastWebhookAt = new Date();
    order.lastWebhookStatus = `${res.status}`;
    await order.save().catch(() => {});

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[webhook] ${client.slug} → ${client.webhookUrl} HTTP ${res.status}`,
        text.slice(0, 200)
      );
      return { ok: false, status: res.status };
    }

    console.log(`[webhook] ${client.slug} ${event} order ${order._id} → ${order.phleboStatus}`);
    return { ok: true, event };
  } catch (err) {
    const msg = String(err.message || err);
    if (/fetch failed|econnrefused|enotfound|abort/i.test(msg)) {
      return { skipped: true, reason: "crm unreachable" };
    }
    console.warn("[webhook] failed:", msg);
    return { ok: false, error: msg };
  }
}

async function saveAndNotify(order, opts = {}) {
  await order.save();
  setImmediate(() => {
    notifyPartner(order, opts).catch(() => {});
  });
  return order;
}

module.exports = { notifyPartner, saveAndNotify, mapPartnerEvent };
