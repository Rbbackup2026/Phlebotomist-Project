const jwt = require("jsonwebtoken");
const OpsUser = require("../Models/OpsUser");
const { getJwtSecret } = require("../services/securityConfig");

const getBearerToken = (req) => {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim();
  return "";
};

const verifyToken = async (req, res, next) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Send Authorization: Bearer <token>.",
      });
    }

    const decoded = jwt.verify(token, getJwtSecret());
    const user = await OpsUser.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    req.user = user;
    req.token = token;
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token. Please login again.",
    });
  }
};

/**
 * Role guard — route par lagao jab sirf specific role(s) ko allow karna ho.
 * Hamesha verifyToken ke BAAD lagana (req.user chahiye).
 *   router.post("/register-admin", verifyToken, requireRole("superadmin"), handler)
 */
const requireRole = (...roles) => {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires role: ${allowed.join(" or ")}`,
      });
    }
    next();
  };
};

/**
 * City/lab data-scoping — verifyToken ke baad lagao, req.scopeFilter mein ek
 * mongo filter fragment de deta hai jo caller apne query mein merge kar sake:
 *   superadmin → {}                    (sab cities)
 *   admin      → { city: user.city }   (sirf apna city)
 *   lab        → { assignedLab: id }   (sirf apne assign kiye orders)
 * Ye sirf filter banata hai, khud query nahi chalata — har route apni Job/Order
 * query mein `{ ...req.scopeFilter, ...otherFilters }` merge kare.
 */
const attachScope = (req, _res, next) => {
  const user = req.user;
  if (!user) return next();
  if (user.role === "superadmin") {
    req.scopeFilter = {};
  } else if (user.role === "admin") {
    req.scopeFilter = { city: user.city };
  } else if (user.role === "lab") {
    req.scopeFilter = { assignedLab: user._id };
  } else {
    req.scopeFilter = {};
  }
  next();
};

module.exports = { verifyToken, requireRole, attachScope };
