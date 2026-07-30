const mongoose = require("mongoose");
const crypto = require("crypto");

/**
 * Multi-website tenant. Har website (Wello, Clinic A, …) ek Client.
 * Partner API key se orders/jobs Phlebo mein aate hain.
 */
const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    apiKey: {
      type: String,
      required: true,
      unique: true,
      default: () => `pk_live_${crypto.randomBytes(24).toString("hex")}`,
    },
    webhookUrl: { type: String, default: "", trim: true },
    webhookSecret: {
      type: String,
      default: () => crypto.randomBytes(24).toString("hex"),
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    contactEmail: { type: String, default: "", trim: true },
    /** Partner website product API base, e.g. http://localhost:3000/v1/api */
    catalogApiUrl: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Client", clientSchema);
