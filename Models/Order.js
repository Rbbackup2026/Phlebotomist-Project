const mongoose = require("mongoose");

/**
 * Maps to the same `orders` collection as Wello main backend.
 * Phlebo fields live here so this project owns phlebo workflow updates.
 */
const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "Registeruser" },
    items: [
      {
        productId: { type: String },
        name: { type: String, default: "" },
        category: { type: String, default: "" },
        price: { type: Number, default: 0 },
        quantity: { type: Number },
      },
    ],
    patientName: { type: String, trim: true },
    gender: { type: String, default: "", trim: true },
    mobileNumber: { type: String, trim: true, default: "" },
    address: { type: String, trim: true },
    state: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    area: { type: String, trim: true, default: "" },
    pincode: { type: String, trim: true, default: "" },
    slotDate: { type: String, trim: true },
    slotTime: { type: String, trim: true },
    amount: { type: Number },
    totalAmount: { type: Number },
    status: { type: String, default: "Booked", trim: true },
    paymentMethod: { type: String, default: "COD", trim: true },
    paymentStatus: { type: String, default: "Unpaid", trim: true },
    assignedPhlebo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Phlebotomist",
      default: null,
    },
    assignedPhleboName: { type: String, default: "", trim: true },
    /** City ke andar multiple labs ho sakti hain — sample kis lab ko handover karna hai */
    assignedLab: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OpsUser",
      default: null,
    },
    assignedLabName: { type: String, default: "", trim: true },
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
    },
    rejectedReason: { type: String, default: "", trim: true },
    acceptedAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
    arrivedLat: { type: Number, default: null },
    arrivedLng: { type: Number, default: null },
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
    samples: [
      {
        barcode: { type: String, trim: true },
        photoUrl: { type: String, default: "" },
        sampleType: { type: String, default: "Blood" },
        coldChainOk: { type: Boolean, default: true },
        scannedAt: { type: Date, default: null },
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
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
    },
    specialInstructions: { type: String, default: "", trim: true },
    adminNote: { type: String, default: "", trim: true },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model("Order", orderSchema);
