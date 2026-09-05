const mongoose = require("mongoose");

/** LIS PUPMasterData row — admin search/import. Booking still uses phlebo.lisPanelId. */
const lisPanelSchema = new mongoose.Schema(
  {
    panelId: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, default: "", trim: true, index: true },
    centreId: { type: String, default: "1", trim: true },
    referenceCode: { type: String, default: "", trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

lisPanelSchema.index({ name: "text", panelId: "text" });

module.exports = mongoose.model("LisPanel", lisPanelSchema);
