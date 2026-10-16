/**
 * Metric terrain aggregation. All world positions/distances are metres.
 * Repeat dispersion is NOT absolute accuracy or an independent-sample CI.
 * Grid cells retain measured positions (no invented/interpolated elevations).
 */
export const TERRAIN_DEFAULTS = Object.freeze({
  gridSpacingM: 0.25,
  minSamples: 7,
  minSpanMs: 1200,
  minBaselineM: 0.08,
  maxMadM: 0.025,
  maxAgeMs: 1200,
  retentionMs: 8000,
  maxSamples: 24,
  maxCells: 800,
  minRangeM: 0.4,
  maxRangeM: 5,
  minCells: 9,
});
const finite = (v) => typeof v === "number" && Number.isFinite(v);
export function median(values) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y),
    n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
export function dispersion(values) {
  const centre = median(values);
  return {
    median: centre,
    mad:
      centre === null ? null : median(values.map((x) => Math.abs(x - centre))),
  };
}
export function transform4(matrix, vector) {
  return [0, 1, 2, 3].map(
    (r) =>
      matrix[r] * vector[0] +
      matrix[4 + r] * vector[1] +
      matrix[8 + r] * vector[2] +
      matrix[12 + r] * vector[3],
  );
}
export function invert4(matrix) {
  if (!matrix || matrix.length !== 16 || !Array.from(matrix).every(finite))
    return null;
  const rows = [0, 1, 2, 3].map((r) => [
    ...[0, 1, 2, 3].map((c) => matrix[c * 4 + r]),
    ...[0, 1, 2, 3].map((c) => Number(r === c)),
  ]);
  for (let c = 0; c < 4; c++) {
    let pivot = c;
    for (let r = c + 1; r < 4; r++)
      if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r;
    if (Math.abs(rows[pivot][c]) < 1e-12) return null;
    [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
    const scale = rows[c][c];
    rows[c] = rows[c].map((v) => v / scale);
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const factor = rows[r][c];
      rows[r] = rows[r].map((v, k) => v - factor * rows[c][k]);
    }
  }
  return [0, 1, 2, 3].flatMap((c) => [0, 1, 2, 3].map((r) => rows[r][4 + c]));
}
/**
 * WebXR getDepthInMeters accepts normalized VIEW coordinates and internally
 * applies normDepthBufferFromNormView. Its depth is axial, not ray length.
 * W3C: https://www.w3.org/TR/webxr-depth-sensing-1/#interpreting-the-results
 */
