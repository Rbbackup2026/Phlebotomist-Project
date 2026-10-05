/**
 * Clear ALL TRF + tube barcodes from live `phlebo.orders`.
 * Usage: node scripts/clearAllBarcodes.js
 */
require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.getClient().db("phlebo");
  const orders = db.collection("orders");

  const total = await orders.countDocuments();
  const withTrf = await orders.countDocuments({
    trfBarcode: { $exists: true, $nin: ["", null] },
  });
  const withSamples = await orders.countDocuments({ "samples.0": { $exists: true } });
  const withHandoverBc = await orders.countDocuments({
    "handover.barcodes.0": { $exists: true },
  });

  console.log("BEFORE", { db: "phlebo", total, withTrf, withSamples, withHandoverBc });

  const r1 = await orders.updateMany(
    {},
    {
      $set: {
        trfBarcode: "",
        samples: [],
      },
    }
  );

  const r2 = await orders.updateMany(
    { handover: { $type: "object" } },
    { $set: { "handover.barcodes": [] } }
  );

  const afterTrf = await orders.countDocuments({
    trfBarcode: { $exists: true, $nin: ["", null] },
  });
  const afterSamples = await orders.countDocuments({ "samples.0": { $exists: true } });
  const afterHandoverBc = await orders.countDocuments({
    "handover.barcodes.0": { $exists: true },
  });

  console.log("UPDATE", {
    matched: r1.matchedCount,
    modified: r1.modifiedCount,
    handoverModified: r2.modifiedCount,
  });
  console.log("AFTER", {
    withTrf: afterTrf,
    withSamples: afterSamples,
    withHandoverBc: afterHandoverBc,
  });

  await mongoose.disconnect();
  console.log("Done.");
})().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
