const express = require("express");
const router = express.Router();
const Client = require("../Models/Client");
const Order = require("../Models/Order");
const { geocodeAndAutoAssign } = require("../services/autoAssign");
const { generatePickupId, generateTrackingToken } = require("../services/pickupId");
const { applyAgeFields } = require("../services/lisBooking");
const { saveAndNotify } = require("../services/webhook");

const LOCKED_VISIT = ["Sample Collected", "Handed Off"];

function autoAssignInBackground(order) {
  setImmediate(() => {
    geocodeAndAutoAssign(order, { assign: false }).catch(() => {});
  });
}

function canonicalCity(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (/gurgaon|gurugram|ggm/.test(s)) return "Gurugram";
  return String(raw).trim();
}

function partnerAllowedCities() {
  const fromEnv = String(process.env.CRM_ALLOWED_CITIES || "Gurugram,Gurgaon")
    .split(",")
    .map((x) => canonicalCity(x) || x.trim())
    .filter(Boolean);
  const set = new Set(fromEnv.map((c) => c.toLowerCase()));
  set.add("gurugram");
  set.add("gurgaon");
  return set;
}

/**
 * CRM se sirf allowed cities (default Gurugram). Blank city → default / address se infer.
 * Dusri city → reject so Noida/Delhi Phlebo Admin/App mein na aaye.
 */
function resolvePartnerCity(b) {
  let city = canonicalCity(b.city || b.cityName);
  if (!city) {
    const blob = `${b.address || ""} ${b.area || ""} ${b.state || ""}`;
    city = canonicalCity(/gurgaon|gurugram/i.test(blob) ? "Gurugram" : "");
  }
  if (!city) city = canonicalCity(process.env.CRM_DEFAULT_CITY || "Gurugram");
  const allowed = partnerAllowedCities();
  if (!allowed.has(city.toLowerCase())) {
    return {
      ok: false,
      message: `Phlebo only accepts Gurugram home-collection (got city "${city}"). Send city: Gurugram`,
    };
  }
  return { ok: true, city: "Gurugram" };
}

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
}

function mapItems(b) {
  const list = Array.isArray(b.items) ? b.items : Array.isArray(b.tests) ? b.tests : [];
  return list.map((i) => ({
    productId: String(i.productId || i.id || "").trim(),
    name: String(i.name || i.testName || "").trim(),
    category: String(i.category || "").trim(),
    price: Number(i.price) || 0,
    quantity: Math.max(1, Number(i.quantity) || 1),
    sku: String(i.sku || i.testCode || i.productId || i.id || "").trim(),
  }));
}

