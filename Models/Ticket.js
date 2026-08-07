const mongoose = require("mongoose");

/**
 * Support tickets — city Admin raises issues; Superadmin replies / closes.
 * Lab / phlebo are out of scope for v1 (city-admin-only).
 */
const messageSchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: "OpsUser", required: true },
    byName: { type: String, default: "", trim: true },
    byRole: { type: String, enum: ["superadmin", "admin", "lab", "ops"], required: true },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const ticketSchema = new mongoose.Schema(
  {
    ticketNo: { type: String, required: true, unique: true, trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OpsUser",
      required: true,
      index: true,
    },
    city: { type: String, required: true, trim: true, index: true },
    category: {
      type: String,
      enum: ["orders", "payments", "kits", "phlebos", "login", "bug", "other"],
      default: "other",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    relatedOrderId: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
      index: true,
    },
    messages: { type: [messageSchema], default: [] },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ city: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Ticket", ticketSchema);
