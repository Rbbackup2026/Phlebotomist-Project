const mongoose = require("mongoose");

/**
 * Platform phlebotomists — multiple websites ke jobs serve kar sakte hain.
 * servesAllClients=true → saari websites
 * warna clientIds list pe limited
 */
const phlebotomistSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      validate: {
        validator: (v) => /^\d{10}$/.test(v),
        message: "Phone must be 10 digits",
      },
    },
    employeeId: { type: String, trim: true, default: "", unique: true, sparse: true },
    passwordHash: { type: String, default: "" },
    zone: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },
    dutyStatus: {
      type: String,
      enum: ["on_duty", "off_duty"],
      default: "off_duty",
    },
    /** true = Wello + saari partner websites ke jobs assign ho sakte hain */
    servesAllClients: { type: Boolean, default: true },
    clientIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Client",
      },
    ],
    currentLat: { type: Number, default: null },
    currentLng: { type: Number, default: null },
    lastLocationAt: { type: Date, default: null },
    /** Aaj ka running travel total — consecutive /phlebo/location pings ke beech
     *  haversine delta jodkar banta hai (koi alag ping-history collection nahi),
     *  todayDistanceDateKey badalte hi 0 se reset ho jaata hai. Reimbursement/Kms
     *  tracker ke liye. */
    todayDistanceKm: { type: Number, default: 0 },
    todayDistanceDateKey: { type: String, default: "" },
    /** Expo push token — naya job assign/auto-assign hote hi notification ke liye.
     *  Blank tab tak jab tak phlebo app open karke login na kare (POST /phlebo/push-token). */
    pushToken: { type: String, default: "" },
    rating: { type: Number, default: 5 },
    /** Har patient rating (/public/track/:token/rate) is running mean mein fold hota
     *  hai — poori history alag se store nahi ki jaati, isliye ye average approximate hai. */
    ratingCount: { type: Number, default: 0 },
    /** Admin-configurable incentive rule — Ops/Admin-only view (GET
     *  /admin/phlebos/:id/incentive) mein use hota hai. Phlebo app ke job-stats
     *  dashboard mein jaanbujh kar koi ₹ figure nahi dikhaya jaata (see PhleboRoute.js
     *  /phlebo/job-stats comment) — ye sirf Ops ke liye hai. */
    incentivePerJob: { type: Number, default: 50 },
    targetBonus: { type: Number, default: 200 },
    /** Admin-configurable daily job target for the incentive/progress dashboard.
     *  Job counts themselves are NOT stored per-day — GET /phlebo/job-stats computes
     *  them on demand straight from Job.collectedAt (no ₹ amount exposed to the
     *  phlebo app, intentionally — job count only), which also lets the dashboard
     *  look at any past date, not just "today". */
    dailyTarget: { type: Number, default: 10 },
    /** Hard cap used by auto-assignment — "ek din mein kitne sample" this phlebo can
     *  take for a given slotDate. Auto-assign skips a phlebo once their count for that
     *  day hits this number; admin can always still assign manually past the cap if
     *  needed (see PUT /admin/orders/:id/assign-phlebo). */
    maxDailyJobs: { type: Number, default: 15 },
    /** Ek hi exact slotTime mein ye phlebo ek saath kitne jobs handle kar sakta hai —
     *  default 1 (ek waqt mein ek jagah). 1 se zyada tab set hota hai jab phlebo kisi
     *  assistant/team ke saath kaam karta ho, ya jab ek "slot" chhoti window ke bajaye
     *  ek badi window represent karta ho. Collections tracking grid isi se decide
     *  karti hai ki slot "full" hai ya abhi "partially booked". */
    slotCapacity: { type: Number, default: 1 },
    lastOffDutyAt: { type: Date, default: null },
    /** Admin ne is phlebo ko jo kit items diye hain, unka running balance */
    kitStock: [
      {
        sku: { type: String, trim: true },
        name: { type: String, trim: true },
        quantity: { type: Number, default: 0 },
      },
    ],
    otp: { type: String, default: null },
    otpExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

phlebotomistSchema.methods.canServeClient = function (clientId) {
  if (this.servesAllClients) return true;
  if (!clientId) return false;
  return (this.clientIds || []).some((id) => String(id) === String(clientId));
};

module.exports = mongoose.model("Phlebotomist", phlebotomistSchema);
