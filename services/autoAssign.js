const Job = require("../Models/Job");
const Phlebotomist = require("../Models/Phlebotomist");
const PhleboLeave = require("../Models/PhleboLeave");
const { saveAndNotify } = require("./webhook");
const { geocodeAddress } = require("./geocode");
const { sendPushToPhlebo } = require("./push");

/**
 * Auto-assignment: nearest on-duty phlebo who still has daily capacity left, matched
 * to a new job automatically — with manual assignment (PUT /admin/orders/:id/assign-
 * phlebo) always still available as an override, and as the fallback whenever no
 * eligible phlebo is found here.
 *
 * "Eligible" = active + on_duty + serves this job's client + maxDailyJobs not yet hit
 * for that job's slotDate. Among eligible phlebos, nearest by geocoded lat/lng wins;
 * phlebos with no live location yet are considered last (not excluded — capacity/duty
 * still matters more than an unknown distance).
 */

// slotDate parsing kept in lockstep with Route/PhleboRoute.js and the app's
// HomeScreen.js — free-form string from whatever picker sent it (DD/MM/YYYY, ISO, etc).
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

function dayKeyOf(slotDate) {
  const parsed = parseSlotDate(slotDate);
  return parsed ? ymd(parsed) : String(slotDate);
}

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

/**
 * Tries to assign ONE unassigned job to the best eligible phlebo. No-op (job stays
 * "Unassigned") if nobody qualifies — that's expected, not an error; admin can always
 * assign manually from the Ops dashboard.
 * @returns {Promise<Object|null>} the chosen Phlebotomist doc, or null if none matched.
 */
async function autoAssignJob(jobId) {
  const job = await Job.findById(jobId);
  if (!job || job.phleboStatus !== "Unassigned") return null;

  const targetDay = dayKeyOf(job.slotDate);
  const candidates = await Phlebotomist.find({ status: "active", dutyStatus: "on_duty" });

  // Pehle se planned leave/unavailability wale phlebos ko us din ke liye eligible
  // candidates se hi hata do — admin ne Collections screen se jo bhi window mark kiya
  // ho, auto-assign usme naya job kabhi nahi dega (manual override admin hamesha kar
  // sakta hai, ye sirf auto-assign ko rokta hai).
  const onLeaveIds = new Set(
    (
      await PhleboLeave.find({ fromDate: { $lte: targetDay }, toDate: { $gte: targetDay } }).select(
        "phlebo"
      )
    ).map((l) => String(l.phlebo))
  );

  // City-wise isolation: order jis city ka hai, sirf usi city ke on-duty phlebo
  // consider honge — warna kisi doosre city ka phlebo (jab wahan koi on-duty na ho)
  // distance ke hisaab se galti se assign ho sakta tha. Agar job ka city hi pata
  // nahi hai (blank), to purana behavior rakha hai — koi filter nahi, taaki order
  // sirf missing-city data ki wajah se "Unassigned" na phans jaaye.
  const jobCity = String(job.city || "").trim().toLowerCase();

  const eligible = [];
  for (const p of candidates) {
    if (onLeaveIds.has(String(p._id))) continue;
    if (typeof p.canServeClient === "function" && !p.canServeClient(job.clientId)) continue;

    if (jobCity) {
      const phleboCity = String(p.city || "").trim().toLowerCase();
      if (phleboCity !== jobCity) continue;
    }

    const cap = p.maxDailyJobs || 0;
    if (cap <= 0) continue; // admin hasn't opted this phlebo into auto-assign yet

    const dayJobs = await Job.find({
      assignedPhlebo: p._id,
      phleboStatus: { $ne: "Rejected" },
    }).select("slotDate");
    const countForDay = dayJobs.filter((j) => dayKeyOf(j.slotDate) === targetDay).length;
    if (countForDay >= cap) continue; // already at capacity for that day

    let distanceKm = null;
    if (
      typeof job.lat === "number" &&
      typeof job.lng === "number" &&
      typeof p.currentLat === "number" &&
      typeof p.currentLng === "number"
    ) {
      distanceKm = haversineKm(job.lat, job.lng, p.currentLat, p.currentLng);
    }
    eligible.push({ phlebo: p, distanceKm });
  }

  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    if (a.distanceKm === null && b.distanceKm === null) return 0;
    if (a.distanceKm === null) return 1;
    if (b.distanceKm === null) return -1;
    return a.distanceKm - b.distanceKm;
  });

  const chosen = eligible[0].phlebo;
  job.assignedPhlebo = chosen._id;
  job.assignedPhleboName = chosen.name;
  job.assignedAt = new Date();
  job.assignedBy = "auto";
  job.phleboStatus = "Assigned";
  await saveAndNotify(job);
  sendPushToPhlebo(
    chosen,
    "New pickup assigned",
    `${job.patientName} — ${job.slotDate} ${job.slotTime}`,
    { jobId: String(job._id) }
  ).catch(() => {});
  return chosen;
}

/**
 * Re-checks every currently-"Unassigned" job against auto-assign eligibility — meant
 * to run whenever a phlebo's availability changes (e.g. just went on_duty), so jobs
 * that had no eligible phlebo earlier get picked up as soon as someone becomes free.
 * @returns {Promise<number>} how many jobs got assigned.
 */
async function tryAutoAssignPendingJobs() {
  const pending = await Job.find({ phleboStatus: "Unassigned" })
    .sort({ slotDate: 1, slotTime: 1 })
    .select("_id");

  let assigned = 0;
  for (const { _id } of pending) {
    const result = await autoAssignJob(_id);
    if (result) assigned++;
  }
  return assigned;
}

/**
 * Call right after Job.create() — geocodes the address if it wasn't already supplied,
 * then immediately tries auto-assign. Meant to run in the background (setImmediate)
 * so it never adds latency to the create-order response; swallows its own errors for
 * the same reason (a failure here should never surface to the caller).
 */
async function geocodeAndAutoAssign(job) {
  try {
    if (!(typeof job.lat === "number" && typeof job.lng === "number")) {
      const geo = await geocodeAddress({
        address: job.address,
        area: job.area,
        city: job.city,
        state: job.state,
        pincode: job.pincode,
      });
      if (geo) {
        job.lat = geo.lat;
        job.lng = geo.lng;
        job.geocodedAt = new Date();
        await Job.updateOne(
          { _id: job._id },
          { $set: { lat: geo.lat, lng: geo.lng, geocodedAt: job.geocodedAt } }
        );
      }
    }
    await autoAssignJob(job._id);
  } catch (err) {
    console.warn("[auto-assign] geocode+assign failed:", err.message);
  }
}

module.exports = { autoAssignJob, tryAutoAssignPendingJobs, geocodeAndAutoAssign };
