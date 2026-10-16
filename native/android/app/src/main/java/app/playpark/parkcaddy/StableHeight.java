package app.playpark.parkcaddy;

import java.util.Arrays;

/**
 * Bounded, time-based repeatability filter. NOT a calibrated accuracy bound.
 * Keeps actual observations, not interpolated data. Both the full window and
 * recent observations must pass the original noise gates. A long motion history
 * therefore cannot conceal a recent height change.
 */
final class StableHeight {
  static final int MIN_SAMPLES = 7;
  static final long MIN_DURATION_MS = 1200, WINDOW_MS = 5000;
  static final float MIN_BASELINE_M = .08f, MAX_MAD_M = .025f;
  private static final int CAPACITY = 64, RECENT = 9;
  private final float[] heights = new float[CAPACITY], xs = new float[CAPACITY],
      ys = new float[CAPACITY], zs = new float[CAPACITY];
  private final long[] times = new long[CAPACITY];
  private int size, conflicts;
  private long lastInput = -1;
  float y, scatter, lastBaseline;
  long seen, lastObservation;
  boolean published, uncertain;
  private boolean requiresRevalidation;
  String decision = "insufficient_samples";

  int observationCount() { return size; }
  long observationDurationMs() {
    return size == 0 ? 0 : Math.max(0, lastInput - times[0]);
  }

  boolean observe(float h, long now, float x, float vertical, float z) {
    if (!Float.isFinite(h) || !Float.isFinite(x) || !Float.isFinite(vertical)
        || !Float.isFinite(z) || now < 0 || now <= lastInput) return false;
    // Expired data is never used to fulfil the time or translation gate.
    while (size > 0 && now - times[0] > WINDOW_MS) removeFirst();
    if (size == 0 && published) {
      // Keep the previous accepted height for contradiction checking, but do not
      // permit it to become valid again without a new complete observation window.
      requiresRevalidation = true;
    }
    if (size == CAPACITY) removeFirst();
    lastInput = lastObservation = now;
    heights[size] = h; xs[size] = x; ys[size] = vertical; zs[size] = z;
    times[size++] = now;
    lastBaseline = baseline();
    if (size < MIN_SAMPLES) { decision = "insufficient_samples"; return false; }

    Stats recent = stats(Math.max(0, size - RECENT), size);
    // Test recent disagreement before the whole-window median can mask it.
    if (published && Math.abs(recent.median - y) > .06f) {
      decision = "disagreement";
      if (++conflicts >= 3) uncertain = true;
      return false;
    }
    Stats all = stats(0, size);
    if (observationDurationMs() < MIN_DURATION_MS) {
      decision = "insufficient_duration"; return false;
    }
    if (lastBaseline < MIN_BASELINE_M) {
      decision = "translation_required"; return false;
    }
    if (!all.stable() || !recent.stable()
        || Math.abs(all.median - recent.median) > .06f) {
      decision = "unstable_height"; return false;
    }
    // One new contradictory sample must not refresh a stale accepted value.
    if (Math.abs(h - recent.median) > .06f) {
      decision = "recent_outlier"; return false;
    }
    decision = "accepted";
    y = published ? y + .08f * (recent.median - y) : recent.median;
    scatter = Math.max(all.mad, recent.mad);
    published = true; requiresRevalidation = false; uncertain = false; conflicts = 0; seen = now;
    return true;
  }

  private void removeFirst() {
    if (size == 0) return;
    --size;
    System.arraycopy(heights, 1, heights, 0, size);
    System.arraycopy(xs, 1, xs, 0, size);
    System.arraycopy(ys, 1, ys, 0, size);
    System.arraycopy(zs, 1, zs, 0, size);
    System.arraycopy(times, 1, times, 0, size);
  }
  private float baseline() {
    float squared = 0;
    for (int i = 0; i < size; i++) for (int j = 0; j < i; j++) {
      float dx = xs[i] - xs[j], dy = ys[i] - ys[j], dz = zs[i] - zs[j];
      squared = Math.max(squared, dx * dx + dy * dy + dz * dz);
    }
    return (float) Math.sqrt(squared);
  }
  private Stats stats(int from, int to) {
    float[] ordered = Arrays.copyOfRange(heights, from, to);
    Arrays.sort(ordered);
    float median = ordered[ordered.length / 2];
    float[] dev = new float[ordered.length];
    for (int i = 0; i < dev.length; i++) dev[i] = Math.abs(ordered[i] - median);
    Arrays.sort(dev);
    return new Stats(median, dev[dev.length / 2],
        ordered[ordered.length - 2] - ordered[1]);
  }
  private static final class Stats {
    final float median, mad, trimmedRange;
    Stats(float median, float mad, float trimmedRange) {
      this.median = median; this.mad = mad; this.trimmedRange = trimmedRange;
    }
    boolean stable() { return mad <= MAX_MAD_M && trimmedRange <= .08f; }
  }
  boolean valid() { return published && !uncertain && !requiresRevalidation; }
  float deadband(float distance) { return Math.max(.05f, 3 * scatter + .005f * distance); }
}
