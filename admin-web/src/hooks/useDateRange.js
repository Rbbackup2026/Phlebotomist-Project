import { useState } from "react";

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

export function presetToRange(key) {
  const today = new Date();
  if (key === "all") return { from: "", to: "" };
  if (key === "today") return { from: ymd(today), to: ymd(today) };
  const days = key === "7d" ? 7 : 30;
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  return { from: ymd(from), to: ymd(today) };
}

/** Shared date-range state used by Dashboard, Payments, Added Tests, etc. */
export function useDateRange(defaultPreset = "30d") {
  const [preset, setPresetState] = useState(defaultPreset);
  const [range, setRange] = useState(presetToRange(defaultPreset));

  function applyPreset(key) {
    setPresetState(key);
    setRange(presetToRange(key));
  }

  function setCustom(next) {
    setPresetState("custom");
    setRange(next);
  }

  return { preset, range, applyPreset, setCustom };
}
