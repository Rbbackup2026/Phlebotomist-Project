export default function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-md",
  fullscreen = false,
  onToggleFullscreen,
}) {
  if (!open) return null;
  return (
    <div
      className={`fixed inset-0 z-50 flex ${
        fullscreen ? "items-stretch" : "items-center justify-center p-4"
      }`}
    >
      {fullscreen ? null : <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />}
      <div
        className={
          fullscreen
            ? "relative flex h-full w-full max-w-none flex-col bg-white"
            : `relative w-full ${width} card max-h-[90vh] overflow-y-auto p-6`
        }
      >
        <div
          className={`flex items-center justify-between gap-3 ${
            fullscreen ? "shrink-0 border-b border-slate-100 px-6 py-4" : "mb-4"
          }`}
        >
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <div className="flex items-center gap-1">
            {onToggleFullscreen ? (
              <button
                type="button"
                onClick={onToggleFullscreen}
                className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-600 hover:bg-slate-100"
              >
                {fullscreen ? "Exit full screen" : "Full screen"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
        </div>
        {fullscreen ? <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div> : children}
      </div>
    </div>
  );
}
