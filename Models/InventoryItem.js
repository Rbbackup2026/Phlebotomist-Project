const mongoose = require("mongoose");

/**
 * Central kit catalog — office/warehouse stock. Admin yahan se phlebos ko
 * kit assign karta hai (see KitAssignment).
 */
const inventoryItemSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    unit: { type: String, default: "pcs", trim: true },
    centralStock: { type: Number, default: 0 },
    reorderThreshold: { type: Number, default: 10 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InventoryItem", inventoryItemSchema);
