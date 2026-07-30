const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const OpsUser = require("../Models/OpsUser");
const { verifyToken, requireRole } = require("./authMiddleware");

/** Ops admin login — Phlebo own DB (OpsUser) */
router.post("/login", async (req, res) => {
  try {
    const { email, password, keepLoggedIn } = req.body;
    if (!email || !password) {
      return res.status(400).json({ msg: "Email and password are required" });
    }

    const userdata = await OpsUser.findOne({ email: String(email).toLowerCase().trim() });
    if (!userdata) {
      return res.status(404).json({ msg: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, userdata.password);
    if (!isMatch) {
      return res.status(401).json({ msg: "Invalid password" });
    }

    if (userdata.isActive === false) {
      return res.status(403).json({ msg: "Account disabled — contact your admin" });
    }

    const expiresIn = keepLoggedIn ? "7d" : "24h";
    const token = jwt.sign(
      {
        email: userdata.email,
        id: userdata._id,
        role: userdata.role || "ops",
        city: userdata.city || "",
      },
      process.env.JWT_SECRET || "defaultSecretKey",
      { expiresIn }
    );

    const userResponse = userdata.toObject();
    delete userResponse.password;

    res.status(200).json({
      msg: "Login successful",
      userdata: userResponse,
      token,
      expiresIn,
    });
  } catch (error) {
    res.status(500).json({ msg: "Server error", error: error.message });
  }
});

/**
 * Superadmin creates a city Admin. Ek city ka ek hi admin (city field pe
 * partial-unique index Models/OpsUser.js mein lagaya hua hai) — duplicate
 * city ke liye Mongo 11000 error catch hoke friendly message deta hai.
 */
router.post("/register-admin", verifyToken, requireRole("superadmin"), async (req, res) => {
  try {
    const { email, password, name, city } = req.body || {};
    if (!email || !password || !city) {
      return res.status(400).json({ success: false, message: "email, password aur city required hain" });
    }
    const cleanCity = String(city).trim();
    if (!cleanCity) {
      return res.status(400).json({ success: false, message: "City khaali nahi ho sakta" });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const exists = await OpsUser.findOne({ email: cleanEmail });
    if (exists) {
      return res.status(400).json({ success: false, message: "Ye email pehle se registered hai" });
    }

    const admin = await OpsUser.create({
      email: cleanEmail,
      password: await bcrypt.hash(String(password), 10),
      name: name || `${cleanCity} Admin`,
      role: "admin",
      city: cleanCity,
      createdBy: req.user._id,
    });

    const response = admin.toObject();
    delete response.password;
    res.status(201).json({ success: true, message: "Admin created", admin: response });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Is city ke liye pehle se ek admin maujood hai",
      });
    }
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

/**
 * City Admin apne hi city mein ek naya Lab account banata hai — city admin ke
 * apne city se hi inherit hota hai (body mein city bhejne ki zaroorat nahi,
 * bheja bhi jaaye to ignore hota hai — ek admin doosre city mein lab nahi bana sakta).
 */
router.post("/register-lab", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "email aur password required hain" });
    }
    if (!req.user.city) {
      return res.status(400).json({ success: false, message: "Aapke account mein city set nahi hai" });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const exists = await OpsUser.findOne({ email: cleanEmail });
    if (exists) {
      return res.status(400).json({ success: false, message: "Ye email pehle se registered hai" });
    }

    const lab = await OpsUser.create({
      email: cleanEmail,
      password: await bcrypt.hash(String(password), 10),
      name: name || `${req.user.city} Lab`,
      role: "lab",
      city: req.user.city,
      createdBy: req.user._id,
    });

    const response = lab.toObject();
    delete response.password;
    res.status(201).json({ success: true, message: "Lab created", lab: response });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Ye email pehle se registered hai" });
    }
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

/** Superadmin: saare city admins ki list */
router.get("/admins", verifyToken, requireRole("superadmin"), async (_req, res) => {
  try {
    const admins = await OpsUser.find({ role: "admin" }).select("-password").sort({ city: 1 });
    res.json({ success: true, admins });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

/** City Admin: apne city ki saari labs ki list (naya order/sample assign karte waqt dropdown ke liye) */
router.get("/labs", verifyToken, requireRole("admin", "superadmin"), async (req, res) => {
  try {
    const filter = { role: "lab" };
    // Admin sirf apna city dekhega; superadmin ?city= se kisi bhi city ki labs dekh sakta hai.
    if (req.user.role === "admin") {
      filter.city = req.user.city;
    } else if (req.query.city) {
      filter.city = String(req.query.city).trim();
    }
    const labs = await OpsUser.find(filter).select("-password").sort({ name: 1 });
    res.json({ success: true, labs });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

/**
 * Superadmin: ek city admin ko activate/suspend karna (data delete/edit nahi
 * hota — sirf login block/allow hota hai). Isi se superadmin "view-only +
 * account-management" tak simit rehta hai, city ka operational data admin
 * khud hi edit karta hai.
 */
router.put("/admins/:id/status", verifyToken, requireRole("superadmin"), async (req, res) => {
  try {
    const { isActive } = req.body || {};
    const admin = await OpsUser.findOne({ _id: req.params.id, role: "admin" });
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });
    admin.isActive = !!isActive;
    await admin.save();
    res.json({ success: true, message: isActive ? "Admin activated" : "Admin suspended" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

/** Superadmin: ek city admin ka password reset karna (jab wo bhool jaaye) */
router.put("/admins/:id/reset-password", verifyToken, requireRole("superadmin"), async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ success: false, message: "Password kam se kam 6 characters ka ho" });
    }
    const admin = await OpsUser.findOne({ _id: req.params.id, role: "admin" });
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });
    admin.password = await bcrypt.hash(String(password), 10);
    await admin.save();
    res.json({ success: true, message: "Password reset ho gaya" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

/** City Admin: apne hi city ki ek lab ko activate/suspend karna */
router.put("/labs/:id/status", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const { isActive } = req.body || {};
    const lab = await OpsUser.findOne({ _id: req.params.id, role: "lab" });
    if (!lab) return res.status(404).json({ success: false, message: "Lab not found" });
    if (lab.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye lab aapke city ki nahi hai" });
    }
    lab.isActive = !!isActive;
    await lab.save();
    res.json({ success: true, message: isActive ? "Lab activated" : "Lab suspended" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

/** City Admin: apne hi city ki ek lab ka password reset karna */
router.put("/labs/:id/reset-password", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ success: false, message: "Password kam se kam 6 characters ka ho" });
    }
    const lab = await OpsUser.findOne({ _id: req.params.id, role: "lab" });
    if (!lab) return res.status(404).json({ success: false, message: "Lab not found" });
    if (lab.city !== req.user.city) {
      return res.status(403).json({ success: false, message: "Ye lab aapke city ki nahi hai" });
    }
    lab.password = await bcrypt.hash(String(password), 10);
    await lab.save();
    res.json({ success: true, message: "Password reset ho gaya" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

module.exports = router;
