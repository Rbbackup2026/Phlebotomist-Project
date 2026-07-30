const mongoose = require("mongoose");

/**
 * Phlebo platform Ops / admin (alag DB — Wello Registeruser pe depend nahi).
 *
 * Role hierarchy (multi-city rollout):
 *   superadmin — platform owner. Sabhi cities dekh/manage kar sakta hai.
 *                Sirf superadmin naye city "admin" bana sakta hai.
 *   admin      — ek city ka owner (ek city = ek admin, `city` unique hai).
 *                Apne city ke andar multiple "lab" accounts bana sakta hai.
 *   lab        — ek city ke andar ek lab. Sirf apne (assignedLab) orders/samples
 *                dekh sakta hai — city ke andar doosri lab ka data nahi.
 *   ops        — legacy role (backward compatibility ke liye rakha hai; naya
 *                account is role se ab nahi banega).
 */
const opsUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    name: { type: String, default: "Ops Admin", trim: true },
    role: {
      type: String,
      enum: ["superadmin", "admin", "lab", "ops"],
      default: "ops",
    },
    /**
     * "admin" role ke liye: jis city ko wo manage karta hai (unique — ek city
     * ka ek hi admin hota hai).
     * "lab" role ke liye: jis city mein wo operate karti hai (apne parent
     * admin ke city se inherit hoti hai, multiple labs same city share kar
     * sakti hain).
     * superadmin ke liye blank/null rehta hai (sab cities uska scope hai).
     */
    city: {
      type: String,
      trim: true,
      default: "",
      set: (v) => (v ? String(v).trim() : ""),
    },
    /** Is account ko kisne banaya (superadmin → admin, admin → lab) — traceability ke liye */
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OpsUser",
      default: null,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Ek city ka ek hi "admin" ho sakta hai. Partial index isliye taaki "lab" role
// (jahan multiple accounts same city share karte hain) is constraint se bahar rahe,
// aur superadmin ka blank city bhi conflict na kare.
opsUserSchema.index(
  { city: 1 },
  { unique: true, partialFilterExpression: { role: "admin", city: { $type: "string", $ne: "" } } }
);

module.exports = mongoose.model("OpsUser", opsUserSchema);
