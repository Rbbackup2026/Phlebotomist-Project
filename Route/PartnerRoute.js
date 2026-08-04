const express = require("express");
const router = express.Router();
const Client = require("../Models/Client");
const Job = require("../Models/Job");
const { geocodeAndAutoAssign } = require("../services/autoAssign");
const { generatePickupId, generateTrackingToken } = require("../services/pickupId");

/** Job create hone ke turant baad — background mein geocode (agar partner ne lat/lng
 *  khud nahi diya) + nearest on-duty phlebo ko auto-assign try karta hai (see
 *  services/autoAssign.js). Response block kiye bina (jaisa saveAndNotify webhook ke
 *  saath karta hai) — koi eligible phlebo na mile to job "Unassigned" hi rehti hai,
 *  Ops dashboard se manually assign ho sakti hai. */
function autoAssignInBackground(job) {
  setImmediate(() => {
    geocodeAndAutoAssign(job).catch(() => {});
  });
}

/** Partner websites: Authorization: Bearer <apiKey> */
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
 * POST /partner/jobs — website pe order create hone ke baad Phlebo job banao
 */
router.post("/partner/jobs", verifyPartner, async (req, res) => {
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

    const existing = await Job.findOne({
      clientId: req.client._id,
      externalOrderId,
    });
    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Job already exists",
        jobId: existing._id,
        job: existing,
        duplicate: true,
      });
    }

    // Partner website already has a map-pin lat/lng at checkout in most cases — use it
    // directly when sent. Only fall back to geocoding the address string ourselves.
    const hasCoords = typeof b.lat === "number" && typeof b.lng === "number";
    const [pickupId, trackingToken] = await Promise.all([
      generatePickupId(),
      generateTrackingToken(),
    ]);

    const job = await Job.create({
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
    });

    autoAssignInBackground(job);

    res.status(201).json({
      success: true,
      message: "Job created in Phlebo",
      jobId: job._id,
      job,
    });
  } catch (error) {
    if (error.code === 11000) {
      const again = await Job.findOne({
        clientId: req.client._id,
        externalOrderId: String(req.body.externalOrderId || req.body.orderId || "").trim(),
      });
      return res.status(200).json({
        success: true,
        message: "Job already exists",
        jobId: again?._id,
        job: again,
        duplicate: true,
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

/** GET /partner/jobs/:externalOrderId — website apna order status check kare */
router.get("/partner/jobs/:externalOrderId", verifyPartner, async (req, res) => {
  try {
    const job = await Job.findOne({
      clientId: req.client._id,
      externalOrderId: String(req.params.externalOrderId).trim(),
    });
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }
    res.json({ success: true, job });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** POST /partner/clients — platform seed only (protected by PLATFORM_SEED_KEY) */
router.post("/partner/register-client", async (req, res) => {
  try {
    // Production: disable unless ALLOW_CLIENT_REGISTER=true (prevents Postman abuse)
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
