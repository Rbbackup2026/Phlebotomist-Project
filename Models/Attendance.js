const mongoose = require("mongoose");

/**
 * Daily shift check-in/check-out — separate from dutyStatus (which controls whether
 * NEW jobs get auto-assigned). Attendance is the payroll/HR record: "was this phlebo
 * actually on the ground today, and from when to when". One phlebo can have more than
 * one row per dateKey if their shift is split (check out for lunch, check in again) —
 * intentionally not unique-constrained on {phlebo, dateKey}.
 */
const attendanceSchema = new mongoose.Schema(
  {
    phlebo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Phlebotomist",
      required: true,
      index: true,
    },
    phleboName: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    /** YYYY-MM-DD, phlebo's local check-in day */
    dateKey: { type: String, required: true, index: true },
    checkInAt: { type: Date, default: null },
    checkInLat: { type: Number, default: null },
    checkInLng: { type: Number, default: null },
    checkOutAt: { type: Date, default: null },
    checkOutLat: { type: Number, default: null },
    checkOutLng: { type: Number, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Attendance", attendanceSchema);
