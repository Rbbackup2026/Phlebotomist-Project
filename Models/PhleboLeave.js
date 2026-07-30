const mongoose = require("mongoose");

/**
 * Phlebo unavailability window (leave/off-duty pre-planned) — ek ya zyada din, admin ne
 * mark kiya. Collections tracking grid isko "on_leave" state ke roop mein dikhati hai
 * (chahe phlebo ka live dutyStatus kuch bhi ho), aur autoAssign.js is window ke andar
 * naye jobs is phlebo ko assign nahi karta. fromDate/toDate "YYYY-MM-DD" string (slotDate
 * jaisa hi format) — inclusive dono taraf se.
 */
const phleboLeaveSchema = new mongoose.Schema(
  {
    phlebo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Phlebotomist",
      required: true,
      index: true,
    },
    phleboName: { type: String, default: "", trim: true },
    fromDate: { type: String, required: true, trim: true },
    toDate: { type: String, required: true, trim: true },
    reason: { type: String, default: "", trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OpsUser",
      default: null,
    },
    createdByName: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

phleboLeaveSchema.index({ phlebo: 1, fromDate: 1, toDate: 1 });

module.exports = mongoose.model("PhleboLeave", phleboLeaveSchema);
