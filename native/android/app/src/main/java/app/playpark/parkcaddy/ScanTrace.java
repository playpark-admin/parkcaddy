package app.playpark.parkcaddy;

/** Optional LOCAL-only stage timing. Records unsuccessful attempts too. */
final class ScanTrace {
  interface Sink { void write(String type, String payload); }
  private final Sink sink;
  private String phase, reason;
  private long start, entered, lastWrite, firstShowing = -1, lastNow;
  private int attempt, transitions;
  private boolean running;
  ScanTrace(Sink sink) { this.sink = sink; }

  void update(String nextPhase, String nextReason, boolean showing, long now, boolean enabled) {
    if (!enabled) { clear(); return; }
    if (now < 0 || (running && now < lastNow)) { clear(); return; }
    if (!running) {
      running = true; start = entered = now; lastWrite = now;
      firstShowing = -1; transitions = 0; attempt++;
      phase = nextPhase; reason = nextReason;
      sink.write("guide_attempt_start", MeasurementRecorder.json("attempt", attempt,
          "elapsed_ms", now, "phase", phase, "reason", reason,
          "timing_scope", "since_local_attempt_logging_start"));
    }
    lastNow = now;
    if (!nextPhase.equals(phase) || !nextReason.equals(reason)) {
      sink.write("guide_transition", MeasurementRecorder.json("attempt", attempt,
          "elapsed_ms", now, "from", phase, "from_reason", reason,
          "to", nextPhase, "reason", nextReason, "phase_ms", now - entered));
      phase = nextPhase; reason = nextReason; entered = now; transitions++; lastWrite = now;
    }
    if (showing && firstShowing < 0) {
      firstShowing = now - start;
      sink.write("guide_first_observed_cells", MeasurementRecorder.json("attempt", attempt,
          "elapsed_ms", now, "time_to_first_cells_ms", firstShowing,
          "accuracy_validated", false));
    }
    if (now - lastWrite >= 3000) {
      sink.write("guide_wait", MeasurementRecorder.json("attempt", attempt,
          "elapsed_ms", now, "phase", phase, "reason", reason,
          "phase_ms", now - entered, "attempt_ms", now - start));
      lastWrite = now;
    }
  }
  void finish(String outcome, long now, boolean enabled) {
    if (enabled && running && now >= lastNow)
      sink.write("guide_attempt_end", MeasurementRecorder.json("attempt", attempt,
          "elapsed_ms", now, "outcome", outcome, "last_phase", phase, "reason", reason,
          "phase_ms", now - entered, "attempt_ms", now - start,
          "first_observed_cells_ms", firstShowing < 0 ? null : firstShowing,
          "transitions", transitions, "accuracy_validated", false));
    clear();
  }
  private void clear() {
    running = false; phase = reason = null; firstShowing = -1; lastNow = 0;
  }
}
