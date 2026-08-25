const Phlebotomist = require("../Models/Phlebotomist");

async function assertFieldIdentityFree({ employeeId, phone, exclude = {} }) {
  const id = employeeId ? String(employeeId).trim() : "";
  const mobile = phone ? String(phone).trim() : "";

  if (id) {
    const phleboId = await Phlebotomist.findOne({ employeeId: id }).select("_id");
    if (phleboId && String(phleboId._id) !== String(exclude.phleboId || "")) {
      const err = new Error("Employee ID already used by a phlebotomist");
      err.status = 400;
      throw err;
    }
  }

  if (mobile) {
    const phleboPhone = await Phlebotomist.findOne({ phone: mobile }).select("_id");
    if (phleboPhone && String(phleboPhone._id) !== String(exclude.phleboId || "")) {
      const err = new Error("Phone already registered as a phlebotomist");
      err.status = 400;
      throw err;
    }
  }
}

module.exports = { assertFieldIdentityFree };
