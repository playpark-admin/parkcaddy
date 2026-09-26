package app.playpark.parkcaddy;

/** Input gates describe repeatability, never a calibrated accuracy probability. */
final class MeasurementPolicy {
  static final String ALGORITHM = "stable-raw-v2-near";
  final boolean strict;
  final int confidenceMin;
  final float frameSpreadMaxMeters;
  final float depthMaxMeters = 6f;

  MeasurementPolicy(boolean strict) {
    this.strict = strict;
    confidenceMin = strict ? 210 : 180;
    frameSpreadMaxMeters = strict ? .08f : .12f;
  }

  boolean acceptsDepth(float meters, int confidence) {
    return Float.isFinite(meters) && meters >= .3f && meters <= depthMaxMeters
        && confidence >= confidenceMin && confidence <= 255;
  }

  boolean acceptsFrame(float count, float min, float max) {
    return count >= 2 && Float.isFinite(min) && Float.isFinite(max)
        && max >= min && max - min <= frameSpreadMaxMeters;
  }

  String metadata() {
    return MeasurementRecorder.json("algorithm", ALGORITHM, "strict", strict,
        "confidence_min", confidenceMin, "frame_spread_max_m", frameSpreadMaxMeters,
        "depth_max_m", depthMaxMeters, "temporal_min_samples", 7,
        "temporal_min_duration_ms", 1200, "temporal_min_baseline_m", .08,
        "temporal_mad_max_m", .025, "grid_unit_m", .25,
        "accuracy_validated", false);
  }
}
