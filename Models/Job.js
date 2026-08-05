const mongoose = require("mongoose");

/**
 * Phlebo-owned collection job (alag DB).
 * Website order id = externalOrderId; clientId = kaunsi website.
 */
const jobSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true,
    },
    clientSlug: { type: String, default: "", trim: true, index: true },
    clientName: { type: String, default: "", trim: true },
    /** Partner website ka order _id / reference */
    externalOrderId: { type: String, required: true, trim: true, index: true },
    /** Human-readable sequential ID (WEL-YYYYMMDD-0001) — patient/phlebo/lab sab isi ek
     *  reference se baat kar sakte hain, raw Mongo _id ke bajaye. See services/pickupId.js.
     *  sparse:true taaki purane (pre-migration) records null rehte hue bhi unique index
     *  na tootein. */
    pickupId: { type: String, default: null, unique: true, sparse: true, index: true },
    /** Patient-facing tracking link ka opaque secret (/public/track/:token) — pickupId se
     *  guess nahi ho sakta. Kabhi bhi phlebo app ko wapas nahi bheja jaata (formatJob
     *  isse exclude karta hai), sirf Ops/website ko dikhta/share hota hai. */
    trackingToken: { type: String, default: null, unique: true, sparse: true, index: true },
    items: [
      {
        productId: { type: String },
        name: { type: String, default: "" },
        category: { type: String, default: "" },
        price: { type: Number, default: 0 },
        quantity: { type: Number },
        addedByPhlebo: { type: Boolean, default: false },
        addedBySource: { type: String, enum: ["phlebo", "admin"], default: "phlebo" },
        addedAt: { type: Date, default: null },
      },
    ],
    patientName: { type: String, trim: true, required: true },
    gender: { type: String, default: "", trim: true },
    mobileNumber: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, required: true },
    state: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    area: { type: String, trim: true, default: "" },
    pincode: { type: String, trim: true, default: "" },
    /** Geocoded from address/area/city/pincode at creation time — used for route
     *  optimization (nearest-neighbor ordering) and geofenced auto-arrival. Null until
     *  the background geocode job resolves (see services/geocode.js). */
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    geocodedAt: { type: Date, default: null },
    slotDate: { type: String, trim: true, required: true },
    slotTime: { type: String, trim: true, required: true },
    amount: { type: Number },
    totalAmount: { type: Number },
    status: { type: String, default: "Booked", trim: true },
    paymentMethod: { type: String, default: "COD", trim: true },
    paymentStatus: { type: String, default: "Unpaid", trim: true },
    paymentCollectedAt: { type: Date, default: null },
    paymentCollectedMethod: { type: String, default: "", trim: true },
    paymentCollectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Phlebotomist",
      default: null,
    },
    /** Cash-in-hand reconciliation: phlebo cash collect karta hai, phir office/lab mein Ops ko hand over karta hai */
    cashSettled: { type: Boolean, default: false },
    cashSettledAt: { type: Date, default: null },
    cashSettledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OpsUser",
      default: null,
    },
    assignedPhlebo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Phlebotomist",
      default: null,
    },
    assignedPhleboName: { type: String, default: "", trim: true },
    assignedAt: { type: Date, default: null },
    /** City ke andar multiple labs ho sakti hain — sample kis lab ko handover/process
     *  karna hai, wo yahan set hota hai (Admin assign karta hai, ya city mein sirf ek
     *  hi lab ho to auto). "lab" role login iske alawa doosri lab ka order nahi dekh sakta. */
    assignedLab: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OpsUser",
      default: null,
    },
    assignedLabName: { type: String, default: "", trim: true },
    /** "auto" = services/autoAssign.js picked the phlebo, "manual" = Ops assigned via
     *  the dashboard. Cleared back to "" whenever the job goes unassigned. */
    assignedBy: { type: String, enum: ["", "auto", "manual"], default: "" },
    phleboStatus: {
      type: String,
      enum: [
        "Unassigned",
        "Assigned",
        "Accepted",
        "Rejected",
        "En Route",
        "Arrived",
        "OTP Verified",
        "Consent Done",
        "Sample Collected",
        "Handed Off",
      ],
      default: "Unassigned",
      trim: true,
      index: true,
    },
    rejectedReason: { type: String, default: "", trim: true },
    /** Who set status=Cancelled — phlebo (Cancel Job) vs admin (master cancel). */
    cancelledBy: { type: String, enum: ["", "phlebo", "admin"], default: "", trim: true },
    cancelledByName: { type: String, default: "", trim: true },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: "", trim: true },
    acceptedAt: { type: Date, default: null },
    /** "I'm on the way" ke waqt phlebo ka position — arrival ke against travel-km
     *  nikalne ke liye (see PhleboRoute.js /jobs/:id/arrival). */
    enRouteAt: { type: Date, default: null },
    enRouteLat: { type: Number, default: null },
    enRouteLng: { type: Number, default: null },
    arrivedAt: { type: Date, default: null },
    arrivedLat: { type: Number, default: null },
    arrivedLng: { type: Number, default: null },
    /** enRoute→arrival as-the-crow-flies km — reimbursement/Kms tracker ke liye. */
    travelDistanceKm: { type: Number, default: null },
    /** Geofence audit (soft flag only, kabhi arrival block nahi karta) — arrival kitni
     *  door pe mark hui geocoded address se, aur wo acceptable radius ke andar thi ya nahi. */
    arrivedDistanceFromAddressM: { type: Number, default: null },
    arrivedWithinGeofence: { type: Boolean, default: null },
    patientOtp: { type: String, default: null },
    patientOtpExpires: { type: Date, default: null },
    otpVerifiedAt: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },
    consent: {
      signed: { type: Boolean, default: false },
      signatureData: { type: String, default: "" },
      consentedAt: { type: Date, default: null },
      consentLat: { type: Number, default: null },
      consentLng: { type: Number, default: null },
      declined: { type: Boolean, default: false },
    },
    /** TRF (Test Requisition Form) barcode — pehle scan hota hai; tube barcodes isi se match hone chahiye */
    trfBarcode: { type: String, default: "", trim: true, index: true },
    /** Photo(s) of the TRF form after barcode scan */
    trfPhotoUrl: { type: String, default: "" },
    trfPhotoUrls: [{ type: String }],
    /** Shared photo(s) of all tubes together (not per-tube) */
    collectionPhotoUrl: { type: String, default: "" },
    collectionPhotoUrls: [{ type: String }],
    samples: [
      {
        barcode: { type: String, trim: true },
        /** Primary / first photo — kept in sync with photoUrls[0] for older clients */
        photoUrl: { type: String, default: "" },
        /** All evidence photos for this tube (camera can capture multiple) */
        photoUrls: [{ type: String }],
        /** Easy flag for Compass/admin — photoUrl itself is a huge base64 string */
        hasPhoto: { type: Boolean, default: false },
        photoTakenAt: { type: Date, default: null },
        sampleType: { type: String, default: "Blood" },
        coldChainOk: { type: Boolean, default: true },
        scannedAt: { type: Date, default: null },
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
        /** Lab ne sample reject kiya (haemolyzed/insufficient/etc) — see PUT
         *  /admin/orders/:id/samples/:barcode/reject, jo optionally ek redraw job bhi
         *  bana deta hai. */
        rejected: { type: Boolean, default: false },
        rejectionReason: { type: String, default: "", trim: true },
        rejectedAt: { type: Date, default: null },
      },
    ],
    collectedAt: { type: Date, default: null },
    handover: {
      completed: { type: Boolean, default: false },
      barcodes: [{ type: String }],
      handedOverAt: { type: Date, default: null },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      note: { type: String, default: "" },
      /** Cold-chain bag evidence — primary/first photo (synced with bagPhotoUrls[0]) */
      bagPhotoUrl: { type: String, default: "" },
      /** Multiple bag angles / seal shots */
      bagPhotoUrls: [{ type: String }],
      bagTemperatureC: { type: Number, default: null },
    },
    /** Ek rejected sample ke liye dobara collection trip — original order se link,
     *  taaki dono taraf se traceable rahe. Redraw ka amount 0 rakha jaata hai (patient
     *  ne already original order pe pay kar diya hai, dobara bill nahi hota). */
    isRedraw: { type: Boolean, default: false },
    redrawOf: { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null },
    redrawReason: { type: String, default: "", trim: true },
    hasRedraw: { type: Boolean, default: false },
    /** Patient-facing rating (via /public/track/:token/rate), sirf collection ke baad. */
    rating: {
      stars: { type: Number, default: null },
      comment: { type: String, default: "", trim: true },
      ratedAt: { type: Date, default: null },
    },
    /** Patient ne apne tracking link se reschedule maanga — Ops dashboard mein flag
     *  hoke dikhega, slot khud-ba-khud nahi badalta (Admin PUT .../reschedule se karta hai). */
    rescheduleRequested: { type: Boolean, default: false },
    rescheduleRequestedAt: { type: Date, default: null },
    rescheduleRequestNote: { type: String, default: "", trim: true },
    /** Lab TAT (turnaround-time) tracking: sample handover ho jaane ke baad, jab lab
     *  report ready kar deti hai to Admin "Mark report ready" dabata hai — isi se
     *  reportReadyAt set hota hai. TAT = reportReadyAt - handover.handedOverAt. Null
     *  matlab abhi report pending hai (delay-alert ke liye use hota hai). */
    reportReadyAt: { type: Date, default: null },
    specialInstructions: { type: String, default: "", trim: true },
    adminNote: { type: String, default: "", trim: true },
    // Walk-in patient added by phlebo at another job's address
    walkInSourceJobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null },
    lastWebhookAt: { type: Date, default: null },
    lastWebhookStatus: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

jobSchema.index({ clientId: 1, externalOrderId: 1 }, { unique: true });

module.exports = mongoose.model("Job", jobSchema);
