package app.playpark.parkcaddy;

/** Conservative local-session resume gate. These are reuse limits, not accuracy bounds. */
final class ResumePolicy {
  static final long MAX_PAUSE_MS = 10000;
  static final float MAX_DISPLACEMENT_M = .5f;
  private ResumePolicy() { }
  static boolean mayKeepAnchor(long elapsedMs, boolean cameraTracking,
      boolean anchorTracking, float dx, float dy, float dz) {
    if (elapsedMs < 0 || elapsedMs > MAX_PAUSE_MS || !cameraTracking || !anchorTracking
        || !Float.isFinite(dx) || !Float.isFinite(dy) || !Float.isFinite(dz)) return false;
    return dx * dx + dy * dy + dz * dz <= MAX_DISPLACEMENT_M * MAX_DISPLACEMENT_M;
  }
  // Stored cell estimates are always discarded on resume, including short pauses.
  static boolean mayShowStoredCellsAfterPause() { return false; }
}
