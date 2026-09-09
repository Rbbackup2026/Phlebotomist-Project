const express = require("express");
const router = express.Router();
const Client = require("../Models/Client");
const Order = require("../Models/Order");
const { geocodeAndAutoAssign } = require("../services/autoAssign");
const { generatePickupId, generateTrackingToken } = require("../services/pickupId");

/** Order create ke baad — background geocode + nearest on-duty phlebo auto-assign. */
function autoAssignInBackground(order) {
  setImmediate(() => {
    geocodeAndAutoAssign(order).catch(() => {});
  });
}

/** Partner / CRM: Authorization: Bearer <apiKey> */
async function verifyPartner(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const key =
      (auth.startsWith("Bearer ") ? auth.slice(7).trim() : "") ||
      String(req.headers["x-api-key"] || "").trim();

    if (!key) {
      return res.status(401).json({
        success: false,
        message: "API key required (Authorization: Bearer pk_live_…)",
      });
    }

    const client = await Client.findOne({ apiKey: key, status: "active" });
    if (!client) {
      return res.status(401).json({ success: false, message: "Invalid API key" });
    }

    req.client = client;
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * POST /partner/orders — CRM/website pe order create hone ke baad Phlebo mein order banao
 * Legacy alias: POST /partner/jobs (same handler)
 */
async function createPartnerOrder(req, res) {
  try {
    const b = req.body || {};
    const externalOrderId = String(b.externalOrderId || b.orderId || "").trim();
    if (!externalOrderId) {
      return res.status(400).json({ success: false, message: "externalOrderId required" });
    }
    if (!b.patientName || !b.address || !b.slotDate || !b.slotTime) {
      return res.status(400).json({
        success: false,
        message: "patientName, address, slotDate, slotTime required",
      });
    }

    const existing = await Order.findOne({
      clientId: req.client._id,
      externalOrderId,
    });
    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Order already exists",
        orderId: existing._id,
        order: existing,
        duplicate: true,
      });
    }

    const hasCoords = typeof b.lat === "number" && typeof b.lng === "number";
    const [pickupId, trackingToken] = await Promise.all([
      generatePickupId(),
      generateTrackingToken(),
    ]);

    const order = await Order.create({
      clientId: req.client._id,
      clientSlug: req.client.slug,
      clientName: req.client.name,
      externalOrderId,
      pickupId,
      trackingToken,
      items: Array.isArray(b.items) ? b.items : [],
      patientName: String(b.patientName).trim(),
      gender: b.gender || "",
      mobileNumber: b.mobileNumber || "",
      address: String(b.address).trim(),
      state: b.state || "",
      city: b.city || "",
      area: b.area || "",
      pincode: b.pincode || "",
      lat: hasCoords ? b.lat : null,
      lng: hasCoords ? b.lng : null,
      geocodedAt: hasCoords ? new Date() : null,
      slotDate: String(b.slotDate).trim(),
      slotTime: String(b.slotTime).trim(),
      amount: b.amount ?? b.totalAmount ?? 0,
      totalAmount: b.totalAmount ?? b.amount ?? 0,
      status: b.status || "Booked",
      paymentMethod: b.paymentMethod || "COD",
      paymentStatus: b.paymentStatus || "Unpaid",
      specialInstructions: b.specialInstructions || "",
      phleboStatus: "Unassigned",
      createdBySource: "partner",
    });

    autoAssignInBackground(order);

    res.status(201).json({
      success: true,
      message: "Order created in Phlebo",
      orderId: order._id,
      order,
    });
  } catch (error) {
    if (error.code === 11000) {
      const again = await Order.findOne({
        clientId: req.client._id,
        externalOrderId: String(req.body.externalOrderId || req.body.orderId || "").trim(),
      });
      return res.status(200).json({
        success: true,
        message: "Order already exists",
        orderId: again?._id,
        order: again,
        duplicate: true,
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

/** GET /partner/orders/:externalOrderId — CRM apna order status check kare */
async function getPartnerOrder(req, res) {
  try {
    const order = await Order.findOne({
      clientId: req.client._id,
      externalOrderId: String(req.params.externalOrderId).trim(),
    });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

router.post("/partner/orders", verifyPartner, createPartnerOrder);
router.get("/partner/orders/:externalOrderId", verifyPartner, getPartnerOrder);

// Legacy aliases (purane Wello / integrations break na hon)
router.post("/partner/jobs", verifyPartner, createPartnerOrder);
router.get("/partner/jobs/:externalOrderId", verifyPartner, getPartnerOrder);

/** POST /partner/register-client — platform seed only (protected by PLATFORM_SEED_KEY) */
router.post("/partner/register-client", async (req, res) => {
  try {
    const { isProduction, getPlatformSeedKey } = require("../services/securityConfig");
    if (isProduction() && String(process.env.ALLOW_CLIENT_REGISTER || "").toLowerCase() !== "true") {
      return res.status(403).json({
        success: false,
        message: "Client registration disabled in production",
      });
    }
    const seedKey = getPlatformSeedKey();
    if (!req.headers["x-seed-key"] || String(req.headers["x-seed-key"]) !== seedKey) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const { name, slug, webhookUrl, contactEmail } = req.body || {};
    if (!name || !slug) {
      return res.status(400).json({ success: false, message: "name and slug required" });
    }
    const exists = await Client.findOne({ slug: String(slug).toLowerCase().trim() });
    if (exists) {
      return res.json({ success: true, client: exists, message: "Client already exists" });
    }
    const client = await Client.create({
      name: String(name).trim(),
      slug: String(slug).toLowerCase().trim(),
      webhookUrl: webhookUrl || "",
      contactEmail: contactEmail || "",
    });
    res.status(201).json({
      success: true,
      client: {
        id: client._id,
        name: client.name,
        slug: client.slug,
        apiKey: client.apiKey,
        webhookSecret: client.webhookSecret,
        webhookUrl: client.webhookUrl,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
module.exports.verifyPartner = verifyPartner;
