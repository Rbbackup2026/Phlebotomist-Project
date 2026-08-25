const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Phlebotomist = require("../Models/Phlebotomist");
const { getJwtSecret } = require("../services/securityConfig");

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicPhlebo(p) {
  return {
    id: p._id,
    role: "phlebo",
    name: p.name,
    phone: p.phone,
    employeeId: p.employeeId,
    dutyStatus: p.dutyStatus,
    zone: p.zone,
    city: p.city,
    rating: p.rating,
  };
}

/** Phlebo field login (employee ID + password). Driver login is on AmbulanceBackend. */
router.post("/field/auth/login", async (req, res) => {
  try {
    const employeeId = String(req.body.employeeId || "").trim();
    const password = String(req.body.password || "");
    if (!employeeId || !password) {
      return res.status(400).json({
        success: false,
        message: "Employee ID and password required",
      });
    }

    const phlebo = await Phlebotomist.findOne({
      employeeId: { $regex: `^${escapeRegex(employeeId)}$`, $options: "i" },
    });
    if (!phlebo) {
      return res.status(401).json({ success: false, message: "Invalid ID or password" });
    }
    if (phlebo.status !== "active") {
      return res.status(403).json({ success: false, message: "Account inactive — contact admin" });
    }
    if (!phlebo.passwordHash) {
      return res.status(400).json({
        success: false,
        message: "Password not set. Use OTP login, or ask admin to set a password.",
      });
    }
    const ok = await bcrypt.compare(password, phlebo.passwordHash);
    if (!ok) {
      return res.status(401).json({ success: false, message: "Invalid ID or password" });
    }
    const token = jwt.sign(
      { id: phlebo._id, role: "phlebo", phone: phlebo.phone },
      getJwtSecret(),
      { expiresIn: "30d" }
    );
    return res.json({
      success: true,
      token,
      role: "phlebo",
      user: publicPhlebo(phlebo),
      phlebo: publicPhlebo(phlebo),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
