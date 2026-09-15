/**
 * Audit recent collected+paid orders vs LIS fields.
 * Usage: node scripts/auditLisBookings.js
 */
require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const client = mongoose.connection.getClient();
  for (const dbName of ["phlebo", "phlebo_local"]) {
    const orders = client.db(dbName).collection("orders");
    const paidCollected = await orders
      .find({
        paymentStatus: "Paid",
        phleboStatus: { $in: ["Sample Collected", "Handed Off"] },
      })
      .project({
        pickupId: 1,
        patientName: 1,
        phleboStatus: 1,
        paymentStatus: 1,
        paymentCollectedMethod: 1,
        paymentCollectedAt: 1,
        collectedAt: 1,
        lisBookingStatus: 1,
        lisLedgerNo: 1,
        lisBookingError: 1,
        lisBookedAt: 1,
      })
      .sort({ paymentCollectedAt: -1, collectedAt: -1 })
      .limit(20)
      .toArray();

    const counts = {
      db: dbName,
      paidCollected: paidCollected.length,
      success: paidCollected.filter((o) => o.lisBookingStatus === "success").length,
      withLedger: paidCollected.filter((o) => String(o.lisLedgerNo || "").trim()).length,
      failed: paidCollected.filter((o) => o.lisBookingStatus === "failed").length,
      empty: paidCollected.filter((o) => !o.lisBookingStatus).length,
    };
    const recent = paidCollected.slice(0, 8).map((o) => ({
      pickupId: o.pickupId,
      patientName: o.patientName,
      pay: o.paymentCollectedMethod,
      payAt: o.paymentCollectedAt,
      lisAt: o.lisBookedAt,
      lis: o.lisBookingStatus || "(none)",
      ledger: o.lisLedgerNo || "",
      err: o.lisBookingError || "",
    }));
    console.log(JSON.stringify({ counts, recent }, null, 2));
  }
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