function parseCoord(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function totalsFrom(items, b) {
  const gross = items.reduce((s, i) => s + i.price * i.quantity, 0);
  let discount = Math.max(0, Number(b.discountAmount) || 0);
  const fromBody = Number(b.totalAmount ?? b.amount);
  if (gross > 0) {
    if (discount > gross) discount = gross;
    return { discount, payable: Math.max(0, gross - discount) };
  }
  const payable = Number.isFinite(fromBody) && fromBody >= 0 ? fromBody : 0;
  return { discount: 0, payable };
}

function partnerOrderView(order) {
  const o = typeof order.toObject === "function" ? order.toObject() : { ...order };
  const base = publicBase();
  return {
    orderId: o._id,
    pickupId: o.pickupId || null,
    trackingToken: o.trackingToken || null,
    trackingUrl:
      o.trackingToken && base ? `${base}/v1/api/public/track/${o.trackingToken}` : null,
    externalOrderId: o.externalOrderId,
    clientSlug: o.clientSlug,
    clientName: o.clientName,
    patientName: o.patientName,
    gender: o.gender,
    age: o.age,
    dob: o.dob,
    mobileNumber: o.mobileNumber,
    address: o.address,
    state: o.state,
    city: o.city,
    area: o.area,
    pincode: o.pincode,
    lat: o.lat,
    lng: o.lng,
    slotDate: o.slotDate,
    slotTime: o.slotTime,
    items: (o.items || []).map((i) => ({
      productId: i.productId,
      name: i.name,
      category: i.category || "",
      price: i.price,
      quantity: i.quantity || 1,
      sku: i.sku || "",
    })),
    discountAmount: o.discountAmount || 0,
    amount: o.amount,
    totalAmount: o.totalAmount,
    status: o.status,
    phleboStatus: o.phleboStatus,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    assignedPhleboName: o.assignedPhleboName || "",
    assignedAt: o.assignedAt,
    collectedAt: o.collectedAt,
    arrivedAt: o.arrivedAt,
    specialInstructions: o.specialInstructions || "",
    samples: (o.samples || []).map((s) => ({
      barcode: s.barcode,
      sampleType: s.sampleType,
    })),
    handover: o.handover?.completed
      ? { completed: true, handedOverAt: o.handover.handedOverAt }
      : null,
    cancelledBy: o.cancelledBy || "",
    cancelReason: o.cancelReason || "",
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function findClientOrder(client, externalOrderId) {
  return Order.findOne({
    clientId: client._id,
    externalOrderId: String(externalOrderId || "").trim(),
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

    const existing = await findClientOrder(req.client, externalOrderId);
    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Order already exists",
        orderId: existing._id,
        order: partnerOrderView(existing),
        duplicate: true,
      });
    }

    const cityRes = resolvePartnerCity(b);
    if (!cityRes.ok) {
      return res.status(400).json({ success: false, message: cityRes.message });
    }

    const items = mapItems(b);
    const { discount, payable } = totalsFrom(items, b);
    const lat = parseCoord(b.lat);
    const lng = parseCoord(b.lng);
    const hasCoords = lat != null && lng != null;
    const age = { age: "", dob: "" };
    applyAgeFields(age, b);

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
      items,
      patientName: String(b.patientName).trim(),
      gender: b.gender || "",
      age: age.age,
      dob: age.dob,
      mobileNumber: b.mobileNumber || "",
      address: String(b.address).trim(),
      state: b.state || "",
      city: cityRes.city,
      area: b.area || "",
      pincode: b.pincode || "",
      lat: hasCoords ? lat : null,
      lng: hasCoords ? lng : null,
      geocodedAt: hasCoords ? new Date() : null,
      slotDate: String(b.slotDate).trim(),
      slotTime: String(b.slotTime).trim(),
      discountAmount: discount,
      amount: payable,
      totalAmount: payable,
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
      pickupId: order.pickupId,
      order: partnerOrderView(order),
    });
  } catch (error) {
    if (error.code === 11000) {
      const again = await findClientOrder(
        req.client,
        String(req.body.externalOrderId || req.body.orderId || "").trim()
      );
      return res.status(200).json({
        success: true,
        message: "Order already exists",
        orderId: again?._id,
        order: again ? partnerOrderView(again) : null,
        duplicate: true,
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getPartnerOrder(req, res) {
  try {
    const order = await findClientOrder(req.client, req.params.externalOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    res.json({ success: true, order: partnerOrderView(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

/** CRM: patient/address/tests update — collection se pehle */
async function updatePartnerOrder(req, res) {
  try {
    const order = await findClientOrder(req.client, req.params.externalOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (order.status === "Cancelled") {
      return res.status(400).json({ success: false, message: "Cancelled order update nahi ho sakta" });
    }
    if (LOCKED_VISIT.includes(order.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message: "Sample already collected — update nahi ho sakta",
      });
    }

    const b = req.body || {};
    if (b.patientName) order.patientName = String(b.patientName).trim();
    if (b.gender != null) order.gender = String(b.gender);
    if (b.mobileNumber != null) order.mobileNumber = String(b.mobileNumber);
    if (b.address) order.address = String(b.address).trim();
    if (b.state != null) order.state = String(b.state);
    if (b.city != null || b.cityName != null || b.address) {
      const cityRes = resolvePartnerCity({ ...b, address: b.address || order.address });
      if (!cityRes.ok) {
        return res.status(400).json({ success: false, message: cityRes.message });
      }
      order.city = cityRes.city;
    }
    if (b.area != null) order.area = String(b.area);
    if (b.pincode != null) order.pincode = String(b.pincode);
    if (b.specialInstructions != null) order.specialInstructions = String(b.specialInstructions);
    if (b.paymentMethod) order.paymentMethod = String(b.paymentMethod);
    if (b.paymentStatus) order.paymentStatus = String(b.paymentStatus);
    applyAgeFields(order, b);

    const lat = parseCoord(b.lat);
    const lng = parseCoord(b.lng);
    if (lat != null && lng != null) {
      order.lat = lat;
      order.lng = lng;
      order.geocodedAt = new Date();
    }

    if (Array.isArray(b.items) || Array.isArray(b.tests)) {
      const items = mapItems(b);
      order.items = items;
      const { discount, payable } = totalsFrom(items, b);
      order.discountAmount = discount;
      order.amount = payable;
      order.totalAmount = payable;
    } else if (b.totalAmount != null || b.amount != null || b.discountAmount != null) {
      const { discount, payable } = totalsFrom(order.items || [], b);
      order.discountAmount = discount;
      order.amount = payable;
      order.totalAmount = payable;
    }

    await saveAndNotify(order);
    res.json({ success: true, message: "Order updated", order: partnerOrderView(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function cancelPartnerOrder(req, res) {
  try {
    const reason = String(req.body?.reason || req.body?.remark || "").trim() || "Cancelled by CRM";
    const order = await findClientOrder(req.client, req.params.externalOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (LOCKED_VISIT.includes(order.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message: "Sample already collected — cancel nahi ho sakta",
      });
    }
    if (order.status === "Cancelled") {
      return res.status(200).json({
        success: true,
        message: "Order already cancelled",
        order: partnerOrderView(order),
      });
    }

    order.status = "Cancelled";
    order.cancelledBy = "partner";
    order.cancelledByName = req.client.name || "CRM";
    order.cancelledAt = new Date();
    order.cancelReason = reason;
    order.rejectedReason = `Cancelled by CRM: ${reason}`;
    order.assignedPhlebo = null;
    order.assignedPhleboName = "";
    order.assignedBy = "";
    order.assignedAt = null;
    order.phleboStatus = "Unassigned";
    await saveAndNotify(order);

    res.json({ success: true, message: "Order cancelled", order: partnerOrderView(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function reschedulePartnerOrder(req, res) {
  try {
    const { slotDate, slotTime } = req.body || {};
    if (!slotDate || !slotTime) {
      return res.status(400).json({ success: false, message: "slotDate and slotTime required" });
    }
    const order = await findClientOrder(req.client, req.params.externalOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (LOCKED_VISIT.includes(order.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message: "Sample already collected — reschedule nahi ho sakta",
      });
    }

    const prevDate = order.slotDate;
    const prevTime = order.slotTime;
    order.slotDate = String(slotDate).trim();
    order.slotTime = String(slotTime).trim();
    const note = `CRM rescheduled: ${prevDate} ${prevTime} → ${order.slotDate} ${order.slotTime}`;
    order.adminNote = order.adminNote ? `${order.adminNote} | ${note}` : note;
    order.rescheduleRequested = false;
    order.rescheduleRequestedAt = null;
    order.rescheduleRequestNote = "";
    if (order.status === "Cancelled") {
      order.status = "Booked";
      order.cancelledBy = "";
      order.cancelledByName = "";
      order.cancelledAt = null;
      order.cancelReason = "";
    }
    order.assignedPhlebo = null;
    order.assignedPhleboName = "";
    order.phleboStatus = "Unassigned";
    order.assignedAt = null;
    order.assignedBy = "";
    order.rejectedReason = "";
    await saveAndNotify(order, { event: "order.rescheduled" });
    autoAssignInBackground(order);

    res.json({
      success: true,
      message: "Order rescheduled",
      order: partnerOrderView(order),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

router.post("/partner/orders", verifyPartner, createPartnerOrder);
router.get("/partner/orders/:externalOrderId", verifyPartner, getPartnerOrder);
router.put("/partner/orders/:externalOrderId", verifyPartner, updatePartnerOrder);
router.put("/partner/orders/:externalOrderId/cancel", verifyPartner, cancelPartnerOrder);
router.put("/partner/orders/:externalOrderId/reschedule", verifyPartner, reschedulePartnerOrder);

router.post("/partner/jobs", verifyPartner, createPartnerOrder);
router.get("/partner/jobs/:externalOrderId", verifyPartner, getPartnerOrder);
router.put("/partner/jobs/:externalOrderId", verifyPartner, updatePartnerOrder);
router.put("/partner/jobs/:externalOrderId/cancel", verifyPartner, cancelPartnerOrder);
router.put("/partner/jobs/:externalOrderId/reschedule", verifyPartner, reschedulePartnerOrder);

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
