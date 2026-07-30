export default function StatCard({ label, value, hint, accent = "brand", onClick }) {
  const accents = {
    brand: "text-brand-600 bg-brand-50",
    green: "text-emerald-600 bg-emerald-50",
    rose: "text-rose-600 bg-rose-50",
    amber: "text-amber-600 bg-amber-50",
  };
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`card p-5 text-left w-full ${
        onClick ? "cursor-pointer transition-shadow hover:shadow-md hover:border-brand-200" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        {hint ? (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${accents[accent]}`}>
            {hint}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
    </Comp>
  );
}
