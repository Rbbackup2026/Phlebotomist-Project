const crypto = require("crypto");
const Counter = require("../Models/Counter");

function dayKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Human-readable, sortable pickup ID — e.g. WEL-20260728-0007. Sequence resets daily
 * (per-day counter document in Mongo, atomic $inc so concurrent bookings never
 * collide). Patients, phlebos and labs can all reference the same short code instead
 * of a raw Mongo ObjectId.
 * @param {Date} [date] defaults to now
 * @returns {Promise<string>}
 */
async function generatePickupId(date = new Date()) {
  const dayKey = dayKeyOf(date);
  const counter = await Counter.findOneAndUpdate(
    { _id: `pickup_${dayKey}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const seq = String(counter.seq).padStart(4, "0");
  return `WEL-${dayKey}-${seq}`;
}

/**
 * Opaque secret for the patient-facing tracking link (/public/track/:token) — random,
 * not derivable from the pickupId or order _id, so a patient can only see their own
 * order's status.
 * @returns {string}
 */
function generateTrackingToken() {
  return crypto.randomBytes(12).toString("hex");
}

module.exports = { generatePickupId, generateTrackingToken };
