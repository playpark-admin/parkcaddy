export function summarizeAngles(samples, now = Date.now()) {
  const values = samples
    .filter(
      (s) =>
        Number.isFinite(s.angleDeg) &&
        now - s.timestamp >= 0 &&
        now - s.timestamp <= 5000,
    )
    .map((s) => s.angleDeg)
    .sort((a, b) => a - b);
  const median = (v) =>
    v.length % 2
      ? v[(v.length - 1) / 2]
      : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  if (!values.length) return { count: 0, medianDeg: null, madDeg: null };
  const center = median(values);
  return {
    count: values.length,
    medianDeg: center,
    madDeg: median(
      values.map((v) => Math.abs(v - center)).sort((a, b) => a - b),
    ),
  };
}
