package app.playpark.parkcaddy;

/** Geometry and temporal filtering shared by the live map and host regression checks. */
final class TerrainMath {
  static final float GRID_METERS = .25f;
  static float gridMeters(int index) { return index * GRID_METERS; }
  static int gridIndex(float meters) { return Math.round(meters / GRID_METERS); }
  static float distance(int x, int z) {
    return (float) Math.hypot(gridMeters(x), gridMeters(z));
  }
  static class Estimate {
    float y, variance;
    int count = 1;
    long seen;
    Estimate(float height, long now) { y = height; seen = now; }
    boolean observe(float height, long now) {
      if (!Float.isFinite(height)) return false;
      float delta = height - y;
      if (Math.abs(delta) >= .25f) return false;
      y += .2f * delta;
      variance = .8f * variance + .2f * delta * delta;
      count++;
      seen = now;
      return true;
    }
    boolean valid(long now) { return count >= 3 && now - seen <= 15000 && variance <= .0064f; }
  }
}
