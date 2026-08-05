const STYLES = {
  // phleboStatus
  Unassigned: "bg-slate-100 text-slate-600",
  Assigned: "bg-amber-50 text-amber-700",
  Accepted: "bg-blue-50 text-blue-700",
  Rejected: "bg-rose-50 text-rose-700",
  "En Route": "bg-indigo-50 text-indigo-700",
  Arrived: "bg-violet-50 text-violet-700",
  "OTP Verified": "bg-cyan-50 text-cyan-700",
  "Consent Done": "bg-teal-50 text-teal-700",
  "Sample Collected": "bg-emerald-50 text-emerald-700",
  "Handed Off": "bg-green-100 text-green-800",
  // order status
  Cancelled: "bg-rose-100 text-rose-800",
  Booked: "bg-slate-100 text-slate-600",
  Processing: "bg-indigo-50 text-indigo-700",
  // paymentStatus
  Paid: "bg-emerald-50 text-emerald-700",
  Unpaid: "bg-rose-50 text-rose-700",
  // phlebo/client status
  active: "bg-emerald-50 text-emerald-700",
  inactive: "bg-slate-100 text-slate-600",
  suspended: "bg-rose-50 text-rose-700",
};

export default function Badge({ children }) {
  const cls = STYLES[children] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}
