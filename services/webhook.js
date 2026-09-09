const crypto = require("crypto");
const Client = require("../Models/Client");

/**
 * Partner website ko status update bhejo (fire-and-forget).
 */
async function notifyPartner(order) {
  try {
    const client = await Client.findById(order.clientId);
    if (!client || !client.webhookUrl || client.status !== "active") {
      return { skipped: true };
    }

    const orderId = String(order._id);
    const payload = {
      event: "order.status_changed",
      orderId,
      // Legacy aliases (purane Wello listeners)
      jobId: orderId,
      externalOrderId: order.externalOrderId,
      clientSlug: client.slug,
      phleboStatus: order.phleboStatus,
      status: order.status,
      assignedPhleboName: order.assignedPhleboName || "",
      assignedPhleboId: order.assignedPhlebo ? String(order.assignedPhlebo) : null,
      paymentStatus: order.paymentStatus,
      paymentCollectedMethod: order.paymentCollectedMethod || "",
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
      updatedAt: order.updatedAt || new Date(),
    };

    const body = JSON.stringify(payload);
    // Stable sign string — JSON key-order safe across services (jobId legacy field)
    const signBase = [
      payload.externalOrderId || "",
      payload.jobId || "",
      payload.phleboStatus || "",
      payload.status || "",
    ].join("|");
    const signature = crypto
      .createHmac("sha256", client.webhookSecret || "")
      .update(signBase)
      .digest("hex");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(client.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Phlebo-Signature": signature,
        "X-Phlebo-Client": client.slug,
      },
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

    console.log(`[webhook] ${client.slug} order ${order._id} → ${order.phleboStatus}`);
    return { ok: true };
  } catch (err) {
    const msg = String(err.message || err);
    if (/fetch failed|econnrefused|enotfound|abort/i.test(msg)) {
      return { skipped: true, reason: "crm unreachable" };
    }
    console.warn("[webhook] failed:", msg);
    return { ok: false, error: msg };
  }
}

/** Save order + notify partner (non-blocking notify) */
async function saveAndNotify(order) {
  await order.save();
  setImmediate(() => {
    notifyPartner(order).catch(() => {});
  });
  return order;
}

module.exports = { notifyPartner, saveAndNotify };
