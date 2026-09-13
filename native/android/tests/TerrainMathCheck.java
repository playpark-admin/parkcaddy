package app.playpark.parkcaddy;

/** Run with Java 17; no Android runtime or third-party dependencies. */
public final class TerrainMathCheck {
  private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
  public static void main(String[] args) {
    check(Math.abs(TerrainMath.distance(12,16)-5)<.0001, "3-4-5 horizontal distance");
    check(TerrainMath.distance(-12,-16)==TerrainMath.distance(12,16), "opposite direction same distance");
    check(TerrainMath.distance(4,0)==1, "four 25 cm cells must display 1 m, not 2 m");
    check(TerrainMath.gridIndex(1)==4 && TerrainMath.gridMeters(4)==1, "sampling and rendering share the distance scale");
    TerrainMath.Estimate e=new TerrainMath.Estimate(0,0);
    check(!e.valid(0), "one observation must not become measured terrain");
    e.observe(.01f,200); e.observe(-.01f,400);
    check(e.valid(400), "stable repeated observations are usable");
    float previous=e.y;
    check(!e.observe(1,600) && e.y==previous, "outlier must not invent a hill");
    check(!e.observe(Float.NaN,600), "invalid depth rejected");
    check(!e.valid(16000), "stale measurements expire");
    TerrainMath.Estimate high=new TerrainMath.Estimate(1.9f,0);
    high.observe(1.91f,200); high.observe(1.89f,400);
    check(high.valid(400)&&high.y>1.8, "large real relative height stays representable");
    System.out.println("PASS: distance, symmetry, missing data, temporal filtering, outliers, expiry, 2 m range");
  }
}
