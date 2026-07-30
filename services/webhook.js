const crypto = require("crypto");
const Client = require("../Models/Client");

/**
 * Partner website ko status update bhejo (fire-and-forget).
 */
async function notifyPartner(job) {
  try {
    const client = await Client.findById(job.clientId);
    if (!client || !client.webhookUrl || client.status !== "active") {
      return { skipped: true };
    }

    const payload = {
      event: "job.status_changed",
      jobId: String(job._id),
      externalOrderId: job.externalOrderId,
      clientSlug: client.slug,
      phleboStatus: job.phleboStatus,
      status: job.status,
      assignedPhleboName: job.assignedPhleboName || "",
      assignedPhleboId: job.assignedPhlebo ? String(job.assignedPhlebo) : null,
      paymentStatus: job.paymentStatus,
      paymentCollectedMethod: job.paymentCollectedMethod || "",
      collectedAt: job.collectedAt,
      arrivedAt: job.arrivedAt,
      rejectedReason: job.rejectedReason || "",
      items: (job.items || []).map((i) => ({
        productId: i.productId,
        name: i.name,
        category: i.category || "",
        price: i.price,
        quantity: i.quantity || 1,
        addedByPhlebo: !!i.addedByPhlebo,
      })),
      amount: job.amount,
      totalAmount: job.totalAmount,
      samples: (job.samples || []).map((s) => ({
        barcode: s.barcode,
        sampleType: s.sampleType,
      })),
      handover: job.handover?.completed
        ? {
            completed: true,
            barcodes: job.handover.barcodes || [],
            handedOverAt: job.handover.handedOverAt,
          }
        : null,
      updatedAt: job.updatedAt || new Date(),
    };

    const body = JSON.stringify(payload);
    // Stable sign string — JSON key-order safe across services
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

    job.lastWebhookAt = new Date();
    job.lastWebhookStatus = `${res.status}`;
    await job.save().catch(() => {});

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[webhook] ${client.slug} → ${client.webhookUrl} HTTP ${res.status}`,
        text.slice(0, 200)
      );
      return { ok: false, status: res.status };
    }

    console.log(`[webhook] ${client.slug} job ${job._id} → ${job.phleboStatus}`);
    return { ok: true };
  } catch (err) {
    console.warn("[webhook] failed:", err.message);
    return { ok: false, error: err.message };
  }
}

/** Save job + notify partner (non-blocking notify) */
async function saveAndNotify(job) {
  await job.save();
  setImmediate(() => {
    notifyPartner(job).catch(() => {});
  });
  return job;
}

module.exports = { notifyPartner, saveAndNotify };
