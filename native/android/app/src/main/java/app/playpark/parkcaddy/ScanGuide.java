package app.playpark.parkcaddy;

/**
 * Presentation-only state machine. Never approves a depth sample or changes a
 * measurement threshold. Toes are an optional framing cue, NOT an object detector.
 */
final class ScanGuide {
  enum Phase { FIND_GROUND, BASELINE, AIM_FIELD, FIELD_SCAN, SHOWING, RECOVERY, BLOCKED }
  enum Action { TOE_TARGET, TILT_UP, TILT_DOWN, TRANSLATE, WAIT, REOBSERVE, NONE }
  static final class State {
    final Phase phase;
    final Action action;
    final String reason, title, detail;
    final boolean showToes, showReadings;
    final float progress;
    final long elapsedMs;
    State(Phase phase, Action action, String reason, String title, String detail,
        boolean showToes, boolean showReadings, float progress, long elapsedMs) {
      this.phase = phase; this.action = action; this.reason = reason;
      this.title = title; this.detail = detail; this.showToes = showToes;
      this.showReadings = showReadings;
      this.progress = Float.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      this.elapsedMs = Math.max(0, elapsedMs);
    }
    // Visibility must never be used as a sensor gate, including initial setup.
    boolean requiresToeDetection() { return false; }
  }
  private Phase previous;
  private long enteredAt;
  private boolean hasEverLocked, fieldEntered;

  void reset() { previous = null; enteredAt = 0; hasEverLocked = false; fieldEntered = false; }

