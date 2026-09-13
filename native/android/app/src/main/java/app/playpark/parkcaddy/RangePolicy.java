package app.playpark.parkcaddy;

/** Sparse concentric grids keep the 150 m reference view bounded in cost. */
final class RangePolicy {
  static final int[] LIMITS = {24, 80, 200, 600};
  static final int[] STEPS = {1, 4, 20, 40};
  static int step(float meters) { return meters<=6?1:meters<=20?4:meters<=50?20:40; }
  static int bin(float meters, float distance) {
    int step=step(distance);
    return Math.round(meters / (TerrainMath.GRID_METERS*step))*step;
  }
}
