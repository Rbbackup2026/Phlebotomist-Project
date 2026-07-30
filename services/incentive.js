/**
 * Incentive calculation — Ops/Admin-only (GET /admin/phlebos/:id/incentive).
 * Intentionally NOT surfaced on the phlebo app's own dashboard (GET /phlebo/job-stats
 * shows job counts only, by existing design — see that route's comment in
 * PhleboRoute.js) — this is for Ops to know what's owed, not for the phlebo to see a
 * live earnings ticker.
 *
 * Rule: ₹incentivePerJob × jobs done that day, plus a flat ₹targetBonus if the
 * phlebo's dailyTarget was met/exceeded. Both are admin-configurable per phlebo
 * (Phlebotomist.incentivePerJob / targetBonus, editable via PUT /admin/phlebos/:id).
 */
function computeIncentive(phlebo, jobsDone) {
  const perJob = Number(phlebo?.incentivePerJob) || 0;
  const bonusAmount = Number(phlebo?.targetBonus) || 0;
  const target = Number(phlebo?.dailyTarget) || 0;
  const targetReached = target > 0 && jobsDone >= target;

  const base = jobsDone * perJob;
  const bonus = targetReached ? bonusAmount : 0;

  return {
    perJob,
    jobsDone,
    base,
    bonus,
    total: base + bonus,
    target,
    targetReached,
  };
}

module.exports = { computeIncentive };
