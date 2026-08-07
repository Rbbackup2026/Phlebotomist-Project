const express = require("express");
const router = express.Router();
const Ticket = require("../Models/Ticket");
const Counter = require("../Models/Counter");
const { verifyToken, requireRole } = require("./authMiddleware");

const CATEGORIES = ["orders", "payments", "kits", "phlebos", "login", "bug", "other"];
const PRIORITIES = ["low", "medium", "high"];
const STATUSES = ["open", "in_progress", "resolved", "closed"];

function dayKeyOf(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function nextTicketNo() {
  const dayKey = dayKeyOf();
  const counter = await Counter.findOneAndUpdate(
    { _id: `ticket_${dayKey}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const seq = String(counter.seq).padStart(3, "0");
  return `TCK-${dayKey}-${seq}`;
}

function canAccessTicket(user, ticket) {
  if (user.role === "superadmin") return true;
  if (user.role === "admin") {
    return String(ticket.createdBy) === String(user._id);
  }
  return false;
}

/** City Admin creates a support ticket (visible to Superadmin). */
router.post(
  "/admin/tickets",
  verifyToken,
  requireRole("admin"),
  async (req, res) => {
    try {
      const subject = String(req.body.subject || "").trim();
      const description = String(req.body.description || "").trim();
      const category = CATEGORIES.includes(req.body.category) ? req.body.category : "other";
      const priority = PRIORITIES.includes(req.body.priority) ? req.body.priority : "medium";
      const relatedOrderId = String(req.body.relatedOrderId || "").trim();

      if (!subject || !description) {
        return res.status(400).json({
          success: false,
          message: "Subject and description are required",
        });
      }
      if (!req.user.city) {
        return res.status(400).json({
          success: false,
          message: "City Admin must have a city assigned",
        });
      }

      const ticketNo = await nextTicketNo();
      const ticket = await Ticket.create({
        ticketNo,
        createdBy: req.user._id,
        city: req.user.city,
        category,
        priority,
        subject,
        description,
        relatedOrderId,
        status: "open",
        messages: [
          {
            by: req.user._id,
            byName: req.user.name || req.user.email,
            byRole: req.user.role,
            text: description,
          },
        ],
      });

      return res.status(201).json({ success: true, ticket });
    } catch (err) {
      console.error("[tickets create]", err);
      return res.status(500).json({ success: false, message: "Failed to create ticket" });
    }
  }
);

/**
 * List tickets:
 *   admin      → own tickets only
 *   superadmin → all (optional ?city=&status=)
 */
router.get(
  "/admin/tickets",
  verifyToken,
  requireRole("superadmin", "admin"),
  async (req, res) => {
    try {
      const filter = {};
      if (req.user.role === "admin") {
        filter.createdBy = req.user._id;
      } else {
        if (req.query.city) filter.city = String(req.query.city).trim();
        if (req.query.status && STATUSES.includes(req.query.status)) {
          filter.status = req.query.status;
        }
      }
      if (req.user.role === "admin" && req.query.status && STATUSES.includes(req.query.status)) {
        filter.status = req.query.status;
      }

      const tickets = await Ticket.find(filter)
        .sort({ updatedAt: -1 })
        .select("-messages")
        .limit(200)
        .lean();

      return res.json({ success: true, tickets });
    } catch (err) {
      console.error("[tickets list]", err);
      return res.status(500).json({ success: false, message: "Failed to load tickets" });
    }
  }
);

router.get(
  "/admin/tickets/:id",
  verifyToken,
  requireRole("superadmin", "admin"),
  async (req, res) => {
    try {
      const ticket = await Ticket.findById(req.params.id).lean();
      if (!ticket) {
        return res.status(404).json({ success: false, message: "Ticket not found" });
      }
      if (!canAccessTicket(req.user, ticket)) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      return res.json({ success: true, ticket });
    } catch (err) {
      console.error("[tickets get]", err);
      return res.status(500).json({ success: false, message: "Failed to load ticket" });
    }
  }
);

/** Both sides can reply; closed tickets reject new messages. */
router.post(
  "/admin/tickets/:id/messages",
  verifyToken,
  requireRole("superadmin", "admin"),
  async (req, res) => {
    try {
      const text = String(req.body.text || "").trim();
      if (!text) {
        return res.status(400).json({ success: false, message: "Message text is required" });
      }

      const ticket = await Ticket.findById(req.params.id);
      if (!ticket) {
        return res.status(404).json({ success: false, message: "Ticket not found" });
      }
      if (!canAccessTicket(req.user, ticket)) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      if (ticket.status === "closed") {
        return res.status(400).json({
          success: false,
          message: "Ticket is closed — reopen it before replying",
        });
      }

      ticket.messages.push({
        by: req.user._id,
        byName: req.user.name || req.user.email,
        byRole: req.user.role,
        text,
      });

      // City admin reply on a resolved ticket → reopen to open
      if (req.user.role === "admin" && ticket.status === "resolved") {
        ticket.status = "open";
        ticket.closedAt = null;
      }
      // Superadmin first reply often means work started
      if (req.user.role === "superadmin" && ticket.status === "open") {
        ticket.status = "in_progress";
      }

      await ticket.save();
      return res.json({ success: true, ticket });
    } catch (err) {
      console.error("[tickets message]", err);
      return res.status(500).json({ success: false, message: "Failed to add message" });
    }
  }
);

/** Superadmin only — status transitions. */
router.patch(
  "/admin/tickets/:id/status",
  verifyToken,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const status = req.body.status;
      if (!STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Use: ${STATUSES.join(", ")}`,
        });
      }

      const ticket = await Ticket.findById(req.params.id);
      if (!ticket) {
        return res.status(404).json({ success: false, message: "Ticket not found" });
      }

      ticket.status = status;
      ticket.closedAt = status === "closed" || status === "resolved" ? new Date() : null;
      await ticket.save();

      return res.json({ success: true, ticket });
    } catch (err) {
      console.error("[tickets status]", err);
      return res.status(500).json({ success: false, message: "Failed to update status" });
    }
  }
);

module.exports = router;