  State update(ScanProgress status, boolean cameraTracking, boolean hasAnchor,
      boolean anchorTracking, int referenceCount, float downDegrees,
      int forwardObservedCells, float baselineMeters, long now) {
    if (status.stage == ScanProgress.Stage.BLOCKED)
      return state(Phase.BLOCKED, Action.NONE, "blocked", status.title, status.detail,
          false, false, 0, now);
    if (!cameraTracking || (hasAnchor && !anchorTracking)) {
      return state(hasEverLocked ? Phase.RECOVERY : Phase.FIND_GROUND,
          hasEverLocked ? Action.REOBSERVE : Action.TOE_TARGET,
          "tracking_unavailable",
          hasEverLocked ? "\ucd94\uc801\uc744 \ub2e4\uc2dc \ud655\uc778\ud574\uc694" : "\ubc1c \uc55e \uc9c0\uba74\uc744 \ube44\ucdb0 \uc8fc\uc138\uc694",
          hasEverLocked ? "\ubc29\uae08 \ubcf4\ub358 \uc9c0\uba74\uc744 \ucc9c\ucc9c\ud788 \ub2e4\uc2dc \ube44\ucdb0 \uc8fc\uc138\uc694. \ubc1c\ub05d\uc740 \ubcf4\uc774\uc9c0 \uc54a\uc544\ub3c4 \ub429\ub2c8\ub2e4." : status.detail,
          !hasEverLocked, false, 0, now);
    }
    if (!hasAnchor) {
      return state(referenceCount > 0 ? Phase.BASELINE : Phase.FIND_GROUND,
          Action.TOE_TARGET, referenceCount > 0 ? "reference_stabilizing" : "plane_search",
          referenceCount > 0 ? "\uae30\uc900 \uc9c0\uba74 \ud655\uc778 \uc911" : "\ubc1c \uc55e \uc9c0\uba74\uc744 \ube44\ucdb0 \uc8fc\uc138\uc694",
          "\ubc1c\ub05d \uc55e\uc758 \ube48 \uc9c0\uba74\uc744 \uc911\uc559\uc5d0 \ub450\uc138\uc694.\n\uac19\uc740 \uacf3\uc744 \ubcf4\uba70 \ud3f0\uc744 \ucc9c\ucc9c\ud788 \uc606\uc73c\ub85c \uc62e\uae30\uc138\uc694.",
          true, false, Math.min(.9f, referenceCount / 12f), now);
    }
    hasEverLocked = true;
    if (!Float.isFinite(downDegrees))
      return state(Phase.RECOVERY, Action.WAIT, "pose_unavailable", status.title,
          "\uce74\uba54\ub77c \uc790\uc138\ub97c \ub2e4\uc2dc \ud655\uc778\ud558\uace0 \uc788\uc5b4\uc694.", false, false, 0, now);
    // This angle band is ONLY a framing hint, never a depth/accuracy gate.
    // Do not force a fixed 20-40 degree rotation from the initial pose.
    if (!fieldEntered && downDegrees > 75)
      return state(Phase.AIM_FIELD, Action.TILT_UP, "aim_forward",
          "\uc774\uc81c \uc55e\ucabd \ud544\ub4dc\ub97c \ube44\ucdb0 \uc8fc\uc138\uc694",
          "\ud734\ub300\ud3f0\uc744 \ucc9c\ucc9c\ud788 \uae30\uc6b8\uc5ec \uc55e\ucabd \uc9c0\uba74\uc744 \ubcf4\uc138\uc694.\n\ubc1c\ub05d\uc774 \uc0ac\ub77c\uc838\ub3c4 \uad1c\ucc2e\uc544\uc694.", false, false, 0, now);
    if (downDegrees < 10)
      return state(Phase.AIM_FIELD, Action.TILT_DOWN, "aim_ground",
          "\uce74\uba54\ub77c\ub97c \uc870\uae08 \ub0ae\ucdb0 \uc8fc\uc138\uc694",
          "\ud558\ub298\ubcf4\ub2e4 \uac00\uae4c\uc6b4 \uc55e\ucabd \uc9c0\uba74\uc744 \ube44\ucdb0 \uc8fc\uc138\uc694. \ubc1c\ub05d\uc744 \ub2e4\uc2dc \ub9de\ucd9c \ud544\uc694\ub294 \uc5c6\uc5b4\uc694.", false, false, 0, now);
    if (forwardObservedCells <= 0 || status.stage == ScanProgress.Stage.DEPTH)
      return state(Phase.FIELD_SCAN, Action.TRANSLATE, "forward_depth_needed",
          "\uc55e\ucabd \uc9c0\uba74\uc744 \uac19\uc774 \ubcf4\uba70 \uc62e\uaca8 \uc8fc\uc138\uc694",
          "\uc11c\uc11c \ud734\ub300\ud3f0\ub9cc \uc88c\uc6b0\ub85c \ucc9c\ucc9c\ud788 \uc62e\uae30\uc138\uc694. \ud68c\uc804\ub9cc \ud558\uc9c0 \uc54a\uc544\uc694. \ubc1c\ub05d\uc740 \uc548 \ubcf4\uc5ec\ub3c4 \ub429\ub2c8\ub2e4.", false, false, 0, now);
    fieldEntered = true;
    if (status.stage == ScanProgress.Stage.SHOWING)
      return state(Phase.SHOWING, Action.NONE, "showing_observed_cells", status.title,
          "\uc720\ud6a8\ud55c \uad00\uce21 \uaca9\uc790\ub9cc \ud45c\uc2dc\ud569\ub2c8\ub2e4. \ube48 \uacf3\uc740 \ubbf8\uce21\uc815\uc774\uba70 \ud604\uc7a5 \uc815\ud655\ub3c4\ub294 \uac80\uc99d \uc804\uc785\ub2c8\ub2e4.", false, true, 0, now);
    if (status.stage == ScanProgress.Stage.HELP)
      return state(Phase.FIELD_SCAN, Action.REOBSERVE, "observation_help", status.title,
          status.detail, false, true, 0, now);
    boolean needsMove = baselineMeters < StableHeight.MIN_BASELINE_M;
    return state(Phase.FIELD_SCAN, needsMove ? Action.TRANSLATE : Action.WAIT,
        needsMove ? "translation_required" : "repeatability_check", status.title,
        needsMove ? "\uac19\uc740 \uc9c0\uba74\uc744 \ubcf4\uba70 \ud734\ub300\ud3f0\ub9cc \uc88c\uc6b0 10~20 cm \ucc9c\ucc9c\ud788 \uc62e\uaca8 \uc8fc\uc138\uc694." : status.detail,
        false, true, baselineMeters / StableHeight.MIN_BASELINE_M, now);
  }

  private State state(Phase phase, Action action, String reason, String title,
      String detail, boolean toes, boolean readings, float progress, long now) {
    if (previous != phase || now < enteredAt) { previous = phase; enteredAt = now; }
    return new State(phase, action, reason, title, detail, toes, readings, progress, now - enteredAt);
  }

  static float downwardDegrees(float fx, float fy, float fz) {
    double length = Math.sqrt(fx * (double) fx + fy * (double) fy + fz * (double) fz);
    if (!Double.isFinite(length) || length < 1e-6) return Float.NaN;
    return (float) -Math.toDegrees(Math.asin(Math.max(-1, Math.min(1, fy / length))));
  }
}
