const mongoose = require("mongoose");

/**
 * Generic atomic sequence counter — used by services/pickupId.js to hand out
 * gap-free, collision-free daily pickup numbers even under concurrent bookings
 * (findOneAndUpdate $inc is atomic in Mongo).
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. "pickup_20260728"
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model("Counter", counterSchema);
