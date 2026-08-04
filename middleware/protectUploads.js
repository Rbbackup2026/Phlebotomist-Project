const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("../services/securityConfig");

/**
 * Protect /uploads/* — sample/consent/TRF photos are PHI.
 * Accepts Authorization: Bearer <jwt> OR ?token=<jwt> (Image tags can't set headers).
 * Valid roles: phlebo | ops roles (any OpsUser JWT without role=phlebo check).
 */
function protectUploads(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const token = bearer || String(req.query.token || "").trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required to access uploads",
      });
    }

    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || !decoded.id) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }
    // Attach lightly for logging; static handler doesn't need full user load.
    req.mediaUser = decoded;
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token for media access",
    });
  }
}

module.exports = { protectUploads };
