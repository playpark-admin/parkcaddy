package app.playpark.parkcaddy;

/** Verifies that stricter settings really change admission, never the numeric measurements. */
public final class MeasurementPolicyCheck {
  static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
  public static void main(String[] args) {
    MeasurementPolicy normal = new MeasurementPolicy(false), strict = new MeasurementPolicy(true);
    check(normal.acceptsDepth(2f, 190), "normal admits usable confidence");
    check(!strict.acceptsDepth(2f, 190), "strict actually rejects lower confidence");
    check(strict.acceptsDepth(2f, 220), "strict accepts stronger observations");
    check(!normal.acceptsDepth(Float.NaN, 255), "nonfinite depth rejected");
    check(!normal.acceptsDepth(0, 255) && !normal.acceptsDepth(6.01f, 255), "invalid and far depths rejected");
    check(!normal.acceptsDepth(2, 256) && !normal.acceptsDepth(2, -1), "confidence bounds");
    check(normal.acceptsFrame(4, -.1f, 0), "normal accepts 10 cm frame spread");
    check(!strict.acceptsFrame(4, -.1f, 0), "strict rejects 10 cm frame spread");
    check(!normal.acceptsFrame(1, 0, 0), "one point cannot establish a cell");
    check(!normal.acceptsFrame(4, 0, Float.NaN), "invalid frame rejected");
    check(normal.metadata().contains("\"accuracy_validated\":false"), "no invented accuracy");
    StableHeight temporal = new StableHeight();
    for (int i = 0; i < 20; i++) temporal.observe(.1f, 1000, i * .02f, 1.3f, 0);
    check(temporal.observationCount() == 1 && !temporal.valid(), "duplicate timestamp cannot create stability");
    StableHeight bias = new StableHeight();
    for (int i = 0; i < 9; i++) bias.observe(.1f, 1000 + i * 200, i * .02f, 1.3f, 0);
    check(bias.valid() && Math.abs(bias.y - .1f) < .001f, "repeatability preserves a common bias, not calibration");
    System.out.println("PASS: live filter admission, invalid samples, duplicate timestamps and common-bias limitation");
  }
}