export function unprojectDepth({
  u,
  v,
  depthM,
  inverseProjection,
  worldFromView,
}) {
  if (
    ![u, v, depthM].every(finite) ||
    u < 0 ||
    u > 1 ||
    v < 0 ||
    v > 1 ||
    depthM <= 0 ||
    !inverseProjection ||
    !worldFromView
  )
    return null;
  const h = transform4(inverseProjection, [2 * u - 1, 1 - 2 * v, -1, 1]);
  if (!h.every(finite) || Math.abs(h[3]) < 1e-12) return null;
  const ray = h.slice(0, 3).map((x) => x / h[3]);
  if (ray[2] >= -1e-9) return null;
  const scale = depthM / -ray[2];
  const world = transform4(worldFromView, [
    ray[0] * scale,
    ray[1] * scale,
    -depthM,
    1,
  ]);
  if (!world.every(finite) || Math.abs(world[3]) < 1e-12) return null;
  return {
    x: world[0] / world[3],
    y: world[1] / world[3],
    z: world[2] / world[3],
  };
}
export function projectWorld(point, projection, viewFromWorld) {
  const clip = transform4(
    projection,
    transform4(viewFromWorld, [point.x, point.y, point.z, 1]),
  );
  if (!clip.every(finite) || clip[3] <= 0) return null;
  const ndc = clip.slice(0, 3).map((x) => x / clip[3]);
  if (ndc[2] < -1 || ndc[2] > 1) return null;
  return { screenX: (ndc[0] + 1) / 2, screenY: (1 - ndc[1]) / 2 };
}
export function horizontalNormal(a, b, c) {
  if (!a || !b || !c) return 0;
  const u = [b.x - a.x, b.y - a.y, b.z - a.z],
    v = [c.x - a.x, c.y - a.y, c.z - a.z];
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const length = Math.hypot(...n);
  return length > 1e-8 ? Math.abs(n[1]) / length : 0;
}
function baseline(samples) {
  let maximum = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      // Horizontal translation avoids giving progress for phone rotation.
      maximum = Math.max(
        maximum,
        Math.hypot(
          samples[i].camera.x - samples[j].camera.x,
          samples[i].camera.z - samples[j].camera.z,
        ),
      );
    }
  }
  return maximum;
}
export class TerrainAccumulator {
  constructor(options = {}) {
    this.options = { ...TERRAIN_DEFAULTS, ...options };
    this.reset();
  }
  reset() {
    this.cells = new Map();
    this.lastTimestamp = -Infinity;
    this.frameIds = new Set();
    this.observedFrames = 0;
    this.reference = null;
  }
  setReference(reference) {
    if (!reference || ![reference.x, reference.y, reference.z].every(finite))
      throw new TypeError("유효한 지면 기준점이 필요합니다.");
    this.reset();
    this.reference = { ...reference };
  }
  observe({ timestamp, frameId, camera, points }) {
    if (
      !this.reference ||
      !finite(timestamp) ||
      timestamp <= this.lastTimestamp ||
      !camera ||
      ![camera.x, camera.y, camera.z].every(finite) ||
      !Array.isArray(points)
    )
      return false;
    this.lastTimestamp = timestamp;
    // A repeated native buffer must not become a new statistical observation.
    if (frameId == null || this.frameIds.has(frameId)) return false;
    this.frameIds.add(frameId);
    if (this.frameIds.size > 64)
      this.frameIds.delete(this.frameIds.values().next().value);
    const grouped = new Map(),
      o = this.options;
    for (const p of points) {
      if (!p || ![p.x, p.y, p.z].every(finite)) continue;
      const range = Math.hypot(p.x - camera.x, p.y - camera.y, p.z - camera.z);
      if (
        range < o.minRangeM ||
        range > o.maxRangeM ||
        p.y > camera.y - 0.25 ||
        Math.abs(p.y - this.reference.y) > 0.65
      )
        continue;
      const gridX = Math.round((p.x - this.reference.x) / o.gridSpacingM),
        gridZ = Math.round((p.z - this.reference.z) / o.gridSpacingM);
      const id = gridX + ":" + gridZ;
      if (!grouped.has(id)) grouped.set(id, { gridX, gridZ, points: [] });
      grouped.get(id).points.push(p);
    }
    if (!grouped.size) return false;
    this.observedFrames++;
    for (const [id, group] of grouped) {
      let cell = this.cells.get(id);
      if (!cell) {
        if (this.cells.size >= o.maxCells) continue;
        cell = { id, gridX: group.gridX, gridZ: group.gridZ, samples: [] };
        this.cells.set(id, cell);
      }
      // One observation per world cell per distinct depth frame, regardless of
      // how many image pixels map into that cell.
      cell.samples = cell.samples.filter(
        (s) => timestamp - s.timestamp <= o.retentionMs,
      );
      cell.samples.push({
        x: median(group.points.map((p) => p.x)),
        y: median(group.points.map((p) => p.y)),
        z: median(group.points.map((p) => p.z)),
        timestamp,
        camera: { ...camera },
      });
      if (cell.samples.length > o.maxSamples) cell.samples.shift();
    }
    for (const [id, cell] of this.cells) {
      if (timestamp - cell.samples.at(-1).timestamp > o.retentionMs)
        this.cells.delete(id);
    }
    return true;
  }
  snapshot(now, camera) {
    const o = this.options,
      points = [];
    let bestProgress = 0,
      bestSamples = 0,
      bestBaselineM = 0,
      bestSpanMs = 0;
    for (const cell of this.cells.values()) {
      const samples = cell.samples.filter(
        (s) => now - s.timestamp <= o.retentionMs,
      );
      if (!samples.length || now - samples.at(-1).timestamp > o.maxAgeMs)
        continue;
      const stats = dispersion(samples.map((s) => s.y));
      // Reject gross temporal outliers before reporting the median; the MAD
      // itself is a repeatability statistic, never a sensor accuracy bound.
      const cutoff = Math.max(0.015, 3 * 1.4826 * stats.mad);
      const accepted = samples.filter(
        (s) => Math.abs(s.y - stats.median) <= cutoff,
      );
      if (!accepted.length || now - accepted.at(-1).timestamp > o.maxAgeMs)
        continue;
      const stable = dispersion(accepted.map((s) => s.y));
      const span = accepted.at(-1).timestamp - accepted[0].timestamp,
        move = baseline(accepted);
      const ratio = Math.min(
        accepted.length / o.minSamples,
        span / o.minSpanMs,
        move / o.minBaselineM,
        1,
      );
      if (ratio >= bestProgress) {
        bestProgress = ratio;
        bestSamples = accepted.length;
        bestBaselineM = move;
        bestSpanMs = span;
      }
      if (
        accepted.length < o.minSamples ||
        span < o.minSpanMs ||
        move < o.minBaselineM ||
        stable.mad > o.maxMadM ||
        accepted.length / samples.length < 0.7
      )
        continue;
      const x = median(accepted.map((s) => s.x)),
        y = stable.median,
        z = median(accepted.map((s) => s.z));
      points.push({
        id: cell.id,
        gridX: cell.gridX,
        gridZ: cell.gridZ,
        x,
        y,
        z,
        worldX: x,
        worldY: y,
        worldZ: z,
        elevationM: y - this.reference.y,
        rangeM: camera ? Math.hypot(x - camera.x, z - camera.z) : null,
        madM: stable.mad,
        samples: accepted.length,
        baselineM: move,
        spanMs: span,
        frameTimestamp: accepted.at(-1).timestamp,
      });
    }
    const byId = new Map(points.map((p) => [p.id, p])),
      segments = [];
    for (const p of points) {
      for (const id of [
        p.gridX + 1 + ":" + p.gridZ,
        p.gridX + ":" + (p.gridZ + 1),
      ]) {
        const next = byId.get(id);
        // No line across a missing cell, vertical obstacle or depth discontinuity.
        if (
          next &&
          Math.abs(next.y - p.y) <= 0.18 &&
          Math.hypot(next.x - p.x, next.z - p.z) <= o.gridSpacingM * 1.7
        )
          segments.push({ from: p.id, to: id });
      }
    }
    const ready =
      points.length >= o.minCells && segments.length >= o.minCells - 1;
    return {
      points,
      segments,
      ready,
      observedFrames: this.observedFrames,
      acceptedCells: points.length,
      observedSamples: bestSamples,
      baselineM: bestBaselineM,
      spanMs: bestSpanMs,
      progress: ready
        ? 1
        : Math.min(
            0.95,
            bestProgress * 0.85 +
              Math.min(points.length / o.minCells, 1) * 0.15,
          ),
      requiredFrames: o.minSamples,
      requiredBaselineM: o.minBaselineM,
      requiredSpanMs: o.minSpanMs,
      gridSpacingM: o.gridSpacingM,
    };
  }
}
