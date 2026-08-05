const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { verifyToken, requireRole, attachScope } = require("./authMiddleware");
const Phlebotomist = require("../Models/Phlebotomist");
const Job = require("../Models/Job");
const OpsUser = require("../Models/OpsUser");
const Client = require("../Models/Client");
const InventoryItem = require("../Models/InventoryItem");
const KitAssignment = require("../Models/KitAssignment");
const { saveAndNotify } = require("../services/webhook");
const { fetchTestCatalog, fetchTestById } = require("../services/catalog");
const { geocodeAndAutoAssign, tryAutoAssignPendingJobs } = require("../services/autoAssign");
const { generatePickupId, generateTrackingToken } = require("../services/pickupId");
const { sendPushToPhlebo } = require("../services/push");
const { computeIncentive } = require("../services/incentive");
const Attendance = require("../Models/Attendance");
const PhleboLeave = require("../Models/PhleboLeave");
const {
  saveDataUrlImage,
  absoluteMediaUrl,
  absoluteMediaUrls,
  coalescePhotoUrls,
} = require("../services/media");
const {
  getJwtSecret,
  allowDemoOtp,
  DEMO_OTP,
  isDemoOtp,
} = require("../services/securityConfig");

const ADD_TEST_STATUSES = ["Arrived", "OTP Verified", "Consent Done", "Sample Collected"];
// Geofence audit radius for arrival (soft flag only — never blocks arrival, geocoding
// can legitimately be off by this much for apartment complexes/wrong pins).
const GEOFENCE_RADIUS_M = 300;
// GPS noise/teleport guard for the daily-Kms accumulator — a jump bigger than this
// between two ~25s location pings is almost certainly a GPS glitch, not real travel.
const MAX_REALISTIC_PING_KM = 3;
// Jin statuses ke baad patient ka naam/number ab mask nahi hota (phlebo ne job accept
// kar li hai). Job list aur route-plan dono isi list ko use karte hain.
const UNMASKED_STATUSES = [
  "Accepted",
  "En Route",
  "Arrived",
  "OTP Verified",
  "Consent Done",
  "Sample Collected",
  "Handed Off",
];

/** Job create hone ke turant baad — background mein geocode + nearest-phlebo
 *  auto-assign try karta hai (services/autoAssign.js). Response block kiye bina. */
function autoAssignInBackground(job) {
  setImmediate(() => {
    geocodeAndAutoAssign(job).catch(() => {});
  });
}

/** Haversine great-circle distance in km — route optimization ke liye "as the crow
 *  flies" estimate (actual road distance nahi, lekin GPS coords se instant/free hai). */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// slotDate is a free-form string (whatever the website's date picker sent) — could be
// "17/07/2026" (DD/MM/YYYY), ISO, or "17 Jul 2026". Plain `new Date(raw)` misreads
// DD/MM/YYYY as US MM/DD/YYYY, so day>12 fails outright and day<=12 silently lands on
// the wrong date. Mirrors the same parser used on the app side (HomeScreen.js) so both
// sides agree on which calendar day a job actually falls on.
function parseSlotDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const dt = new Date(year, month - 1, day);
      if (!isNaN(dt.getTime())) return dt;
    }
  }
  const native = new Date(s);
  return isNaN(native.getTime()) ? null : native;
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function recalcJobTotals(job) {
  const total = (job.items || []).reduce(
    (sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 1),
    0
  );
  job.amount = total;
  job.totalAmount = total;
  return total;
}

/** Cash jo phlebo ne collect kiya hai par abhi tak office/lab ko hand over (settle) nahi kiya */
async function getCashSummary(phleboId) {
  const jobs = await Job.find({
    paymentCollectedBy: phleboId,
    paymentCollectedMethod: { $regex: /^cash$/i },
    paymentStatus: "Paid",
    cashSettled: false,
  })
    .select(
      "patientName externalOrderId clientName clientSlug totalAmount paymentCollectedAt paymentCollectedMethod"
    )
    .sort({ paymentCollectedAt: -1 });

  const pendingAmount = jobs.reduce((sum, j) => sum + (j.totalAmount || 0), 0);
  return { pendingAmount, pendingCount: jobs.length, jobs };
}

const maskName = (name = "") => {
  const parts = String(name).trim().split(/\s+/);
  return parts
    .map((p, i) => (i === 0 ? p : p.charAt(0) + "***"))
    .join(" ");
};

const maskPhone = (phone = "") => {
  const s = String(phone);
  if (s.length < 4) return "****";
  return s.slice(0, 2) + "******" + s.slice(-2);
};

const getPhleboToken = (req) => {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim();
  return "";
};

const verifyPhlebo = async (req, res, next) => {
  try {
    const token = getPhleboToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: "Login required" });
    }
    const decoded = jwt.verify(token, getJwtSecret());
    if (decoded.role !== "phlebo") {
      return res.status(403).json({ success: false, message: "Phlebo access only" });
    }
    const phlebo = await Phlebotomist.findById(decoded.id);
    if (!phlebo || phlebo.status !== "active") {
      return res.status(401).json({ success: false, message: "Account inactive" });
    }
    req.phlebo = phlebo;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

const clearCancellation = (order) => {
  order.cancelledBy = "";
  order.cancelledByName = "";
  order.cancelledAt = null;
  order.cancelReason = "";
};

const setPhleboCancellation = (order, phleboName, reason) => {
  order.status = "Cancelled";
  order.cancelledBy = "phlebo";
  order.cancelledByName = String(phleboName || "Phlebo").trim();
  order.cancelledAt = new Date();
  order.cancelReason = String(reason || "").trim();
  order.rejectedReason = order.cancelReason;
};

const setAdminCancellation = (order, adminName, reason) => {
  const who = String(adminName || "Admin").trim();
  const why = String(reason || "").trim();
  order.status = "Cancelled";
  order.cancelledBy = "admin";
  order.cancelledByName = who;
  order.cancelledAt = new Date();
  order.cancelReason = why;
  order.rejectedReason = `Permanently cancelled by ${who}: ${why}`;
};

const formatJob = (order, { mask = false } = {}) => {
  const o = typeof order.toObject === "function" ? order.toObject() : { ...order };
  return {
    id: o._id,
    orderId: o._id,
    jobId: o._id,
    pickupId: o.pickupId || null,
    externalOrderId: o.externalOrderId,
    clientId: o.clientId,
    clientSlug: o.clientSlug || "",
    clientName: o.clientName || "",
    patientName: mask ? maskName(o.patientName) : o.patientName,
    mobileNumber: mask ? maskPhone(o.mobileNumber) : o.mobileNumber,
    gender: o.gender,
    address: o.address,
    city: o.city,
    area: o.area,
    pincode: o.pincode,
    lat: typeof o.lat === "number" ? o.lat : null,
    lng: typeof o.lng === "number" ? o.lng : null,
    slotDate: o.slotDate,
    slotTime: o.slotTime,
    items: o.items || [],
    amount: o.totalAmount,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    status: o.status,
    phleboStatus: o.phleboStatus || "Unassigned",
    specialInstructions: o.specialInstructions || "",
    trfBarcode: o.trfBarcode || "",
    trfPhotoUrls: (() => {
      const urls = absoluteMediaUrls(
        coalescePhotoUrls(o.trfPhotoUrl, o.trfPhotoUrls)
      );
      return urls;
    })(),
    trfPhotoUrl: (() => {
      const urls = absoluteMediaUrls(
        coalescePhotoUrls(o.trfPhotoUrl, o.trfPhotoUrls)
      );
      return urls[0] || "";
    })(),
    collectionPhotoUrls: (() => {
      const urls = absoluteMediaUrls(
        coalescePhotoUrls(o.collectionPhotoUrl, o.collectionPhotoUrls)
      );
      return urls;
    })(),
    collectionPhotoUrl: (() => {
      const urls = absoluteMediaUrls(
        coalescePhotoUrls(o.collectionPhotoUrl, o.collectionPhotoUrls)
      );
      return urls[0] || "";
    })(),
    samples: (o.samples || []).map((s) => {
      const photoUrls = absoluteMediaUrls(
        coalescePhotoUrls(s.photoUrl, s.photoUrls)
      );
      return {
        ...s,
        photoUrl: photoUrls[0] || "",
        photoUrls,
        hasPhoto: photoUrls.length > 0,
      };
    }),
    consent: o.consent || {},
    handover: (() => {
      const h = o.handover || {};
      const bagPhotoUrls = absoluteMediaUrls(
        coalescePhotoUrls(h.bagPhotoUrl, h.bagPhotoUrls)
      );
      return {
        ...h,
        bagPhotoUrl: bagPhotoUrls[0] || "",
        bagPhotoUrls,
      };
    })(),
    assignedPhleboName: o.assignedPhleboName,
    assignedAt: o.assignedAt,
    arrivedAt: o.arrivedAt,
    travelDistanceKm: o.travelDistanceKm ?? null,
    arrivedDistanceFromAddressM: o.arrivedDistanceFromAddressM ?? null,
    arrivedWithinGeofence: o.arrivedWithinGeofence ?? null,
    collectedAt: o.collectedAt,
    createdAt: o.createdAt,
    paymentCollectedAt: o.paymentCollectedAt,
    paymentCollectedMethod: o.paymentCollectedMethod,
    rating: o.rating && o.rating.stars ? o.rating : null,
    rescheduleRequested: !!o.rescheduleRequested,
    isRedraw: !!o.isRedraw,
    redrawReason: o.redrawReason || "",
    hasRedraw: !!o.hasRedraw,
  };
};

// ─── Ops: list jobs (Phlebo own DB; multi-website via clientId) ──────────────

