const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
];

export default function DateRangeBar({ preset, range, onPreset, onCustom, trailing }) {
  return (
    <div className="card p-4 flex flex-wrap items-center gap-3">
      <div className="flex gap-1.5 flex-wrap">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onPreset(p.key)}
            className={`text-sm font-medium rounded-lg px-3 py-1.5 transition-colors ${
              preset === p.key
                ? "bg-brand-500 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="date"
          className="input w-40"
          value={range.from}
          max={range.to || undefined}
          onChange={(e) => onCustom({ ...range, from: e.target.value })}
        />
        <span className="text-slate-400 text-sm">to</span>
        <input
          type="date"
          className="input w-40"
          value={range.to}
          min={range.from || undefined}
          onChange={(e) => onCustom({ ...range, to: e.target.value })}
        />
      </div>
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
