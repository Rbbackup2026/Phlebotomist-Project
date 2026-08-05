const express = require("express");
const router = express.Router();
const Job = require("../Models/Job");
const Phlebotomist = require("../Models/Phlebotomist");

/**
 * Patient-facing tracking (no login) — keyed by the opaque trackingToken generated at
 * order creation (see services/pickupId.js). Never exposes the phlebo's phone/exact
 * location, only a human-friendly status. This backend doesn't own a patient app of
 * its own — these endpoints exist so the partner website (Wello/others) can build a
 * "track your pickup" page, or the link can be shared directly via SMS.
 */

const STATUS_LABELS = {
  Unassigned: "Booking confirmed — assigning a phlebotomist",
  Assigned: "Phlebotomist assigned",
  Accepted: "Phlebotomist is preparing to head your way",
  Rejected: "Rescheduling — Ops will reach out shortly",
  "En Route": "Phlebotomist is on the way",
  Arrived: "Phlebotomist has arrived",
  "OTP Verified": "Identity verified",
  "Consent Done": "Sample collection in progress",
  "Sample Collected": "Sample collected",
  "Handed Off": "Sample received at the lab",
};

router.get("/track/:token", async (req, res) => {
  try {
    const order = await Job.findOne({ trackingToken: req.params.token });
    if (!order) {
      return res.status(404).json({ success: false, message: "Tracking link not found" });
    }
    res.json({
      success: true,
      pickupId: order.pickupId || String(order._id).slice(-8).toUpperCase(),
      status:
        order.status === "Cancelled"
          ? "Visit cancelled — Ops will reach out if needed"
          : STATUS_LABELS[order.phleboStatus] || order.phleboStatus,
      phleboStatus: order.phleboStatus,
      orderStatus: order.status,
      slotDate: order.slotDate,
      slotTime: order.slotTime,
      assignedPhleboName: order.assignedPhleboName || "",
      amount: order.totalAmount,
      paymentStatus: order.paymentStatus,
      reportReadyAt: order.reportReadyAt || null,
      collectedAt: order.collectedAt || null,
      rating: order.rating && order.rating.stars ? order.rating : null,
      rescheduleRequested: !!order.rescheduleRequested,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Patient rating + feedback — only once the sample's actually been collected. */
router.post("/track/:token/rate", async (req, res) => {
  try {
    const { stars, comment } = req.body || {};
    const s = Number(stars);
    if (!Number.isFinite(s) || s < 1 || s > 5) {
      return res.status(400).json({ success: false, message: "stars must be 1-5" });
    }

    const order = await Job.findOne({ trackingToken: req.params.token });
    if (!order) {
      return res.status(404).json({ success: false, message: "Tracking link not found" });
    }
    if (!["Sample Collected", "Handed Off"].includes(order.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message: "Rating sirf collection complete hone ke baad di ja sakti hai",
      });
    }
    if (order.rating && order.rating.stars) {
      return res.status(400).json({ success: false, message: "Already rated — thanks!" });
    }

    order.rating = {
      stars: s,
      comment: String(comment || "").slice(0, 500),
      ratedAt: new Date(),
    };
    await order.save();

    // Phlebo ki running rating average update — koi alag ratings-history collection
    // nahi rakhi, isliye ye approximate running mean hai (ratingCount ke against).
    if (order.assignedPhlebo) {
      const phlebo = await Phlebotomist.findById(order.assignedPhlebo);
      if (phlebo) {
        const prevRating = phlebo.rating || 5;
        const prevCount = phlebo.ratingCount || 0;
        const newCount = prevCount + 1;
        phlebo.rating = Math.round(((prevRating * prevCount + s) / newCount) * 10) / 10;
        phlebo.ratingCount = newCount;
        await phlebo.save();
      }
    }

    res.json({ success: true, message: "Thanks for the feedback!" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Patient-initiated reschedule request — flags the order for Ops, doesn't move the
 *  slot automatically (Admin does that via PUT /admin/orders/:id/reschedule once
 *  they've actually spoken to the patient about a new time). */
router.post("/track/:token/reschedule-request", async (req, res) => {
  try {
    const { note } = req.body || {};
    const order = await Job.findOne({ trackingToken: req.params.token });
    if (!order) {
      return res.status(404).json({ success: false, message: "Tracking link not found" });
    }
    const LOCKED_STATUSES = ["Sample Collected", "Handed Off"];
    if (LOCKED_STATUSES.includes(order.phleboStatus)) {
      return res.status(400).json({
        success: false,
        message: "Ye order pehle se complete ho chuka hai — reschedule nahi ho sakta",
      });
    }
    order.rescheduleRequested = true;
    order.rescheduleRequestedAt = new Date();
    order.rescheduleRequestNote = String(note || "").slice(0, 500);
    await order.save();
    res.json({
      success: true,
      message: "Reschedule request bhej di gayi — Ops jaldi contact karegi",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