router.get("/admin/orders", verifyToken, attachScope, async (req, res) => {
  try {
    const { status, phleboStatus, clientId, clientSlug, from, to, limit = 20, page = 1 } = req.query;
    // City-wise Admin ko sirf apne city ke orders, Lab ko sirf apne assign kiye orders —
    // superadmin ke liye ye {} rehta hai (sab dikhta hai). Route/authMiddleware.js dekho.
    const filter = { ...req.scopeFilter };
    if (clientId) filter.clientId = clientId;
    if (clientSlug) filter.clientSlug = String(clientSlug).toLowerCase().trim();
    if (status && status !== "All") {
      if (status === "Booked") {
        filter.status = { $in: ["Booked", "Pending", "Confirmed"] };
      } else {
        filter.status = status;
      }
    }
    if (phleboStatus && phleboStatus !== "All") {
      if (phleboStatus === "NeedsAssign") {
        filter.$or = [
          { phleboStatus: { $in: ["Unassigned", null] } },
          { assignedPhlebo: null },
          { assignedPhlebo: { $exists: false } },
        ];
      } else {
        filter.phleboStatus = phleboStatus;
      }
    }
    if (from || to) {
      const createdAt = {};
      if (from && !isNaN(new Date(from))) createdAt.$gte = new Date(new Date(from).setHours(0, 0, 0, 0));
      if (to && !isNaN(new Date(to))) createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
      if (Object.keys(createdAt).length) filter.createdAt = createdAt;
    }
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const pageNum = Math.max(1, Number(page) || 1);
    const skip = (pageNum - 1) * limitNum;
    const [total, orders] = await Promise.all([
      Job.countDocuments(filter),
      Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limitNum));
    res.json({
      success: true,
      orders,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Free-city-traffic assumption for the "tight schedule" travel-time estimate below —
// deliberately conservative (slow) so we warn early rather than late. Not meant to be
// precise ETA (that's buildRoutePlan's job with live pings) — just a same-day heads-up
// that two back-to-back slots for one phlebo might not be physically reachable.
const TIGHT_SCHEDULE_AVG_SPEED_KMH = 20;
const TIGHT_SCHEDULE_BUFFER_MIN = 10;

// "HH:MM" (24hr, from the <input type="time"> the app/admin-web use) → minutes since
// midnight. Returns null for anything that doesn't match (e.g. free-text slot labels
// from some partner website) — those simply get skipped for the travel-warning calc.
function parseTimeToMinutes(slotTime) {
  const m = String(slotTime || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Collections tracking screen — ek din (live/past/future, ?date=YYYY-MM-DD) ke andar
 *  har phlebo ka har slot busy hai, partially-booked hai, ya khaali, ek hi nazar mein.
 *  City Admin apne city ke phlebos + jobs dekhta hai, superadmin sab. Grid khud
 *  client-side banta hai (phlebos x distinct slotTimes us din ke) — yahan raw data +
 *  computed flags bhejte hain: "at capacity" (maxDailyJobs cap), "on leave" (planned
 *  unavailability), aur "tight schedule" (do consecutive slots ke beech itna time nahi
 *  ki phlebo waqt pe pahunch sake). Read-only — assignment yahan se nahi, Orders page
 *  se hoti hai. */
router.get(
  "/admin/collections",
  verifyToken,
  requireRole("superadmin", "admin"),
  attachScope,
  async (req, res) => {
    try {
      const date = String(req.query.date || ymd(new Date())).trim();
      const cityFilter = req.user.role === "admin" ? { city: req.user.city } : {};

      const [phlebos, jobDocs, leaves] = await Promise.all([
        Phlebotomist.find(cityFilter).sort({ name: 1 }).select("-passwordHash -otp"),
        Job.find({ ...req.scopeFilter, slotDate: date })
          .select(
            "pickupId patientName mobileNumber slotDate slotTime status phleboStatus " +
              "assignedPhlebo assignedPhleboName city isRedraw rescheduleRequested paymentStatus lat lng"
          )
          .sort({ slotTime: 1 })
          .lean(),
        // City-scoped leave lookup — sirf un phlebos ki leave chahiye jo already
        // upar wale cityFilter mein aa chuke hain, lekin PhleboLeave khud city store
        // nahi karta, isliye phlebo-id list se hi filter karna aasaan hai (niche).
        PhleboLeave.find({ fromDate: { $lte: date }, toDate: { $gte: date } }).select(
          "phlebo reason"
        ),
      ]);
      const jobs = jobDocs; // .lean() → plain objects, safe to mutate below

      const phleboIds = new Set(phlebos.map((p) => String(p._id)));
      const leaveByPhlebo = {};
      leaves.forEach((l) => {
        if (phleboIds.has(String(l.phlebo))) leaveByPhlebo[String(l.phlebo)] = l.reason || "";
      });

      // Har phlebo ka us din ka job count — maxDailyJobs cap ke against "at capacity"
      // nikalne ke liye (slot khaali ho sakta hai phir bhi din bhar ka cap hit ho chuka ho).
      const countByPhlebo = {};
      jobs.forEach((j) => {
        if (j.assignedPhlebo) {
          const key = String(j.assignedPhlebo);
          countByPhlebo[key] = (countByPhlebo[key] || 0) + 1;
        }
      });

      const phleboRows = phlebos.map((p) => ({
        _id: p._id,
        name: p.name,
        phone: p.phone,
        zone: p.zone,
        city: p.city,
        dutyStatus: p.dutyStatus,
        maxDailyJobs: p.maxDailyJobs,
        slotCapacity: p.slotCapacity || 1,
        jobsToday: countByPhlebo[String(p._id)] || 0,
        atCapacity: (countByPhlebo[String(p._id)] || 0) >= (p.maxDailyJobs || 15),
        onLeave: Object.prototype.hasOwnProperty.call(leaveByPhlebo, String(p._id)),
        leaveReason: leaveByPhlebo[String(p._id)] || "",
      }));

      // Tight-schedule check — per phlebo, sort their own jobs chronologically (only
      // those with a parseable HH:MM slotTime + geocoded coords) and flag consecutive
      // pairs where estimated travel time eats into (or exceeds) the gap between slots.
      const jobsByPhlebo = {};
      jobs.forEach((j) => {
        if (!j.assignedPhlebo) return;
        const key = String(j.assignedPhlebo);
        (jobsByPhlebo[key] = jobsByPhlebo[key] || []).push(j);
      });
      Object.values(jobsByPhlebo).forEach((list) => {
        const timed = list
          .map((j) => ({ job: j, mins: parseTimeToMinutes(j.slotTime) }))
          .filter((x) => x.mins !== null)
          .sort((a, b) => a.mins - b.mins);
        for (let i = 0; i < timed.length - 1; i++) {
          const cur = timed[i];
          const next = timed[i + 1];
          const gapMin = next.mins - cur.mins;
          if (gapMin <= 0) continue; // same slot — capacity concern, not a travel one
          if (
            typeof cur.job.lat !== "number" ||
            typeof cur.job.lng !== "number" ||
            typeof next.job.lat !== "number" ||
            typeof next.job.lng !== "number"
          ) {
            continue; // geocoding missing — can't estimate, skip rather than guess
          }
          const distanceKm = haversineKm(cur.job.lat, cur.job.lng, next.job.lat, next.job.lng);
          const estTravelMin = Math.round((distanceKm / TIGHT_SCHEDULE_AVG_SPEED_KMH) * 60);
          if (estTravelMin + TIGHT_SCHEDULE_BUFFER_MIN > gapMin) {
            const note = `~${distanceKm.toFixed(1)}km / ~${estTravelMin}min travel, only ${gapMin}min gap`;
            cur.job.tightSchedule = true;
            cur.job.tightScheduleNote = note;
            next.job.tightSchedule = true;
            next.job.tightScheduleNote = note;
          }
        }
      });

      // Distinct slot times jo actually is din use ho rahe hain — chronological sort
      // (free-text ho sakta hai jaise "10:00 AM", isliye simple string sort kaafi hai
      // jab tak consistent format use ho raha ho).
      const slots = [...new Set(jobs.map((j) => j.slotTime).filter(Boolean))].sort();

      res.json({
        success: true,
        date,
        slots,
        phlebos: phleboRows,
        jobs,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

/** Ops: phone/walk-in booking manually create karna (partner website ke bina) */
router.post("/admin/orders", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.clientId) {
      return res.status(400).json({ success: false, message: "Website/client select karna zaroori hai" });
    }
    if (!b.patientName || !b.address || !b.slotDate || !b.slotTime) {
      return res.status(400).json({
        success: false,
        message: "patientName, address, slotDate, slotTime required",
      });
    }
    // City Admin apne hi city ke naam se order bana sakta hai — kisi doosre city ka nahi.
    if (req.user.role === "admin" && b.city && String(b.city).trim() !== req.user.city) {
      return res.status(403).json({ success: false, message: "Aap sirf apne city ke liye order bana sakte hain" });
    }
    if (req.user.role === "admin") b.city = req.user.city;

    const client = await Client.findById(b.clientId);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });

    const externalOrderId = String(b.externalOrderId || "").trim() || `CALL-${Date.now()}`;

    const items = Array.isArray(b.items)
      ? b.items.map((i) => ({
          productId: i.productId || "",
          name: i.name || "",
          category: i.category || "",
          price: Number(i.price) || 0,
          quantity: Math.max(1, Number(i.quantity) || 1),
        }))
      : [];
    const itemsTotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const amount = itemsTotal || Number(b.amount) || 0;
    const hasCoords = typeof b.lat === "number" && typeof b.lng === "number";
    const [pickupId, trackingToken] = await Promise.all([
      generatePickupId(),
      generateTrackingToken(),
    ]);

    const job = await Job.create({
      clientId: client._id,
      clientSlug: client.slug,
      clientName: client.name,
      externalOrderId,
      pickupId,
      trackingToken,
      items,
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
      amount,
      totalAmount: amount,
      status: "Booked",
      paymentMethod: b.paymentMethod || "COD",
      paymentStatus: "Unpaid",
      specialInstructions: b.specialInstructions || "",
      phleboStatus: "Unassigned",
      adminNote: "Manually created by Ops (phone/walk-in booking)",
    });

    // Auto-assign ke liye coords ke bina bhi try karna hai (agar hasCoords true hai to
    // geocode skip ho jaata hai, warna pehle geocode karega) — isliye hasCoords check
    // ke bina hi background job trigger karo.
    autoAssignInBackground(job);

    res.status(201).json({ success: true, message: "Order created", job });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Duplicate order ID — try again" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Ops: client ka test catalog dekho (manual order/test add karte waqt) */
router.get("/admin/catalog", verifyToken, async (req, res) => {
  try {
    const { clientId, city, search } = req.query;
    if (!clientId) {
      return res.status(400).json({ success: false, message: "clientId required" });
    }
    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });

    const { tests, catalogScope, total } = await fetchTestCatalog(client, { city, search });
    res.json({ success: true, tests, total, catalogScope });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Ops: existing order mein manually ek extra test add karna (customer ne phone pe manga) */
router.post("/admin/orders/:id/tests", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const order = await Job.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (req.user.role === "admin" && order.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye order aapke city ka nahi hai" });
    }

    const client = await Client.findById(order.clientId);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });

    const { productId, quantity = 1, name, price, category } = req.body || {};
    let catalogItem;
    if (productId) {
      catalogItem = await fetchTestById(client, String(productId), order.city);
    } else if (name && price !== undefined) {
      catalogItem = {
        productId: `manual-${Date.now()}`,
        name: String(name).trim(),
        price: Number(price) || 0,
        category: category || "Custom",
      };
    } else {
      return res.status(400).json({ success: false, message: "productId ya (name + price) chahiye" });
    }

    const qty = Math.max(1, Number(quantity) || 1);
    const prevTotal = order.totalAmount || 0;
    const wasPaid = order.paymentStatus === "Paid";

    order.items = order.items || [];
    const existing = order.items.find(
      (i) => String(i.productId) === String(catalogItem.productId)
    );

    if (existing) {
      existing.quantity = (existing.quantity || 1) + qty;
      existing.price = catalogItem.price;
      existing.name = catalogItem.name;
      existing.addedByPhlebo = true;
      existing.addedBySource = "admin";
      existing.addedAt = new Date();
    } else {
      order.items.push({
        productId: catalogItem.productId,
        name: catalogItem.name,
        category: catalogItem.category,
        price: catalogItem.price,
        quantity: qty,
        addedByPhlebo: true,
        addedBySource: "admin",
        addedAt: new Date(),
      });
    }

    recalcJobTotals(order);
    if (wasPaid && order.totalAmount > prevTotal) {
      order.paymentStatus = "Unpaid";
      order.paymentCollectedAt = null;
      order.paymentCollectedMethod = "";
      order.paymentCollectedBy = null;
    }

    const note = `Test added by Ops: ${catalogItem.name}`;
    order.adminNote = order.adminNote ? `${order.adminNote} | ${note}` : note;

    await saveAndNotify(order);
    res.json({ success: true, message: `${catalogItem.name} add ho gaya`, job: order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/admin/clients", verifyToken, async (_req, res) => {
  try {
    const clients = await Client.find().sort({ name: 1 }).select("-webhookSecret");
    res.json({ success: true, clients });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Phlebo ne visit ke dauran jo extra tests customer ko add kiye — sab yahan flatten hoke aate hain */
router.get("/admin/added-tests", verifyToken, attachScope, async (req, res) => {
  try {
    const { clientSlug, phleboId, from, to, limit = 200 } = req.query;
    const filter = { "items.addedByPhlebo": true, ...req.scopeFilter };
    if (clientSlug) filter.clientSlug = String(clientSlug).toLowerCase().trim();
    if (phleboId) filter.assignedPhlebo = phleboId;

    const fromT = from && !isNaN(new Date(from)) ? new Date(from).setHours(0, 0, 0, 0) : null;
    const toT = to && !isNaN(new Date(to)) ? new Date(to).setHours(23, 59, 59, 999) : null;

    const limitNum = Math.min(500, Math.max(1, Number(limit) || 200));
    const jobs = await Job.find(filter)
      .select(
        "patientName clientName clientSlug assignedPhleboName assignedPhlebo phleboStatus items createdAt"
      )
      .sort({ updatedAt: -1 })
      .limit(limitNum);

    const rows = [];
    for (const job of jobs) {
      for (const item of job.items || []) {
        if (!item.addedByPhlebo) continue;
        if (fromT !== null || toT !== null) {
          const addedT = item.addedAt ? new Date(item.addedAt).getTime() : null;
          if (addedT === null) continue;
          if (fromT !== null && addedT < fromT) continue;
          if (toT !== null && addedT > toT) continue;
        }
        rows.push({
          orderId: job._id,
          patientName: job.patientName,
          clientName: job.clientName,
          clientSlug: job.clientSlug,
          phleboName: job.assignedPhleboName,
          phleboId: job.assignedPhlebo,
          phleboStatus: job.phleboStatus,
          testName: item.name,
          category: item.category,
          price: item.price,
          quantity: item.quantity,
          addedAt: item.addedAt,
          addedBySource: item.addedBySource || "phlebo",
        });
      }
    }
    rows.sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));

    res.json({
      success: true,
      rows,
      total: rows.length,
      totalValue: rows.reduce((s, r) => s + (r.price || 0) * (r.quantity || 1), 0),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Admin: create / list phlebos ───────────────────────────────────────────

router.post("/admin/phlebos", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const {
      name,
      phone,
      employeeId,
      zone,
      city,
      password,
      servesAllClients,
      clientIds,
      slotCapacity,
    } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: "Name and phone required" });
    }
    // City Admin sirf apne city ka phlebo bana sakta hai.
    if (req.user.role === "admin" && city && String(city).trim() !== req.user.city) {
      return res.status(403).json({ success: false, message: "Aap sirf apne city ke liye phlebo bana sakte hain" });
    }
    const resolvedCity = req.user.role === "admin" ? req.user.city : city || "";
    const exists = await Phlebotomist.findOne({ phone: String(phone).trim() });
    if (exists) {
      return res.status(400).json({ success: false, message: "Phone already registered" });
    }
    const passwordHash = password ? await bcrypt.hash(String(password), 10) : "";
    const phlebo = await Phlebotomist.create({
      name: String(name).trim(),
      phone: String(phone).trim(),
      employeeId: employeeId || `PHL-${Date.now().toString().slice(-6)}`,
      zone: zone || "",
      city: resolvedCity,
      passwordHash,
      servesAllClients: servesAllClients !== false,
      clientIds: Array.isArray(clientIds) ? clientIds : [],
      slotCapacity: Number.isFinite(Number(slotCapacity)) && Number(slotCapacity) > 0
        ? Number(slotCapacity)
        : 1,
    });
    res.status(201).json({ success: true, phlebo });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/admin/phlebos", verifyToken, requireRole("superadmin", "admin"), async (req, res) => {
  try {
    const cityFilter = req.user.role === "admin" ? { city: req.user.city } : {};
    const phlebos = await Phlebotomist.find(cityFilter).sort({ name: 1 }).select("-passwordHash -otp");

    const cashAgg = await Job.aggregate([
      {
        $match: {
          paymentCollectedBy: { $ne: null },
          paymentCollectedMethod: { $regex: /^cash$/i },
          paymentStatus: "Paid",
          cashSettled: false,
        },
      },
      { $group: { _id: "$paymentCollectedBy", pendingAmount: { $sum: "$totalAmount" }, pendingCount: { $sum: 1 } } },
    ]);
    const cashMap = {};
    cashAgg.forEach((c) => {
      cashMap[String(c._id)] = { pendingAmount: c.pendingAmount, pendingCount: c.pendingCount };
    });

    // Har phlebo ke liye: kitni orders complete ho chuki hain, kitni abhi pending/
    // in-progress hain, aur kaun-kaun si lab(s) ke order unke paas assigned hain
    // (Team/Phlebos table mein "kis phlebo ko kis lab ka kaam h" dikhane ke liye).
    const phleboIds = phlebos.map((p) => p._id);
    const jobAgg = await Job.aggregate([
      { $match: { assignedPhlebo: { $in: phleboIds } } },
      {
        $group: {
          _id: "$assignedPhlebo",
          completed: {
            $sum: {
              $cond: [{ $in: ["$phleboStatus", ["Sample Collected", "Handed Off"]] }, 1, 0],
            },
          },
          pending: {
            $sum: {
              $cond: [
                { $not: [{ $in: ["$phleboStatus", ["Sample Collected", "Handed Off", "Rejected"]] }] },
                1,
                0,
              ],
            },
          },
          labs: { $addToSet: "$assignedLabName" },
        },
      },
    ]);
    const jobMap = {};
    jobAgg.forEach((j) => {
      jobMap[String(j._id)] = {
        completed: j.completed,
        pending: j.pending,
        labs: (j.labs || []).filter((l) => l && l.trim()),
      };
    });

    const withCash = phlebos.map((p) => {
      const o = p.toObject();
      const cash = cashMap[String(p._id)] || { pendingAmount: 0, pendingCount: 0 };
      o.cashPending = cash.pendingAmount;
      o.cashPendingCount = cash.pendingCount;
      const jobStats = jobMap[String(p._id)] || { completed: 0, pending: 0, labs: [] };
      o.completedJobs = jobStats.completed;
      o.pendingJobs = jobStats.pending;
      o.labs = jobStats.labs;
      return o;
    });

    res.json({ success: true, phlebos: withCash });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Cash reconciliation (phlebo collects cash → hands over at lab/office) ──

router.get("/admin/phlebos/:id/cash", verifyToken, requireRole("superadmin", "admin"), async (req, res) => {
  try {
    const phlebo = await Phlebotomist.findById(req.params.id).select("-passwordHash -otp");
    if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });
    if (req.user.role === "admin" && phlebo.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
    }
    const summary = await getCashSummary(phlebo._id);
    res.json({ success: true, phlebo, ...summary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Ops-only incentive breakdown for a phlebo on a given day (default today) —
 * intentionally NOT exposed on the phlebo's own dashboard (see GET /phlebo/job-stats
 * comment: job counts only, no ₹ figure shown to the phlebo by design).
 */
router.get(
  "/admin/phlebos/:id/incentive",
  verifyToken,
  requireRole("superadmin", "admin"),
  async (req, res) => {
    try {
      const phlebo = await Phlebotomist.findById(req.params.id);
      if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });
      if (req.user.role === "admin" && phlebo.city !== req.user.city) {
        return res.status(403).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
      }

      const date = req.query.date || ymd(new Date());
      const DONE_STATUSES = ["Sample Collected", "Handed Off"];
      const completed = await Job.find({
        assignedPhlebo: phlebo._id,
        phleboStatus: { $in: DONE_STATUSES },
        collectedAt: { $ne: null },
      }).select("collectedAt");
      const jobsDone = completed.filter((j) => ymd(new Date(j.collectedAt)) === date).length;

      const incentive = computeIncentive(phlebo, jobsDone);
      res.json({ success: true, date, ...incentive });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.post("/admin/phlebos/:id/cash/settle", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const phlebo = await Phlebotomist.findById(req.params.id);
    if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });
    if (req.user.role === "admin" && phlebo.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
    }

    const { jobIds } = req.body || {};
    const filter = {
      paymentCollectedBy: phlebo._id,
      paymentCollectedMethod: { $regex: /^cash$/i },
      paymentStatus: "Paid",
      cashSettled: false,
    };
    if (Array.isArray(jobIds) && jobIds.length) {
      filter._id = { $in: jobIds };
    }

    const before = await Job.find(filter).select("totalAmount");
    const settledAmount = before.reduce((s, j) => s + (j.totalAmount || 0), 0);

    const result = await Job.updateMany(filter, {
      $set: { cashSettled: true, cashSettledAt: new Date(), cashSettledBy: req.user._id },
    });

    res.json({
      success: true,
      message: `₹${settledAmount} cash settled (${result.modifiedCount} order${result.modifiedCount === 1 ? "" : "s"})`,
      settledAmount,
      settledCount: result.modifiedCount,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/admin/orders/:id/assign-phlebo", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const { phleboId } = req.body;
    const order = await Job.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (req.user.role === "admin" && order.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye order aapke city ka nahi hai" });
    }

    // Cancelled / Rejected orders bhi dubara assign ho sakte hain (reschedule case).
    if (order.status === "Cancelled") {
      order.status = "Booked";
      clearCancellation(order);
      order.rescheduleRequested = false;
      order.rescheduleRequestedAt = null;
      order.rescheduleRequestNote = "";
      order.adminNote = order.adminNote
        ? `${order.adminNote} | Reopened from Cancelled (by ${req.user.name || req.user.email})`
        : `Reopened from Cancelled (by ${req.user.name || req.user.email})`;
    }

    if (!phleboId) {
      order.assignedPhlebo = null;
      order.assignedPhleboName = "";
      order.phleboStatus = "Unassigned";
      order.assignedAt = null;
      order.assignedBy = "";
      await saveAndNotify(order);
      return res.json({ success: true, message: "Phlebo unassigned", order });
    }

    const phlebo = await Phlebotomist.findById(phleboId);
    if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });

    if (req.user.role === "admin" && phlebo.city !== req.user.city) {
      return res.status(400).json({
        success: false,
        message: "Ye phlebo aapke city ka nahi hai",
      });
    }

    if (!phlebo.canServeClient(order.clientId)) {
      return res.status(400).json({
        success: false,
        message: "This phlebotomist is not allowed for this website/client",
      });
    }

    order.assignedPhlebo = phlebo._id;
    order.assignedPhleboName = phlebo.name;
    order.phleboStatus = "Assigned";
    order.assignedAt = new Date();
    order.assignedBy = "manual"; // Ops dashboard se — auto-assign ka override
    order.rejectedReason = "";
    await saveAndNotify(order);
    sendPushToPhlebo(
      phlebo,
      "New pickup assigned",
      `${order.patientName} — ${order.slotDate} ${order.slotTime}`,
      { jobId: String(order._id) }
    ).catch(() => {});

    res.json({ success: true, message: "Phlebotomist assigned", order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * City ke andar multiple labs ho sakti hain — ye endpoint ek order/sample ko
 * ek specific lab ko assign karta hai (Admin/Superadmin hi assign kar sakte hain).
 * Lab login ke baad GET /admin/orders (assignedLab scope se) sirf apne assign
 * kiye orders dekh payegi.
 */
router.put("/admin/orders/:id/assign-lab", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const { labId } = req.body;
    const order = await Job.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (req.user.role === "admin" && order.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye order aapke city ka nahi hai" });
    }

    if (!labId) {
      order.assignedLab = null;
      order.assignedLabName = "";
      await order.save();
      return res.json({ success: true, message: "Lab unassigned", order });
    }

    const lab = await OpsUser.findOne({ _id: labId, role: "lab" });
    if (!lab) return res.status(404).json({ success: false, message: "Lab not found" });
    if (lab.city !== order.city) {
      return res.status(400).json({
        success: false,
        message: "Ye lab is order ke city ki nahi hai",
      });
    }

    order.assignedLab = lab._id;
    order.assignedLabName = lab.name;
    await order.save();

    res.json({ success: true, message: "Lab assigned", order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * City Admin ek order ko kisi aur date/time pe reschedule kar sakta hai — chahe to
 * usi call mein ek phlebo bhi (re-)assign kar de. Agar phleboId nahi diya, purani
 * assignment clear hoke job wapas "Unassigned" ho jaati hai aur naye slot ke liye
 * turant auto-assign try hota hai (jaisa naye order pe hota hai).
 * Already-collected/handed-off orders reschedule nahi ho sakte — wo complete ho chuke hain.
 */
router.put("/admin/orders/:id/reschedule", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const { slotDate, slotTime, phleboId } = req.body || {};
    if (!slotDate || !slotTime) {
      return res.status(400).json({ success: false, message: "Naya slotDate aur slotTime required hain" });
    }

    const order = await Job.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (req.user.role === "admin" && order.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye order aapke city ka nahi hai" });
    }

    const LOCKED_STATUSES = ["Sample Collected", "Handed Off"];
    if (LOCKED_STATUSES.includes(order.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message: "Ye order pehle se complete ho chuka hai — reschedule nahi ho sakta",
      });
    }

    const prevDate = order.slotDate;
    const prevTime = order.slotTime;
    order.slotDate = String(slotDate).trim();
    order.slotTime = String(slotTime).trim();

    const note = `Rescheduled: ${prevDate} ${prevTime} → ${order.slotDate} ${order.slotTime} (by ${req.user.name || req.user.email})`;
    order.adminNote = order.adminNote ? `${order.adminNote} | ${note}` : note;
    order.rescheduleRequested = false;
    order.rescheduleRequestedAt = null;
    order.rescheduleRequestNote = "";
    if (order.status === "Cancelled") {
      order.status = "Booked";
      clearCancellation(order);
    }

    if (phleboId) {
      const phlebo = await Phlebotomist.findById(phleboId);
      if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });
      if (req.user.role === "admin" && phlebo.city !== req.user.city) {
        return res.status(400).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
      }
      if (!phlebo.canServeClient(order.clientId)) {
        return res.status(400).json({
          success: false,
          message: "This phlebotomist is not allowed for this website/client",
        });
      }
      order.assignedPhlebo = phlebo._id;
      order.assignedPhleboName = phlebo.name;
      order.phleboStatus = "Assigned";
      order.assignedAt = new Date();
      order.assignedBy = "manual";
      order.rejectedReason = "";
      await saveAndNotify(order);
      sendPushToPhlebo(
        phlebo,
        "Pickup rescheduled to you",
        `${order.patientName} — ${order.slotDate} ${order.slotTime}`,
        { jobId: String(order._id) }
      ).catch(() => {});
      return res.json({ success: true, message: "Order rescheduled aur phlebo assign ho gaya", order });
    }

    // Koi phlebo nahi diya — purani assignment clear karke naye slot ke liye fresh
    // try karo (manual ho ya auto-assign, dono available rahenge).
    order.assignedPhlebo = null;
    order.assignedPhleboName = "";
    order.phleboStatus = "Unassigned";
    order.assignedAt = null;
    order.assignedBy = "";
    order.rejectedReason = "";
    await saveAndNotify(order);
    autoAssignInBackground(order);

    res.json({ success: true, message: "Order reschedule ho gaya — naye slot ke liye auto-assign try ho raha hai", order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Lab TAT tracking — sample lab ko handover ho jaane ke baad, Admin yahan se "report
 *  ready" mark karta hai (report Lab ne bahar bhej di / upload kar di). Sirf tabhi
 *  allowed hai jab sample already handed off ho chuka ho. */
router.put("/admin/orders/:id/report-ready", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const order = await Job.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (req.user.role === "admin" && order.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye order aapke city ka nahi hai" });
    }
    if (!order.handover?.completed || !order.handover?.handedOverAt) {
      return res.status(400).json({
        success: false,
        message: "Sample abhi lab ko handover hi nahi hua hai",
      });
    }
    if (order.reportReadyAt) {
      return res.status(400).json({ success: false, message: "Report already ready mark ho chuki hai" });
    }
    order.reportReadyAt = new Date();
    await order.save();
    res.json({ success: true, message: "Report ready mark ho gayi", order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Lab ne ek sample reject kar diya (haemolyzed / insufficient quantity / etc) —
 * sample ko flag karta hai aur (default) ek naya "redraw" job bana deta hai taaki
 * dobara collection ke liye kisi phlebo ko assign ho sake. Redraw job amount ₹0 rakha
 * jaata hai — patient already original order pe pay kar chuka hai, dobara bill nahi hota.
 */
router.put(
  "/admin/orders/:id/samples/:barcode/reject",
  verifyToken,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { reason, createRedraw = true, slotDate, slotTime } = req.body || {};
      const order = await Job.findById(req.params.id);
      if (!order) return res.status(404).json({ success: false, message: "Order not found" });
      if (req.user.role === "admin" && order.city !== req.user.city) {
        return res.status(403).json({ success: false, message: "Ye order aapke city ka nahi hai" });
      }

      const sample = (order.samples || []).find((s) => s.barcode === req.params.barcode);
      if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });

      sample.rejected = true;
      sample.rejectionReason = String(reason || "").trim() || "Lab rejected sample";
      sample.rejectedAt = new Date();

      const note = `Sample ${sample.barcode} rejected by lab: ${sample.rejectionReason}`;
      order.adminNote = order.adminNote ? `${order.adminNote} | ${note}` : note;

      let redrawJob = null;
      if (createRedraw !== false) {
        const [pickupId, trackingToken] = await Promise.all([
          generatePickupId(),
          generateTrackingToken(),
        ]);
        redrawJob = await Job.create({
          clientId: order.clientId,
          clientSlug: order.clientSlug,
          clientName: order.clientName,
          externalOrderId: `${order.externalOrderId}-RD${Date.now().toString().slice(-5)}`,
          pickupId,
          trackingToken,
          items: [],
          patientName: order.patientName,
          gender: order.gender,
          mobileNumber: order.mobileNumber,
          address: order.address,
          state: order.state,
          city: order.city,
          area: order.area,
          pincode: order.pincode,
          lat: order.lat,
          lng: order.lng,
          geocodedAt: order.lat != null ? new Date() : null,
          slotDate: String(slotDate || order.slotDate).trim(),
          slotTime: String(slotTime || "ASAP").trim(),
          amount: 0,
          totalAmount: 0,
          status: "Booked",
          paymentMethod: order.paymentMethod,
          // Original order pe already paid — redraw dobara bill nahi karta.
          paymentStatus: "Paid",
          phleboStatus: "Unassigned",
          isRedraw: true,
          redrawOf: order._id,
          redrawReason: sample.rejectionReason,
          specialInstructions: `Redraw for rejected sample ${sample.barcode}`,
          adminNote: `Redraw created from order ${order.pickupId || order._id}`,
        });
        order.hasRedraw = true;
        autoAssignInBackground(redrawJob);
      }

      await order.save();
      res.json({
        success: true,
        message: `Sample rejected${redrawJob ? " — redraw job created" : ""}`,
        order,
        redrawJob,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// ─── Phlebo auth ────────────────────────────────────────────────────────────

router.post("/phlebo/auth/otp/send", async (req, res) => {
  try {
    const phone = String(req.body.phone || "").trim();
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, message: "Valid 10-digit phone required" });
    }

    // Self-registration jaanbujh kar band hai — sirf wahi number login kar sakta
    // hai jise City Admin ne "Phlebotomists" page se pehle add kiya ho. Isse
    // random/test numbers apne aap phlebo bankar duplicate records nahi banate.
    const phlebo = await Phlebotomist.findOne({ phone });
    if (!phlebo) {
      return res.status(404).json({
        success: false,
        message: "This number is not registered. Contact your city admin to get added first.",
      });
    }
    if (phlebo.status !== "active") {
      return res.status(403).json({ success: false, message: "Account inactive — contact your admin" });
    }

    const otp =
      allowDemoOtp()
        ? DEMO_OTP
        : crypto.randomInt(100000, 999999).toString();

    phlebo.otp = otp;
    phlebo.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await phlebo.save();

    console.log(`[Phlebo OTP] ${phone} => ${otp}`);

    res.json({
      success: true,
      message: "OTP sent",
      demoOtp: allowDemoOtp() ? otp : undefined,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/auth/otp/verify", async (req, res) => {
  try {
    const phone = String(req.body.phone || "").trim();
    const otp = String(req.body.otp || "").trim();

    const phlebo = await Phlebotomist.findOne({ phone });
    if (!phlebo) {
      return res.status(404).json({ success: false, message: "Phlebotomist not found" });
    }

    const valid =
      (phlebo.otp && phlebo.otp === otp && phlebo.otpExpires && phlebo.otpExpires > new Date()) ||
      isDemoOtp(otp);

    if (!valid) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    phlebo.otp = null;
    phlebo.otpExpires = null;
    await phlebo.save();

    const token = jwt.sign(
      { id: phlebo._id, role: "phlebo", phone: phlebo.phone },
      getJwtSecret(),
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      token,
      phlebo: {
        id: phlebo._id,
        name: phlebo.name,
        phone: phlebo.phone,
        employeeId: phlebo.employeeId,
        dutyStatus: phlebo.dutyStatus,
        zone: phlebo.zone,
        city: phlebo.city,
        rating: phlebo.rating,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/phlebo/me", verifyPhlebo, async (req, res) => {
  const p = req.phlebo;
  res.json({
    success: true,
    phlebo: {
      id: p._id,
      name: p.name,
      phone: p.phone,
      employeeId: p.employeeId,
      dutyStatus: p.dutyStatus,
      zone: p.zone,
      city: p.city,
      rating: p.rating,
      dailyTarget: p.dailyTarget,
      currentLat: p.currentLat,
      currentLng: p.currentLng,
      todayDistanceKm: p.todayDistanceKm || 0,
    },
  });
});

/**
 * Job-count + incentive-target dashboard — kisi bhi din ke liye (?date=YYYY-MM-DD,
 * default aaj). Sirf jobs ka count dikhata hai, ₹ earnings NAHI — phlebo ko revenue
 * figure dikhana intentionally avoid kiya gaya hai. Count Job.collectedAt se seedha
 * compute hota hai (koi separate daily-counter store nahi hota, isliye purane din
 * bhi query ho sakte hain, "reset" wala bug bhi nahi hota).
 */
router.get("/phlebo/job-stats", verifyPhlebo, async (req, res) => {
  try {
    const date = req.query.date || ymd(new Date());
    const isToday = date === ymd(new Date());
    const DONE_STATUSES = ["Sample Collected", "Handed Off"];

    const completed = await Job.find({
      assignedPhlebo: req.phlebo._id,
      phleboStatus: { $in: DONE_STATUSES },
      collectedAt: { $ne: null },
    }).select("collectedAt");

    const jobsDone = completed.filter((j) => ymd(new Date(j.collectedAt)) === date).length;

    // Cash-in-hand pending settlement ek "abhi ka" running balance hai, kisi ek din se
    // bandha nahi — isliye selected date se independent, hamesha current dikhta hai.
    const cash = await getCashSummary(req.phlebo._id);
    const target = req.phlebo.dailyTarget || 0;
    const progressPct = target > 0 ? Math.min(100, Math.round((jobsDone / target) * 100)) : 0;

    res.json({
      success: true,
      date,
      isToday,
      jobsCompleted: jobsDone,
      dailyTarget: target,
      progressPct,
      targetReached: target > 0 && jobsDone >= target,
      cashPending: cash.pendingAmount,
      cashPendingCount: cash.pendingCount,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/phlebo/duty-status", verifyPhlebo, async (req, res) => {
  try {
    const { dutyStatus } = req.body;
    if (!["on_duty", "off_duty"].includes(dutyStatus)) {
      return res.status(400).json({ success: false, message: "Invalid duty status" });
    }
    req.phlebo.dutyStatus = dutyStatus;
    if (dutyStatus === "off_duty") {
      req.phlebo.lastOffDutyAt = new Date();
    }
    await req.phlebo.save();

    // Phlebo abhi on-duty hua — jo jobs pehle kisi eligible phlebo na milne se
    // "Unassigned" reh gayi thi, unhe dobara try karo (background, response block
    // kiye bina — is phlebo ko turant response chahiye, assignment thoda baad mein
    // reflect ho jaana kaafi hai).
    if (dutyStatus === "on_duty") {
      setImmediate(() => {
        tryAutoAssignPendingJobs().catch(() => {});
      });
    }

    // Off-duty pe phlebo ko uska pending cash yaad dilao (lab/office jama karne ke liye)
    const cash = await getCashSummary(req.phlebo._id);

    res.json({
      success: true,
      dutyStatus: req.phlebo.dutyStatus,
      cashPending: cash.pendingAmount,
      cashPendingCount: cash.pendingCount,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/location", verifyPhlebo, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ success: false, message: "lat/lng required" });
    }

    // Kms tracker: consecutive-ping haversine delta jodkar "aaj kitna travel kiya"
    // nikaalte hain — koi alag ping-history collection store nahi karte, sirf ek
    // running total (naya din shuru hote hi 0 se reset). Ek hi ping-interval (~25s)
    // mein bahut bada jump (GPS glitch/teleport) total mein add nahi hota.
    const todayKey = ymd(new Date());
    const sameDay = req.phlebo.todayDistanceDateKey === todayKey;
    if (
      sameDay &&
      typeof req.phlebo.currentLat === "number" &&
      typeof req.phlebo.currentLng === "number"
    ) {
      const deltaKm = haversineKm(req.phlebo.currentLat, req.phlebo.currentLng, lat, lng);
      if (deltaKm <= MAX_REALISTIC_PING_KM) {
        req.phlebo.todayDistanceKm =
          Math.round(((req.phlebo.todayDistanceKm || 0) + deltaKm) * 100) / 100;
      }
    } else if (!sameDay) {
      req.phlebo.todayDistanceKm = 0;
    }
    req.phlebo.todayDistanceDateKey = todayKey;

    req.phlebo.currentLat = lat;
    req.phlebo.currentLng = lng;
    req.phlebo.lastLocationAt = new Date();
    await req.phlebo.save();
    res.json({ success: true, todayDistanceKm: req.phlebo.todayDistanceKm });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Expo push token save — naya job assign/auto-assign hote hi notification ke liye. */
router.post("/phlebo/push-token", verifyPhlebo, async (req, res) => {
  try {
    req.phlebo.pushToken = String(req.body?.token || "").trim();
    await req.phlebo.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Attendance (shift check-in/out) ───────────────────────────────────────

router.post("/phlebo/attendance/check-in", verifyPhlebo, async (req, res) => {
  try {
    const { lat, lng } = req.body || {};
    const dateKey = ymd(new Date());
    const open = await Attendance.findOne({
      phlebo: req.phlebo._id,
      dateKey,
      checkOutAt: null,
    });
    if (open) {
      return res.json({ success: true, message: "Already checked in", attendance: open });
    }
    const attendance = await Attendance.create({
      phlebo: req.phlebo._id,
      phleboName: req.phlebo.name,
      city: req.phlebo.city,
      dateKey,
      checkInAt: new Date(),
      checkInLat: typeof lat === "number" ? lat : null,
      checkInLng: typeof lng === "number" ? lng : null,
    });
    res.status(201).json({ success: true, attendance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/attendance/check-out", verifyPhlebo, async (req, res) => {
  try {
    const { lat, lng } = req.body || {};
    const dateKey = ymd(new Date());
    const attendance = await Attendance.findOne({
      phlebo: req.phlebo._id,
      dateKey,
      checkOutAt: null,
    }).sort({ checkInAt: -1 });
    if (!attendance) {
      return res.status(400).json({ success: false, message: "Please check in first" });
    }
    attendance.checkOutAt = new Date();
    attendance.checkOutLat = typeof lat === "number" ? lat : null;
    attendance.checkOutLng = typeof lng === "number" ? lng : null;
    await attendance.save();
    res.json({ success: true, attendance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/phlebo/attendance/today", verifyPhlebo, async (req, res) => {
  try {
    const dateKey = ymd(new Date());
    const attendance = await Attendance.findOne({ phlebo: req.phlebo._id, dateKey }).sort({
      checkInAt: -1,
    });
    res.json({ success: true, attendance: attendance || null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Ops: kisi din ke saare attendance records (city-scoped for city Admin). */
router.get(
  "/admin/attendance",
  verifyToken,
  requireRole("superadmin", "admin"),
  async (req, res) => {
    try {
      const { date, phleboId } = req.query;
      const dateKey = date || ymd(new Date());
      const filter = { dateKey };
      if (phleboId) filter.phlebo = phleboId;
      if (req.user.role === "admin") filter.city = req.user.city;
      const records = await Attendance.find(filter).sort({ checkInAt: -1 });
      res.json({ success: true, date: dateKey, records });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// ─── Jobs ───────────────────────────────────────────────────────────────────

router.get("/phlebo/jobs", verifyPhlebo, async (req, res) => {
  try {
    // Koi ?date= na bheja gaya ho (app ka "All Dates" mode) to date filter hi mat lagao —
    // saari non-rejected jobs return karo. Pehle yahan `|| ymd(new Date())` default tha,
    // jisse "All Dates" button bhi silently sirf AAJ ka data deta tha — app mein future/
    // past slot wali jobs kabhi dikhti hi nahi thi chahe koi bhi date-filter select karo.
    const date = req.query.date || "";
    const DONE_STATUSES = ["Sample Collected", "Handed Off"];

    // Rejected jobs wapas pool mein chale jaate hain (is phlebo se hat gaye).
    // Handed Off (fully completed) ko yahan se exclude NAHI karte — warna handover
    // ke baad wo job "Done" count aur list dono se gayab ho jaata tha.
    const allOrders = await Job.find({
      assignedPhlebo: req.phlebo._id,
      phleboStatus: { $ne: "Rejected" },
    }).sort({ slotDate: 1, slotTime: 1 });

    // Exact calendar-day match (parse each job's slotDate the same way, then compare
    // normalized YYYY-MM-DD). Pehle ye loose string-includes se match hota tha (e.g.
    // "date.slice(0,4)" = saal, jo same-year ke har job se match ho jaata tha) — isliye
    // "Today" dabane pe saal bhar ke jobs dikh jaate the. Ab sirf usi din ke jobs milenge.
    let orders = allOrders;
    if (date) {
      const todays = allOrders.filter((o) => {
        const parsed = parseSlotDate(o.slotDate);
        return parsed ? ymd(parsed) === date : String(o.slotDate) === date;
      });
      orders = todays;
    }

    const jobs = orders.map((o) =>
      formatJob(o, { mask: !UNMASKED_STATUSES.includes(o.phleboStatus) })
    );

    const summary = {
      total: jobs.length,
      pending: jobs.filter((j) => j.phleboStatus === "Assigned").length,
      active: jobs.filter((j) =>
        ["Accepted", "En Route", "Arrived", "OTP Verified", "Consent Done"].includes(j.phleboStatus)
      ).length,
      done: jobs.filter((j) => DONE_STATUSES.includes(j.phleboStatus)).length,
    };

    // Calendar strip (jobs by assigned date) + lifetime totals — poore assignment history se
    const dateCounts = {};
    const dateDoneCounts = {};
    let totalSamples = 0;
    for (const o of allOrders) {
      const d = o.slotDate;
      dateCounts[d] = (dateCounts[d] || 0) + 1;
      if (DONE_STATUSES.includes(o.phleboStatus)) {
        dateDoneCounts[d] = (dateDoneCounts[d] || 0) + 1;
      }
      totalSamples += (o.samples || []).length;
    }
    const dates = Object.keys(dateCounts).sort();

    const lifetime = {
      totalJobs: allOrders.length,
      totalDone: allOrders.filter((o) => DONE_STATUSES.includes(o.phleboStatus)).length,
      totalSamples,
    };

    res.json({
      success: true,
      jobs,
      summary,
      dutyStatus: req.phlebo.dutyStatus,
      dates,
      dateCounts,
      dateDoneCounts,
      lifetime,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Shared nearest-neighbor route-plan builder — used by both the phlebo app's own
 *  "/phlebo/jobs/route-plan" (self view) and the Admin/Ops "route optimization"
 *  view (GET /admin/phlebos/:id/route-plan), so the exact same greedy TSP heuristic
 *  and distance/ETA math is used in both places. @param phleboDoc a Phlebotomist doc
 *  (needs currentLat/currentLng). @param date "YYYY-MM-DD". @param opts.maskPatient —
 *  phlebo app hides patient name/number until job accepted (default true); Admin's
 *  own view never masks (admin already sees full order details everywhere else). */
async function buildRoutePlan(phleboDoc, date, opts = {}) {
  const maskPatient = opts.maskPatient !== false;
  const TERMINAL = ["Sample Collected", "Handed Off", "Rejected"];

  // Aaj (ya query date) ke liye phlebo ke saare non-terminal jobs — inhi ko visit
  // karna baaki hai, isliye route plan mein shamil honge.
  const allOrders = await Job.find({
    assignedPhlebo: phleboDoc._id,
    phleboStatus: { $nin: TERMINAL },
  });

  const todays = allOrders.filter((o) => {
    const parsed = parseSlotDate(o.slotDate);
    return parsed ? ymd(parsed) === date : String(o.slotDate) === date;
  });

  // Jinka address geocode ho chuka hai wahi distance-order mein shamil ho sakte hain;
  // baaki "unlocated" mein alag se dikhte hain taaki route plan se miss hue jobs
  // pata chal jayein (address ajeeb tha ya geocoding fail ho gayi).
  const pool = todays.filter((o) => typeof o.lat === "number" && typeof o.lng === "number");
  const unlocated = todays.filter(
    (o) => !(typeof o.lat === "number" && typeof o.lng === "number")
  );

  const AVG_SPEED_KMPH = 20; // city/traffic-adjusted default — zone ke hisaab se tune karna

  const usingPhleboLocation =
    typeof phleboDoc.currentLat === "number" && typeof phleboDoc.currentLng === "number";

  let current = usingPhleboLocation
    ? { lat: phleboDoc.currentLat, lng: phleboDoc.currentLng }
    : null;

  // Phlebo ki koi live location ping nahi hui hai — nearest-neighbor start karne ke
  // liye ek reference point chahiye, isliye slot-time se sabse pehli job se shuru.
  if (!current && pool.length) {
    const bySlot = [...pool].sort((a, b) =>
      String(a.slotTime).localeCompare(String(b.slotTime))
    );
    current = { lat: bySlot[0].lat, lng: bySlot[0].lng };
  }

  const startedFrom = current
    ? { lat: current.lat, lng: current.lng, source: usingPhleboLocation ? "phlebo_location" : "first_job" }
    : null;

  // Greedy nearest-neighbor: har step pe current position se sabse nazdeeki baaki job
  // choose karo. Simple TSP heuristic hai, exact optimal nahi — lekin din-bhar ke
  // 5-15 stops ke liye kaafi accha result deta hai aur instant compute hota hai.
  const route = [];
  let cumulativeKm = 0;
  while (pool.length) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const d = haversineKm(current.lat, current.lng, pool[i].lat, pool[i].lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    const next = pool.splice(nearestIdx, 1)[0];
    cumulativeKm += nearestDist;
    route.push({
      order: route.length + 1,
      job: formatJob(next, { mask: maskPatient && !UNMASKED_STATUSES.includes(next.phleboStatus) }),
      distanceFromPrevKm: Math.round(nearestDist * 100) / 100,
      etaMinFromPrev: Math.round((nearestDist / AVG_SPEED_KMPH) * 60),
      cumulativeKm: Math.round(cumulativeKm * 100) / 100,
    });
    current = { lat: next.lat, lng: next.lng };
  }

  return {
    date,
    startedFrom,
    route,
    unlocated: unlocated.map((o) =>
      formatJob(o, { mask: maskPatient && !UNMASKED_STATUSES.includes(o.phleboStatus) })
    ),
    totalStops: route.length,
    totalDistanceKm: Math.round(cumulativeKm * 100) / 100,
    totalEtaMin: Math.round((cumulativeKm / AVG_SPEED_KMPH) * 60),
  };
}

// NOTE: is route ko "/phlebo/jobs/:id" se PEHLE define karna zaroori hai — warna Express
// "route-plan" ko :id param samajh ke wahi handler match kar dega.
router.get("/phlebo/jobs/route-plan", verifyPhlebo, async (req, res) => {
  try {
    const date = req.query.date || ymd(new Date());
    const plan = await buildRoutePlan(req.phlebo, date);
    res.json({ success: true, ...plan });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/phlebo/jobs/:id", verifyPhlebo, async (req, res) => {
  try {
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    const mask = order.phleboStatus === "Assigned";
    res.json({ success: true, job: formatJob(order, { mask }) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Saare tests dropdown ke liye (partner website catalog se) */
router.get("/phlebo/jobs/:id/tests/catalog", verifyPhlebo, async (req, res) => {
  try {
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    const client = await Client.findById(order.clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    const { tests, catalogScope, total } = await fetchTestCatalog(client, {
      city: order.city,
      search: req.query.search || "",
    });

    res.json({
      success: true,
      tests,
      total,
      city: order.city || "",
      catalogScope,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Customer ne extra test maanga — job + Wello order mein add */
router.post("/phlebo/jobs/:id/tests", verifyPhlebo, async (req, res) => {
  try {
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    if (!ADD_TEST_STATUSES.includes(order.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message: "Tests can only be added during the visit (Arrived → Consent Done)",
      });
    }

    const { productId, quantity = 1 } = req.body;
    if (!productId) {
      return res.status(400).json({ success: false, message: "productId required" });
    }

    const client = await Client.findById(order.clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    const catalogItem = await fetchTestById(client, String(productId), order.city);
    const qty = Math.max(1, Number(quantity) || 1);
    const prevTotal = order.totalAmount || 0;
    const wasPaid = order.paymentStatus === "Paid";

    order.items = order.items || [];
    const existing = order.items.find(
      (i) => String(i.productId) === String(catalogItem.productId)
    );

    if (existing) {
      existing.quantity = (existing.quantity || 1) + qty;
      existing.price = catalogItem.price;
      existing.name = catalogItem.name;
      existing.addedByPhlebo = true;
      existing.addedAt = new Date();
    } else {
      order.items.push({
        productId: catalogItem.productId,
        name: catalogItem.name,
        category: catalogItem.category,
        price: catalogItem.price,
        quantity: qty,
        addedByPhlebo: true,
        addedAt: new Date(),
      });
    }

    recalcJobTotals(order);

    if (wasPaid && order.totalAmount > prevTotal) {
      order.paymentStatus = "Unpaid";
      order.paymentCollectedAt = null;
      order.paymentCollectedMethod = "";
      order.paymentCollectedBy = null;
    }

    const note = `Test added by phlebo: ${catalogItem.name}`;
    order.adminNote = order.adminNote ? `${order.adminNote} | ${note}` : note;

    await saveAndNotify(order);
    res.json({
      success: true,
      message: `${catalogItem.name} added`,
      job: formatJob(order),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Phlebo-added extra test hatao (original booking items lock rehte hain).
 *  POST body preferred (mobile/proxies pe DELETE kabhi miss ho jata hai). */
async function removePhleboAddedTest(req, res) {
  try {
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    if (!ADD_TEST_STATUSES.includes(order.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message: "Tests can only be removed during the visit (Arrived → Consent Done)",
      });
    }

    const productId = String(
      req.body?.productId || req.params.productId || ""
    ).trim();
    if (!productId) {
      return res.status(400).json({ success: false, message: "productId required" });
    }

    const idx = (order.items || []).findIndex(
      (i) => String(i.productId) === productId && i.addedByPhlebo
    );
    if (idx < 0) {
      return res.status(400).json({
        success: false,
        message: "Only tests added during the visit can be removed",
      });
    }

    const removed = order.items[idx];
    order.items.splice(idx, 1);
    order.markModified("items");
    recalcJobTotals(order);

    const note = `Test removed by phlebo: ${removed.name || productId}`;
    order.adminNote = order.adminNote ? `${order.adminNote} | ${note}` : note;

    await saveAndNotify(order);
    res.json({
      success: true,
      message: `${removed.name || "Test"} removed`,
      job: formatJob(order),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

router.post("/phlebo/jobs/:id/tests/remove", verifyPhlebo, removePhleboAddedTest);
router.delete("/phlebo/jobs/:id/tests/:productId", verifyPhlebo, removePhleboAddedTest);

/**
 * Phlebo is already at a patient's address and another person at the same
 * location wants a test. Creates a new Job pre-assigned to the same phlebo,
 * same slot, same address/coords — phlebo never has to call the ops desk.
 *
 * Required body: patientName, mobileNumber, items ([{productId, name, price, quantity}])
 * Optional body: gender, specialInstructions, paymentMethod
 * Allowed statuses: Arrived → Sample Collected (phlebo is physically present)
 */
/** Phlebo ne jo walk-in patients add kiye hain unki list (dashboard ke liye) */
router.get("/phlebo/walkin-jobs", verifyPhlebo, async (req, res) => {
  try {
    const jobs = await Job.find({
      assignedPhlebo: req.phlebo._id,
      walkInSourceJobId: { $ne: null },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("patientName mobileNumber phleboStatus slotDate slotTime totalAmount items pickupId walkInSourceJobId createdAt");
    res.json({ success: true, jobs: jobs.map((j) => formatJob(j)) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/add-patient", verifyPhlebo, async (req, res) => {
  try {
    const sourceJob = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!sourceJob) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    const ALLOWED = ["Arrived", "OTP Verified", "Consent Done", "Sample Collected"];
    if (!ALLOWED.includes(sourceJob.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message: "You must be at the address (Arrived status or later) to add another patient",
      });
    }

    const { patientName, mobileNumber, items = [], gender, specialInstructions, paymentMethod } =
      req.body || {};

    if (!patientName || !String(patientName).trim()) {
      return res.status(400).json({ success: false, message: "patientName is required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "At least one test item is required" });
    }

    const cleanItems = items.map((i) => ({
      productId: i.productId || "",
      name: String(i.name || "").trim(),
      category: i.category || "",
      price: Number(i.price) || 0,
      quantity: Math.max(1, Number(i.quantity) || 1),
      addedByPhlebo: true,
      addedAt: new Date(),
    }));

    const amount = cleanItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const [pickupId, trackingToken] = await Promise.all([
      generatePickupId(),
      generateTrackingToken(),
    ]);

    const newJob = await Job.create({
      // inherit from source job
      clientId: sourceJob.clientId,
      clientSlug: sourceJob.clientSlug,
      clientName: sourceJob.clientName,
      city: sourceJob.city,
      area: sourceJob.area,
      pincode: sourceJob.pincode,
      address: sourceJob.address,
      lat: sourceJob.lat,
      lng: sourceJob.lng,
      slotDate: sourceJob.slotDate,
      slotTime: sourceJob.slotTime,
      // new patient details
      externalOrderId: `WALKIN-${Date.now()}`,
      pickupId,
      trackingToken,
      patientName: String(patientName).trim(),
      mobileNumber: String(mobileNumber || "").trim(),
      gender: gender || "",
      specialInstructions: specialInstructions || "",
      items: cleanItems,
      amount,
      totalAmount: amount,
      paymentMethod: paymentMethod || sourceJob.paymentMethod || "COD",
      paymentStatus: "Unpaid",
      status: "Booked",
      // pre-assign to the same phlebo
      phleboStatus: "Accepted",
      assignedPhlebo: req.phlebo._id,
      assignedPhleboName: req.phlebo.name,
      assignedBy: "phlebo-walkin",
      acceptedAt: new Date(),
      adminNote: `Walk-in patient added by phlebo ${req.phlebo.name} at address of job #${sourceJob.pickupId}`,
      walkInSourceJobId: sourceJob._id,
    });

    // Push notification to admin (non-fatal)
    sendPushToPhlebo(req.phlebo._id, {
      title: "Walk-in patient added",
      body: `${String(patientName).trim()} — admin notified`,
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: `New job created for ${String(patientName).trim()}`,
      job: formatJob(newJob),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Duplicate ID — please try again" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/accept", verifyPhlebo, async (req, res) => {
  try {
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });
    if (order.phleboStatus !== "Assigned") {
      return res
        .status(400)
        .json({ success: false, message: `Cannot accept from status ${order.phleboStatus}` });
    }
    order.phleboStatus = "Accepted";
    order.acceptedAt = new Date();
    await saveAndNotify(order);
    res.json({ success: true, job: formatJob(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/reject", verifyPhlebo, async (req, res) => {
  try {
    const reason = String(req.body.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: "Rejection reason required" });
    }
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    order.phleboStatus = "Rejected";
    order.rejectedReason = reason;
    order.assignedPhlebo = null;
    order.assignedPhleboName = "";
    order.assignedBy = "";
    await saveAndNotify(order);
    res.json({ success: true, message: "Job rejected — returned to pool" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Customer-side visit abort after phlebo has reached the location (Arrived / OTP Verified).
 * Sets status=Cancelled with cancelledBy=phlebo; Admin can reopen via Assign / Reschedule.
 */
router.post("/phlebo/jobs/:id/customer-cancel", verifyPhlebo, async (req, res) => {
  try {
    const remark = String(req.body.remark || req.body.reason || "").trim();
    if (!remark) {
      return res.status(400).json({ success: false, message: "Cancel remark required" });
    }
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    const allowed = ["Arrived", "OTP Verified"];
    if (!allowed.includes(order.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message: `Customer cancel only allowed after arrival (current: ${order.phleboStatus})`,
      });
    }

    if (order.status === "Cancelled") {
      return res.status(400).json({ success: false, message: "Order already cancelled" });
    }

    const wantsReschedule =
      req.body.wantsReschedule === true ||
      /reschedule/i.test(remark);

    const reportedBy = req.phlebo.name || "phlebo";
    const reason = wantsReschedule
      ? `Customer asked to reschedule (by ${reportedBy}): ${remark}`
      : `Customer refused visit (by ${reportedBy}): ${remark}`;

    setPhleboCancellation(order, reportedBy, remark);
    order.adminNote = order.adminNote ? `${order.adminNote} | ${reason}` : reason;

    if (wantsReschedule) {
      order.rescheduleRequested = true;
      order.rescheduleRequestedAt = new Date();
      order.rescheduleRequestNote = remark.slice(0, 500);
    }

    // Return to Ops pool for reassign / reschedule; clear in-progress visit fields.
    order.assignedPhlebo = null;
    order.assignedPhleboName = "";
    order.assignedBy = "";
    order.assignedAt = null;
    order.phleboStatus = "Unassigned";
    order.acceptedAt = null;
    order.enRouteAt = null;
    order.enRouteLat = null;
    order.enRouteLng = null;
    order.arrivedAt = null;
    order.arrivedLat = null;
    order.arrivedLng = null;
    order.patientOtp = null;
    order.patientOtpExpires = null;
    order.otpVerifiedAt = null;
    order.otpAttempts = 0;

    await saveAndNotify(order);
    res.json({
      success: true,
      message: wantsReschedule
        ? "Order cancelled — Admin can reschedule and re-assign"
        : "Order cancelled — Admin can re-assign or permanently close",
      job: formatJob(order),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Permanent cancel — Admin / Superadmin only (cancelledBy=admin).
 */
router.put("/admin/orders/:id/cancel", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const reason = String(req.body.reason || req.body.remark || "").trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: "Cancel reason required" });
    }

    const order = await Job.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (req.user.role === "admin" && order.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye order aapke city ka nahi hai" });
    }

    if (["Sample Collected", "Handed Off"].includes(order.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message: "Sample already collected — permanent cancel nahi ho sakta",
      });
    }
    if (order.status === "Cancelled") {
      return res.status(400).json({ success: false, message: "Order pehle se cancelled hai" });
    }

    const adminName = req.user.name || req.user.email || "Admin";
    setAdminCancellation(order, adminName, reason);
    order.adminNote = order.adminNote
      ? `${order.adminNote} | ${order.rejectedReason}`
      : order.rejectedReason;
    order.rescheduleRequested = false;
    order.rescheduleRequestedAt = null;
    order.rescheduleRequestNote = "";
    order.assignedPhlebo = null;
    order.assignedPhleboName = "";
    order.assignedBy = "";
    order.assignedAt = null;
    order.phleboStatus = "Unassigned";
    await saveAndNotify(order);

    res.json({ success: true, message: "Order permanently cancelled", order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/en-route", verifyPhlebo, async (req, res) => {
  try {
    const { lat, lng } = req.body || {};
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });
    if (!["Accepted", "En Route"].includes(order.phleboStatus)) {
      return res.status(400).json({ success: false, message: "Accept job first" });
    }
    order.phleboStatus = "En Route";
    // Sirf pehli baar capture karo — arrival ke against travel-km isi start point se
    // naapa jaata hai (see /jobs/:id/arrival), baad ke re-sends ise overwrite na karein.
    if (!order.enRouteAt && typeof lat === "number" && typeof lng === "number") {
      order.enRouteAt = new Date();
      order.enRouteLat = lat;
      order.enRouteLng = lng;
    }
    await saveAndNotify(order);
    res.json({ success: true, job: formatJob(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/arrival", verifyPhlebo, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });
    if (!["Accepted", "En Route", "Arrived"].includes(order.phleboStatus)) {
      return res.status(400).json({ success: false, message: "Invalid status for arrival" });
    }
    order.phleboStatus = "Arrived";
    order.arrivedAt = new Date();
    order.arrivedLat = typeof lat === "number" ? lat : null;
    order.arrivedLng = typeof lng === "number" ? lng : null;

    // Geofence audit — geocoded address se kitni door pe arrival mark hui. Soft flag
    // only, kabhi arrival block nahi karta (geocoding apartment complex/wrong pin ki
    // wajah se legitimately thoda off ho sakti hai) — Ops ko visibility ke liye hai.
    if (
      typeof order.lat === "number" &&
      typeof order.lng === "number" &&
      typeof order.arrivedLat === "number" &&
      typeof order.arrivedLng === "number"
    ) {
      const distKm = haversineKm(order.lat, order.lng, order.arrivedLat, order.arrivedLng);
      order.arrivedDistanceFromAddressM = Math.round(distKm * 1000);
      order.arrivedWithinGeofence = order.arrivedDistanceFromAddressM <= GEOFENCE_RADIUS_M;
    }

    // Travel-km — "I'm on the way" se leke arrival tak ka as-the-crow-flies distance,
    // reimbursement/Kms tracker ke liye.
    if (
      typeof order.enRouteLat === "number" &&
      typeof order.enRouteLng === "number" &&
      typeof order.arrivedLat === "number" &&
      typeof order.arrivedLng === "number"
    ) {
      order.travelDistanceKm =
        Math.round(
          haversineKm(order.enRouteLat, order.enRouteLng, order.arrivedLat, order.arrivedLng) * 100
        ) / 100;
    }

    await saveAndNotify(order);
    res.json({ success: true, job: formatJob(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/otp/send", verifyPhlebo, async (req, res) => {
  try {
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });
    if (!["Arrived", "OTP Verified"].includes(order.phleboStatus)) {
      return res.status(400).json({ success: false, message: "Mark arrived first" });
    }

    const otp =
      allowDemoOtp()
        ? DEMO_OTP
        : crypto.randomInt(100000, 999999).toString();

    order.patientOtp = otp;
    order.patientOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await saveAndNotify(order);

    console.log(`[Patient OTP] order ${order._id} phone ${order.mobileNumber} => ${otp}`);

    res.json({
      success: true,
      message: "OTP sent to patient mobile",
      demoOtp: allowDemoOtp() ? otp : undefined,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/otp/verify", verifyPhlebo, async (req, res) => {
  try {
    const otp = String(req.body.otp || "").trim();
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });
    if (order.phleboStatus !== "Arrived") {
      return res.status(400).json({ success: false, message: "Arrive before OTP verify" });
    }

    order.otpAttempts = (order.otpAttempts || 0) + 1;
    const valid =
      (order.patientOtp && order.patientOtp === otp && order.patientOtpExpires > new Date()) ||
      isDemoOtp(otp);

    if (!valid) {
      await order.save();
      const escalate = order.otpAttempts >= 3;
      return res.status(400).json({
        success: false,
        message: "Wrong OTP",
        attempts: order.otpAttempts,
        escalate,
      });
    }

    order.phleboStatus = "OTP Verified";
    order.otpVerifiedAt = new Date();
    order.patientOtp = null;
    await saveAndNotify(order);
    res.json({ success: true, job: formatJob(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/consent", verifyPhlebo, async (req, res) => {
  try {
    const { signatureData, declined, lat, lng } = req.body;
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });
    if (order.phleboStatus !== "OTP Verified") {
      return res.status(400).json({ success: false, message: "Verify OTP first" });
    }

    if (declined) {
      order.consent = {
        signed: false,
        signatureData: "",
        consentedAt: new Date(),
        declined: true,
        consentLat: lat ?? null,
        consentLng: lng ?? null,
      };
      // Consent decline = phlebo-side cancel (status Cancelled, reopen via Admin).
      const reason = `Consent declined by patient`;
      setPhleboCancellation(order, req.phlebo.name || "phlebo", reason);
      order.adminNote = (order.adminNote || "") + " | Consent declined by patient";
      order.assignedPhlebo = null;
      order.assignedPhleboName = "";
      order.assignedBy = "";
      order.assignedAt = null;
      order.phleboStatus = "Unassigned";
      await saveAndNotify(order);
      return res.json({
        success: true,
        message: "Consent declined — order cancelled; Admin can re-assign",
        job: formatJob(order),
      });
    }

    if (!signatureData) {
      return res.status(400).json({ success: false, message: "Signature required" });
    }

    order.consent = {
      signed: true,
      signatureData: String(signatureData).slice(0, 500000),
      consentedAt: new Date(),
      declined: false,
      consentLat: typeof lat === "number" ? lat : null,
      consentLng: typeof lng === "number" ? lng : null,
    };
    order.phleboStatus = "Consent Done";
    await saveAndNotify(order);
    res.json({ success: true, job: formatJob(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/trf", verifyPhlebo, async (req, res) => {
  try {
    const code = String(req.body.barcode || req.body.trfBarcode || "").trim();
    if (!code) {
      return res.status(400).json({ success: false, message: "TRF barcode required" });
    }

    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });
    if (order.phleboStatus === "Handed Off") {
      return res.status(400).json({
        success: false,
        message: "Job is handed off — TRF cannot be changed",
      });
    }
    if (order.phleboStatus !== "Consent Done" && order.phleboStatus !== "Sample Collected") {
      return res.status(400).json({ success: false, message: "Complete consent first" });
    }

    // Tubes already scanned → do not change TRF (mismatch risk)
    if (order.trfBarcode && (order.samples || []).length > 0 && order.trfBarcode !== code) {
      return res.status(400).json({
        success: false,
        message: "TRF already set — tubes are scanned, TRF cannot be changed",
      });
    }

    order.trfBarcode = code;
    await order.save();
    res.json({ success: true, message: "TRF barcode saved", job: formatJob(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Clear TRF so phlebo can rescan. Also clears TRF photos, tubes, and collection photos. */
router.delete("/phlebo/jobs/:id/trf", verifyPhlebo, async (req, res) => {
  try {
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    if (order.phleboStatus !== "Consent Done") {
      return res.status(400).json({
        success: false,
        message: "TRF can only be removed before sample is marked collected",
      });
    }

    order.trfBarcode = "";
    order.trfPhotoUrl = "";
    order.trfPhotoUrls = [];
    order.samples = [];
    order.collectionPhotoUrl = "";
    order.collectionPhotoUrls = [];
    order.markModified("samples");
    order.markModified("trfPhotoUrls");
    order.markModified("collectionPhotoUrls");
    await order.save();

    res.json({
      success: true,
      message: "TRF removed — scan again",
      job: formatJob(order),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/barcode", verifyPhlebo, async (req, res) => {
  try {
    const { barcode, sampleType, lat, lng } = req.body;
    const code = String(barcode || "").trim();
    if (!code) {
      return res.status(400).json({ success: false, message: "Barcode required" });
    }

    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });
    if (order.phleboStatus === "Handed Off") {
      return res.status(400).json({
        success: false,
        message: "Job is handed off — tubes cannot be changed",
      });
    }
    if (order.phleboStatus !== "Consent Done" && order.phleboStatus !== "Sample Collected") {
      if (order.phleboStatus !== "Consent Done") {
        return res.status(400).json({ success: false, message: "Complete consent first" });
      }
    }

    const trf = String(order.trfBarcode || "").trim();
    if (!trf) {
      return res.status(400).json({
        success: false,
        message: "Scan the TRF barcode first",
      });
    }

    // Tube must contain TRF core (e.g. TRF 20273206 → E20273206 / S20273206 / F20273206P)
    const tubeU = code.toUpperCase();
    const trfU = trf.toUpperCase();
    if (!tubeU.includes(trfU)) {
      return res.status(400).json({
        success: false,
        message: `Tube barcode does not match TRF (TRF: ${trf})`,
      });
    }

    const dup = await Job.findOne({
      "samples.barcode": code,
      _id: { $ne: order._id },
    });
    if (dup) {
      return res.status(400).json({
        success: false,
        message: "Duplicate barcode — already used on another order",
      });
    }

    if ((order.samples || []).some((s) => s.barcode === code)) {
      return res.status(400).json({ success: false, message: "Barcode already scanned on this order" });
    }

    // Prefix se sample type hint (S/E/U/F…)
    let inferred = sampleType || "Blood";
    if (!sampleType) {
      const prefix = tubeU.replace(trfU, "").replace(/[^A-Z]/g, "").charAt(0);
      if (prefix === "U") inferred = "Urine";
      else if (prefix === "E") inferred = "EDTA";
      else if (prefix === "S") inferred = "Serum";
      else if (prefix === "F") inferred = "Fluoride";
    }

    order.samples = order.samples || [];
    order.samples.push({
      barcode: code,
      sampleType: inferred,
      scannedAt: new Date(),
      lat: typeof lat === "number" ? lat : null,
      lng: typeof lng === "number" ? lng : null,
      photoUrl: "",
      photoUrls: [],
      hasPhoto: false,
      photoTakenAt: null,
      coldChainOk: true,
    });
    order.markModified("samples");
    await order.save();
    res.json({ success: true, job: formatJob(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/photo", verifyPhlebo, async (req, res) => {
  try {
    const { photoUrl, photoUrls, barcode, sampleId, lat, lng, replace, kind } = req.body;
    const inputs = [];
    if (Array.isArray(photoUrls)) {
      for (const u of photoUrls) if (u) inputs.push(u);
    } else if (photoUrl) {
      inputs.push(photoUrl);
    }
    if (!inputs.length) {
      return res.status(400).json({
        success: false,
        message: "photoUrl or photoUrls required (base64 or URL)",
      });
    }

    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    if (order.phleboStatus === "Handed Off") {
      return res.status(400).json({
        success: false,
        message: "Job is handed off — photos cannot be changed",
      });
    }

    const scope = String(kind || "sample").toLowerCase();
    const savedPaths = inputs
      .map((u) => saveDataUrlImage(u, scope === "trf" ? "trf" : "samples"))
      .filter(Boolean);
    if (!savedPaths.length) {
      return res.status(400).json({ success: false, message: "Invalid photo data" });
    }

    if (scope === "trf") {
      if (!String(order.trfBarcode || "").trim()) {
        return res.status(400).json({ success: false, message: "Scan TRF barcode before photo" });
      }
      const existing = coalescePhotoUrls(order.trfPhotoUrl, order.trfPhotoUrls);
      order.trfPhotoUrls = replace === true ? savedPaths : [...existing, ...savedPaths];
      order.trfPhotoUrl = order.trfPhotoUrls[0] || "";
      await order.save();
      return res.json({ success: true, job: formatJob(order) });
    }

    if (scope === "collection") {
      if (!(order.samples || []).length) {
        return res.status(400).json({
          success: false,
          message: "Scan at least one tube barcode before tube photos",
        });
      }
      const existing = coalescePhotoUrls(order.collectionPhotoUrl, order.collectionPhotoUrls);
      order.collectionPhotoUrls =
        replace === true ? savedPaths : [...existing, ...savedPaths];
      order.collectionPhotoUrl = order.collectionPhotoUrls[0] || "";
      await order.save();
      return res.json({ success: true, job: formatJob(order) });
    }

    if (!order.samples?.length) {
      return res.status(400).json({ success: false, message: "Scan barcode before photo" });
    }

    let sample = null;
    if (sampleId) {
      sample = order.samples.id(sampleId) || order.samples.find((s) => String(s._id) === String(sampleId));
    }
    if (!sample && barcode) {
      sample = order.samples.find((s) => s.barcode === barcode);
    }
    if (!sample) {
      sample = order.samples[order.samples.length - 1];
    }

    if (!sample) {
      return res.status(400).json({ success: false, message: "Sample not found for barcode" });
    }

    const existing = coalescePhotoUrls(sample.photoUrl, sample.photoUrls);
    sample.photoUrls = replace === true ? savedPaths : [...existing, ...savedPaths];
    sample.photoUrl = sample.photoUrls[0] || "";
    sample.hasPhoto = sample.photoUrls.length > 0;
    sample.photoTakenAt = new Date();
    if (typeof lat === "number") sample.lat = lat;
    if (typeof lng === "number") sample.lng = lng;
    order.markModified("samples");
    await order.save();
    res.json({ success: true, job: formatJob(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Delete one job-level TRF/collection photo by index, or all if index omitted. */
router.delete("/phlebo/jobs/:id/photo", verifyPhlebo, async (req, res) => {
  try {
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    if (order.phleboStatus === "Handed Off") {
      return res.status(400).json({
        success: false,
        message: "Job is handed off — photos cannot be changed",
      });
    }

    const scope = String(req.query.kind || "").toLowerCase();
    if (scope !== "trf" && scope !== "collection") {
      return res.status(400).json({
        success: false,
        message: "kind=trf or kind=collection required",
      });
    }

    const urls =
      scope === "trf"
        ? coalescePhotoUrls(order.trfPhotoUrl, order.trfPhotoUrls)
        : coalescePhotoUrls(order.collectionPhotoUrl, order.collectionPhotoUrls);
    const indexRaw = req.query.index;
    let next = [];
    if (indexRaw === undefined || indexRaw === null || indexRaw === "") {
      next = [];
    } else {
      const idx = Number(indexRaw);
      if (!Number.isInteger(idx) || idx < 0 || idx >= urls.length) {
        return res.status(400).json({ success: false, message: "Invalid photo index" });
      }
      next = urls.filter((_, i) => i !== idx);
    }

    if (scope === "trf") {
      order.trfPhotoUrls = next;
      order.trfPhotoUrl = next[0] || "";
    } else {
      order.collectionPhotoUrls = next;
      order.collectionPhotoUrl = next[0] || "";
    }
    await order.save();
    res.json({ success: true, job: formatJob(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Delete one sample photo by index, or all photos if index omitted. */
router.delete("/phlebo/jobs/:id/samples/:sampleId/photo", verifyPhlebo, async (req, res) => {
  try {
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    if (order.phleboStatus === "Handed Off") {
      return res.status(400).json({
        success: false,
        message: "Job is handed off — photos cannot be changed",
      });
    }

    const sampleId = req.params.sampleId;
    const sample =
      order.samples.id(sampleId) ||
      order.samples.find((s) => String(s._id) === String(sampleId));
    if (!sample) {
      return res.status(404).json({ success: false, message: "Sample not found" });
    }

    const urls = coalescePhotoUrls(sample.photoUrl, sample.photoUrls);
    const indexRaw = req.query.index;
    if (indexRaw === undefined || indexRaw === null || indexRaw === "") {
      sample.photoUrls = [];
      sample.photoUrl = "";
      sample.hasPhoto = false;
      sample.photoTakenAt = null;
    } else {
      const idx = Number(indexRaw);
      if (!Number.isInteger(idx) || idx < 0 || idx >= urls.length) {
        return res.status(400).json({ success: false, message: "Invalid photo index" });
      }
      urls.splice(idx, 1);
      sample.photoUrls = urls;
      sample.photoUrl = urls[0] || "";
      sample.hasPhoto = urls.length > 0;
      if (!urls.length) sample.photoTakenAt = null;
    }

    order.markModified("samples");
    await order.save();
    res.json({ success: true, job: formatJob(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Scanned tube / sample hatao (collection se pehle) */
async function removeJobSample(req, res) {
  try {
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    if (order.phleboStatus === "Handed Off") {
      return res.status(400).json({
        success: false,
        message: "Tubes cannot be deleted after handover",
      });
    }

    const sampleId = String(req.params.sampleId || req.body?.sampleId || "").trim();
    if (!sampleId) {
      return res.status(400).json({ success: false, message: "sampleId required" });
    }

    const idx = (order.samples || []).findIndex((s) => String(s._id) === sampleId);
    if (idx < 0) {
      return res.status(404).json({ success: false, message: "Sample / tube not found" });
    }

    const removed = order.samples[idx];
    order.samples.splice(idx, 1);
    order.markModified("samples");
    await order.save();

    res.json({
      success: true,
      message: `Tube ${removed.barcode || ""} removed`,
      job: formatJob(order),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

router.post("/phlebo/jobs/:id/samples/remove", verifyPhlebo, removeJobSample);
router.delete("/phlebo/jobs/:id/samples/:sampleId", verifyPhlebo, removeJobSample);

router.put("/phlebo/jobs/:id/payment", verifyPhlebo, async (req, res) => {
  try {
    const method = String(req.body.method || "Cash").trim();
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    // Collect payment after sample is collected — not after handover (read-only)
    const allowed = ["Sample Collected"];
    if (!allowed.includes(order.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message:
          order.phleboStatus === "Handed Off"
            ? "Job is handed off — no further edits allowed"
            : "Mark sample collected before collecting payment",
      });
    }

    order.paymentStatus = "Paid";
    order.paymentCollectedAt = new Date();
    order.paymentCollectedMethod = method;
    order.paymentCollectedBy = req.phlebo._id;
    await saveAndNotify(order);
    res.json({ success: true, job: formatJob(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/phlebo/jobs/:id/complete", verifyPhlebo, async (req, res) => {
  try {
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });

    const trfPhotos = coalescePhotoUrls(order.trfPhotoUrl, order.trfPhotoUrls);
    const collectionPhotos = coalescePhotoUrls(
      order.collectionPhotoUrl,
      order.collectionPhotoUrls
    );
    const perTubePhotos =
      (order.samples || []).length > 0 &&
      (order.samples || []).every(
        (s) => coalescePhotoUrls(s.photoUrl, s.photoUrls).length > 0
      );
    const checklist = {
      otp: order.phleboStatus === "Consent Done" || order.otpVerifiedAt,
      consent: order.consent?.signed === true,
      trf: !!String(order.trfBarcode || "").trim(),
      trfPhoto: trfPhotos.length > 0,
      barcode: (order.samples || []).length > 0,
      photo: collectionPhotos.length > 0 || perTubePhotos,
    };

    if (order.phleboStatus !== "Consent Done") {
      return res.status(400).json({
        success: false,
        message: "Complete OTP → Consent → TRF → Barcode → Photo first",
        checklist,
      });
    }

    if (
      !checklist.consent ||
      !checklist.trf ||
      !checklist.trfPhoto ||
      !checklist.barcode ||
      !checklist.photo
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Checklist incomplete — TRF photo and at least one all-tubes photo are required",
        checklist,
      });
    }

    order.phleboStatus = "Sample Collected";
    order.status = "Sample Collected";
    order.collectedAt = new Date();
    await saveAndNotify(order);

    // Job-stats dashboard ke liye kuch alag se karne ki zaroorat nahi — GET
    // /phlebo/job-stats order.collectedAt se hi seedha compute karta hai.

    res.json({
      success: true,
      job: formatJob(order),
      message: "Sample collected — patient will be notified",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/jobs/:id/handover", verifyPhlebo, async (req, res) => {
  try {
    const { barcodes, lat, lng, note, bagPhotoUrl, bagPhotoUrls, bagTemperatureC } = req.body;
    const order = await Job.findOne({
      _id: req.params.id,
      assignedPhlebo: req.phlebo._id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Job not found" });
    if (order.phleboStatus !== "Sample Collected") {
      return res.status(400).json({ success: false, message: "Collect sample first" });
    }

    const due = Number(order.totalAmount || order.amount || 0);
    if (due > 0 && order.paymentStatus !== "Paid") {
      return res.status(400).json({
        success: false,
        message: "Collect payment before handover",
      });
    }

    const expected = (order.samples || []).map((s) => s.barcode);
    const scanned = Array.isArray(barcodes) ? barcodes.map(String) : expected;

    const bagInputs = [];
    if (Array.isArray(bagPhotoUrls)) {
      for (const u of bagPhotoUrls) if (u) bagInputs.push(u);
    } else if (bagPhotoUrl) {
      bagInputs.push(bagPhotoUrl);
    }
    const savedBagPhotos = bagInputs
      .map((u) => saveDataUrlImage(u, "bags"))
      .filter(Boolean);

    order.handover = {
      completed: true,
      barcodes: scanned,
      handedOverAt: new Date(),
      lat: typeof lat === "number" ? lat : null,
      lng: typeof lng === "number" ? lng : null,
      note: note || "",
      // Cold-chain bag evidence — multiple angles allowed; bagPhotoUrl = first.
      bagPhotoUrls: savedBagPhotos,
      bagPhotoUrl: savedBagPhotos[0] || "",
      bagTemperatureC: typeof bagTemperatureC === "number" ? bagTemperatureC : null,
    };
    order.phleboStatus = "Handed Off";
    order.status = "Processing";
    await saveAndNotify(order);

    res.json({
      success: true,
      job: formatJob(order),
      manifest: {
        orderId: order._id,
        barcodes: scanned,
        expected,
        handedOverAt: order.handover.handedOverAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/phlebo/sos", verifyPhlebo, async (req, res) => {
  try {
    const { lat, lng, jobId } = req.body;
    console.log("[SOS]", {
      phleboId: req.phlebo._id,
      name: req.phlebo.name,
      phone: req.phlebo.phone,
      lat,
      lng,
      jobId,
      at: new Date().toISOString(),
    });
    res.json({
      success: true,
      message: "SOS sent to Ops — help is on the way",
      sos: {
        phleboId: req.phlebo._id,
        lat,
        lng,
        jobId: jobId || null,
        triggeredAt: new Date(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Phlebo ka apna kit stock — jo kuch admin ne unhe assign kiya hai, wahi yahan dikhta hai */
router.get("/phlebo/inventory", verifyPhlebo, async (req, res) => {
  res.json({ success: true, items: req.phlebo.kitStock || [] });
});

router.post("/phlebo/inventory/request", verifyPhlebo, async (req, res) => {
  const { sku, quantity, note } = req.body;
  console.log("[Inventory Request]", {
    phlebo: req.phlebo._id,
    sku,
    quantity,
    note,
  });
  res.json({ success: true, message: "Replenishment request sent to Ops" });
});

// ─── Kit inventory (admin catalog + assign to phlebo) ──────────────────────

router.get("/admin/inventory", verifyToken, requireRole("superadmin", "admin"), async (_req, res) => {
  try {
    const items = await InventoryItem.find().sort({ name: 1 });
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/admin/inventory", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const { sku, name, unit, centralStock, reorderThreshold } = req.body || {};
    if (!sku || !name) {
      return res.status(400).json({ success: false, message: "SKU and name required" });
    }
    const cleanSku = String(sku).trim().toUpperCase();
    const exists = await InventoryItem.findOne({ sku: cleanSku });
    if (exists) {
      return res.status(400).json({ success: false, message: "SKU already exists" });
    }
    const item = await InventoryItem.create({
      sku: cleanSku,
      name: String(name).trim(),
      unit: unit || "pcs",
      centralStock: Number(centralStock) || 0,
      reorderThreshold: Number(reorderThreshold) || 10,
    });
    res.status(201).json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/admin/inventory/:id", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const { name, unit, centralStock, reorderThreshold } = req.body || {};
    const item = await InventoryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });

    if (name !== undefined) item.name = String(name).trim();
    if (unit !== undefined) item.unit = String(unit).trim();
    if (centralStock !== undefined) item.centralStock = Math.max(0, Number(centralStock) || 0);
    if (reorderThreshold !== undefined) item.reorderThreshold = Math.max(0, Number(reorderThreshold) || 0);
    await item.save();
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/admin/kits", verifyToken, requireRole("superadmin", "admin"), async (req, res) => {
  try {
    const { phleboId, limit = 100 } = req.query;
    const filter = {};
    if (phleboId) filter.phlebo = phleboId;
    const limitNum = Math.min(300, Math.max(1, Number(limit) || 100));
    const assignments = await KitAssignment.find(filter).sort({ createdAt: -1 }).limit(limitNum);
    res.json({ success: true, assignments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/admin/kits/assign", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const { phleboId, items, note } = req.body || {};
    if (!phleboId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: "phleboId aur kam se kam 1 item required" });
    }

    const phlebo = await Phlebotomist.findById(phleboId);
    if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });
    if (req.user.role === "admin" && phlebo.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
    }

    const cleanItems = [];
    for (const it of items) {
      const qty = Math.floor(Number(it.quantity) || 0);
      if (!it.sku || qty <= 0) continue;

      const stockItem = await InventoryItem.findOne({ sku: String(it.sku).toUpperCase() });
      if (!stockItem) {
        return res.status(400).json({ success: false, message: `Item ${it.sku} catalog mein nahi mila` });
      }
      if (stockItem.centralStock < qty) {
        return res.status(400).json({
          success: false,
          message: `${stockItem.name} ka stock kam hai (${stockItem.centralStock} available, ${qty} maange gaye)`,
        });
      }
      cleanItems.push({ sku: stockItem.sku, name: stockItem.name, quantity: qty, _itemId: stockItem._id });
    }

    if (!cleanItems.length) {
      return res.status(400).json({ success: false, message: "Koi valid item quantity nahi mili" });
    }

    for (const ci of cleanItems) {
      await InventoryItem.updateOne({ _id: ci._itemId }, { $inc: { centralStock: -ci.quantity } });
      const existing = phlebo.kitStock.find((k) => k.sku === ci.sku);
      if (existing) {
        existing.quantity = (existing.quantity || 0) + ci.quantity;
      } else {
        phlebo.kitStock.push({ sku: ci.sku, name: ci.name, quantity: ci.quantity });
      }
    }
    await phlebo.save();

    const assignment = await KitAssignment.create({
      phlebo: phlebo._id,
      phleboName: phlebo.name,
      items: cleanItems.map(({ sku, name, quantity }) => ({ sku, name, quantity })),
      assignedBy: req.user._id,
      assignedByName: req.user.name || req.user.email || "Ops",
      note: note || "",
    });

    res.status(201).json({
      success: true,
      message: `Kit assigned to ${phlebo.name}`,
      assignment,
      phlebo,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/admin/phlebos/:id", verifyToken, requireRole("superadmin", "admin"), async (req, res) => {
  try {
    const phlebo = await Phlebotomist.findById(req.params.id).select("-passwordHash -otp");
    if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });
    if (req.user.role === "admin" && phlebo.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
    }

    const orders = await Job.find({ assignedPhlebo: phlebo._id });
    const stats = {
      totalJobs: orders.length,
      completed: orders.filter((o) =>
        ["Sample Collected", "Handed Off"].includes(o.phleboStatus)
      ).length,
      pending: orders.filter((o) => o.phleboStatus === "Assigned").length,
      active: orders.filter((o) =>
        ["Accepted", "En Route", "Arrived", "OTP Verified", "Consent Done"].includes(
          o.phleboStatus
        )
      ).length,
      rejected: orders.filter((o) => o.phleboStatus === "Rejected").length,
    };

    const cash = await getCashSummary(phlebo._id);

    res.json({ success: true, phlebo, stats, cash });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Leave/unavailability window — Collections tracking grid ke "on_leave" state ke
 *  liye, aur autoAssign.js is window ke andar naye jobs is phlebo ko assign nahi
 *  karta (see services/autoAssign.js). Ek phlebo ke overlapping leave records allowed
 *  hain (edge case, koi validation nahi lagayi — admin khud dekh ke manage karega). */
router.post(
  "/admin/phlebos/:id/leave",
  verifyToken,
  requireRole("superadmin", "admin"),
  async (req, res) => {
    try {
      const phlebo = await Phlebotomist.findById(req.params.id);
      if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });
      if (req.user.role === "admin" && phlebo.city !== req.user.city) {
        return res.status(403).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
      }
      const { fromDate, toDate, reason } = req.body || {};
      if (!fromDate || !toDate) {
        return res.status(400).json({ success: false, message: "fromDate aur toDate zaroori hai" });
      }
      if (String(toDate) < String(fromDate)) {
        return res.status(400).json({ success: false, message: "toDate, fromDate se pehle nahi ho sakti" });
      }
      const leave = await PhleboLeave.create({
        phlebo: phlebo._id,
        phleboName: phlebo.name,
        fromDate: String(fromDate).trim(),
        toDate: String(toDate).trim(),
        reason: reason || "",
        createdBy: req.user._id,
        createdByName: req.user.name || req.user.email || "Ops",
      });
      res.status(201).json({ success: true, leave });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.get(
  "/admin/phlebos/:id/leave",
  verifyToken,
  requireRole("superadmin", "admin"),
  async (req, res) => {
    try {
      const phlebo = await Phlebotomist.findById(req.params.id).select("city");
      if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });
      if (req.user.role === "admin" && phlebo.city !== req.user.city) {
        return res.status(403).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
      }
      const leaves = await PhleboLeave.find({ phlebo: phlebo._id }).sort({ fromDate: -1 }).limit(100);
      res.json({ success: true, leaves });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.delete(
  "/admin/leave/:id",
  verifyToken,
  requireRole("superadmin", "admin"),
  async (req, res) => {
    try {
      const leave = await PhleboLeave.findById(req.params.id);
      if (!leave) return res.status(404).json({ success: false, message: "Leave record not found" });
      if (req.user.role === "admin") {
        const phlebo = await Phlebotomist.findById(leave.phlebo).select("city");
        if (phlebo && phlebo.city !== req.user.city) {
          return res.status(403).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
        }
      }
      await leave.deleteOne();
      res.json({ success: true, message: "Leave cancel ho gayi" });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

/** Route optimization (Admin view) — same greedy nearest-neighbor plan the phlebo app
 *  itself sees (see buildRoutePlan above), just viewable by the city Admin/Superadmin
 *  for oversight/dispatch planning ("aaj is phlebo ko kis order pe kis order jaana
 *  chahiye"). Read-only — admin dekh sakta hai, khud order badal nahi sakta yahan se. */
router.get("/admin/phlebos/:id/route-plan", verifyToken, requireRole("superadmin", "admin"), async (req, res) => {
  try {
    const phlebo = await Phlebotomist.findById(req.params.id).select("-passwordHash -otp");
    if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });
    if (req.user.role === "admin" && phlebo.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
    }

    const date = req.query.date || ymd(new Date());
    const plan = await buildRoutePlan(phlebo, date, { maskPatient: false });
    res.json({ success: true, ...plan });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/admin/phlebos/:id", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const {
      name,
      zone,
      city,
      employeeId,
      status,
      servesAllClients,
      clientIds,
      dailyTarget,
      maxDailyJobs,
      incentivePerJob,
      targetBonus,
      slotCapacity,
    } = req.body;
    const phlebo = await Phlebotomist.findById(req.params.id);
    if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });
    if (req.user.role === "admin" && phlebo.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
    }

    if (name !== undefined) phlebo.name = String(name).trim();
    if (zone !== undefined) phlebo.zone = String(zone).trim();
    // City Admin apne phlebo ko doosre city mein shift nahi kar sakta (sirf superadmin).
    if (city !== undefined && req.user.role === "superadmin") phlebo.city = String(city).trim();
    if (employeeId !== undefined) phlebo.employeeId = String(employeeId).trim();
    if (servesAllClients !== undefined) phlebo.servesAllClients = !!servesAllClients;
    if (Array.isArray(clientIds)) phlebo.clientIds = clientIds;
    if (dailyTarget !== undefined) {
      const t = Number(dailyTarget);
      if (!Number.isFinite(t) || t < 0) {
        return res.status(400).json({ success: false, message: "dailyTarget must be a non-negative number" });
      }
      phlebo.dailyTarget = t;
    }
    if (maxDailyJobs !== undefined) {
      // 0 = auto-assign intentionally skips this phlebo (opted out) — a valid setting,
      // not an error.
      const cap = Number(maxDailyJobs);
      if (!Number.isFinite(cap) || cap < 0) {
        return res
          .status(400)
          .json({ success: false, message: "maxDailyJobs must be a non-negative number" });
      }
      phlebo.maxDailyJobs = cap;
    }
    if (incentivePerJob !== undefined) {
      const v = Number(incentivePerJob);
      if (!Number.isFinite(v) || v < 0) {
        return res.status(400).json({ success: false, message: "incentivePerJob must be a non-negative number" });
      }
      phlebo.incentivePerJob = v;
    }
    if (targetBonus !== undefined) {
      const v = Number(targetBonus);
      if (!Number.isFinite(v) || v < 0) {
        return res.status(400).json({ success: false, message: "targetBonus must be a non-negative number" });
      }
      phlebo.targetBonus = v;
    }
    if (slotCapacity !== undefined) {
      const v = Number(slotCapacity);
      if (!Number.isFinite(v) || v < 1) {
        return res.status(400).json({ success: false, message: "slotCapacity kam se kam 1 hona chahiye" });
      }
      phlebo.slotCapacity = v;
    }
    if (status !== undefined) {
      if (!["active", "inactive", "suspended"].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      phlebo.status = status;
    }
    await phlebo.save();
    res.json({ success: true, phlebo });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Purane/test phlebo records hatane ke liye — jaise ek phone number "already
 * registered" bata raha ho aur us entry ko dobara use karna ho. Agar us
 * phlebo ke naam koi non-terminal (abhi chal rahi) job hai to delete block
 * kar diya jaata hai (pehle unassign/complete karo) — taaki accidentally kisi
 * live pickup ka data kho na jaaye.
 */
router.delete("/admin/phlebos/:id", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const phlebo = await Phlebotomist.findById(req.params.id);
    if (!phlebo) return res.status(404).json({ success: false, message: "Phlebo not found" });
    if (req.user.role === "admin" && phlebo.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye phlebo aapke city ka nahi hai" });
    }

    const ACTIVE_STATUSES = [
      "Assigned",
      "Accepted",
      "En Route",
      "Arrived",
      "OTP Verified",
      "Consent Done",
    ];
    const activeJob = await Job.findOne({
      assignedPhlebo: phlebo._id,
      phleboStatus: { $in: ACTIVE_STATUSES },
    });
    if (activeJob) {
      return res.status(400).json({
        success: false,
        message: "Is phlebo ki abhi ek active job chal rahi hai — pehle usse unassign/complete karein",
      });
    }

    await Phlebotomist.deleteOne({ _id: phlebo._id });
    res.json({ success: true, message: `${phlebo.name} (${phlebo.phone}) delete ho gaya` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/admin/analytics", verifyToken, requireRole("superadmin", "admin"), attachScope, async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(d)) dateFilter.$gte = new Date(d.setHours(0, 0, 0, 0));
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d)) dateFilter.$lte = new Date(d.setHours(23, 59, 59, 999));
    }
    const orderFilter = { ...req.scopeFilter, ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}) };
    const phleboFilter = req.user.role === "admin" ? { city: req.user.city } : {};

    const [allOrders, phlebos, clients, cashAgg] = await Promise.all([
      Job.find(orderFilter).select(
        "assignedPhlebo assignedPhleboName phleboStatus paymentStatus totalAmount createdAt clientSlug"
      ),
      Phlebotomist.find(phleboFilter).select("-passwordHash -otp"),
      Client.find().select("name slug status"),
      Job.aggregate([
        {
          $match: {
            ...req.scopeFilter,
            paymentCollectedMethod: { $regex: /^cash$/i },
            paymentStatus: "Paid",
            cashSettled: false,
          },
        },
        { $group: { _id: null, total: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
      ]),
    ]);
    const totalCashPending = cashAgg[0]?.total || 0;
    const totalCashPendingCount = cashAgg[0]?.count || 0;

    const totalOrders = allOrders.length;
    const completedOrders = allOrders.filter((o) =>
      ["Sample Collected", "Handed Off"].includes(o.phleboStatus)
    ).length;
    const rejectedOrders = allOrders.filter((o) => o.phleboStatus === "Rejected").length;
    const unassignedOrders = allOrders.filter(
      (o) => !o.assignedPhlebo || ["Unassigned", null].includes(o.phleboStatus)
    ).length;

    const byClient = {};
    for (const o of allOrders) {
      const k = o.clientSlug || "unknown";
      byClient[k] = (byClient[k] || 0) + 1;
    }

    res.json({
      success: true,
      totalOrders,
      completedOrders,
      rejectedOrders,
      unassignedOrders,
      completionRate: totalOrders ? Math.round((completedOrders / totalOrders) * 100) : 0,
      totalPhlebos: phlebos.length,
      activePhlebos: phlebos.filter((p) => p.status === "active").length,
      totalClients: clients.length,
      jobsByClient: byClient,
      clients,
      totalCashPending,
      totalCashPendingCount,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const LAB_TAT_SLA_HOURS = 24;

/** Lab TAT (turnaround-time) tracking — sample handover se report-ready tak kitna
 *  time laga (ya, agar abhi bhi pending hai, to abhi tak kitna time nikal chuka hai)
 *  — per-order aur per-lab summary, SLA se zyada time lagne pe "delayed" flag. */
router.get(
  "/admin/analytics/lab-tat",
  verifyToken,
  requireRole("superadmin", "admin"),
  attachScope,
  async (req, res) => {
    try {
      const filter = { ...req.scopeFilter, "handover.handedOverAt": { $ne: null } };
      const orders = await Job.find(filter)
        .select("patientName assignedLabName city handover reportReadyAt slotDate slotTime")
        .sort({ "handover.handedOverAt": -1 })
        .limit(500);

      const now = Date.now();
      const rows = orders.map((o) => {
        const handedOverAt = o.handover?.handedOverAt || null;
        const reportReadyAt = o.reportReadyAt || null;
        const endTime = reportReadyAt ? new Date(reportReadyAt).getTime() : now;
        const tatHours = handedOverAt
          ? Math.round(((endTime - new Date(handedOverAt).getTime()) / 3600000) * 10) / 10
          : null;
        const pending = !reportReadyAt;
        const delayed = pending && tatHours !== null && tatHours > LAB_TAT_SLA_HOURS;
        return {
          orderId: o._id,
          patientName: o.patientName,
          labName: o.assignedLabName || "Unassigned",
          city: o.city,
          handedOverAt,
          reportReadyAt,
          tatHours,
          pending,
          delayed,
        };
      });

      // Per-lab rollup — pending/delayed counts + average TAT for completed reports.
      const byLab = {};
      rows.forEach((r) => {
        const k = r.labName;
        if (!byLab[k]) {
          byLab[k] = { labName: k, total: 0, pending: 0, delayed: 0, tatSum: 0, tatCount: 0 };
        }
        byLab[k].total += 1;
        if (r.pending) byLab[k].pending += 1;
        if (r.delayed) byLab[k].delayed += 1;
        if (!r.pending && r.tatHours !== null) {
          byLab[k].tatSum += r.tatHours;
          byLab[k].tatCount += 1;
        }
      });
      const labs = Object.values(byLab).map((l) => ({
        labName: l.labName,
        total: l.total,
        pending: l.pending,
        delayed: l.delayed,
        avgTatHours: l.tatCount ? Math.round((l.tatSum / l.tatCount) * 10) / 10 : null,
      }));

      res.json({ success: true, slaHours: LAB_TAT_SLA_HOURS, orders: rows, labs });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

/**
 * Superadmin-only cross-city report — ek row per city (jitne bhi city Admins
 * bane hain), taaki superadmin bina kisi city ke andar operational data
 * edit kiye sirf overview dekh sake. Actual order/phlebo editing hamesha
 * us city ke Admin se hi hoti hai.
 */
router.get("/admin/analytics/by-city", verifyToken, requireRole("superadmin"), async (_req, res) => {
  try {
    const [orderAgg, phleboAgg, admins, labAgg] = await Promise.all([
      Job.aggregate([
        {
          $group: {
            _id: { $ifNull: ["$city", "Unknown"] },
            totalOrders: { $sum: 1 },
            completedOrders: {
              $sum: { $cond: [{ $in: ["$phleboStatus", ["Sample Collected", "Handed Off"]] }, 1, 0] },
            },
            cashPending: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ["$paymentStatus", "Paid"] }, { $eq: ["$cashSettled", false] }] },
                  "$totalAmount",
                  0,
                ],
              },
            },
          },
        },
      ]),
      Phlebotomist.aggregate([
        {
          $group: {
            _id: { $ifNull: ["$city", "Unknown"] },
            totalPhlebos: { $sum: 1 },
            activePhlebos: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          },
        },
      ]),
      OpsUser.find({ role: "admin" }).select("name email city isActive createdAt"),
      OpsUser.aggregate([{ $match: { role: "lab" } }, { $group: { _id: "$city", totalLabs: { $sum: 1 } } }]),
    ]);

    const orderMap = Object.fromEntries(orderAgg.map((o) => [o._id, o]));
    const phleboMap = Object.fromEntries(phleboAgg.map((p) => [p._id, p]));
    const labMap = Object.fromEntries(labAgg.map((l) => [l._id, l.totalLabs]));

    const cities = admins.map((a) => {
      const o = orderMap[a.city] || { totalOrders: 0, completedOrders: 0, cashPending: 0 };
      const p = phleboMap[a.city] || { totalPhlebos: 0, activePhlebos: 0 };
      return {
        city: a.city,
        adminId: a._id,
        adminName: a.name,
        adminEmail: a.email,
        adminActive: a.isActive !== false,
        totalOrders: o.totalOrders,
        completedOrders: o.completedOrders,
        cashPending: o.cashPending,
        totalPhlebos: p.totalPhlebos,
        activePhlebos: p.activePhlebos,
        totalLabs: labMap[a.city] || 0,
      };
    });

    res.json({
      success: true,
      cities,
      totals: {
        totalOrders: cities.reduce((s, c) => s + c.totalOrders, 0),
        totalPhlebos: cities.reduce((s, c) => s + c.totalPhlebos, 0),
        totalLabs: cities.reduce((s, c) => s + c.totalLabs, 0),
        totalCities: cities.length,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
