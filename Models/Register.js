const mongoose = require("mongoose");

/** Same collection as Wello main backend — for Ops admin login only */
const loginSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: { type: String, required: true },
  confirmPassword: { type: String },
  name: { type: String },
  phone: { type: String },
});

module.exports = mongoose.model("Registeruser", loginSchema);
