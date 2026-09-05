const { shouldAcceptWebhook } = require("../services/razorpay");
const { handleWebhookEvent } = require("../services/onlinePayment");

/**
 * Razorpay → POST /v1/api/webhooks/razorpay
 * Dashboard: Account & Settings → Webhooks → URL + secret (RAZORPAY_WEBHOOK_SECRET)
 * Events: qr_code.credited, payment.captured, payment_link.paid
 */
module.exports = async function razorpayWebhook(req, res) {
  try {
    const raw = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}));
    const signature = req.headers["x-razorpay-signature"];
    if (!shouldAcceptWebhook(raw, signature)) {
      return res.status(400).json({ success: false, message: "Invalid webhook signature" });
    }

    let event;
    try {
      event = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).json({ success: false, message: "Invalid JSON" });
    }

    const result = await handleWebhookEvent(event);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[razorpay webhook]", error);
    // 200 so Razorpay does not retry forever on our bugs after we already logged
    return res.status(200).json({ success: false, message: error.message });
  }
};
