const rateLimit = require("express-rate-limit");

/** Auth endpoints — login / OTP brute-force protection */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many auth attempts. Try again in 15 minutes.",
  },
});

/** Stricter OTP send — SMS/OTP abuse */
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests. Try again later.",
  },
});

/** Partner job create / API key abuse */
const partnerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Rate limit exceeded for partner API.",
  },
});

/** Public tracking mutations */
const publicMutateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Try again later.",
  },
});

module.exports = {
  authLimiter,
  otpSendLimiter,
  partnerLimiter,
  publicMutateLimiter,
};
