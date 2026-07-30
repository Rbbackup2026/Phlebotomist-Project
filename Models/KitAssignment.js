const mongoose = require("mongoose");

/** Audit log: admin ne kis phlebo ko kab kya kit diya */
const kitAssignmentSchema = new mongoose.Schema(
  {
    phlebo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Phlebotomist",
      required: true,
      index: true,
    },
    phleboName: { type: String, default: "", trim: true },
    items: [
      {
        sku: { type: String, trim: true },
        name: { type: String, trim: true },
        quantity: { type: Number, default: 0 },
      },
    ],
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OpsUser",
      default: null,
    },
    assignedByName: { type: String, default: "", trim: true },
    note: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("KitAssignment", kitAssignmentSchema);
