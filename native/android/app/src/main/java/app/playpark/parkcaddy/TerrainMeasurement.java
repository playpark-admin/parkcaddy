package app.playpark.parkcaddy;

import com.google.ar.core.Pose;

/** A world-space grid sample. Values are never screen-relative. */
final class TerrainMeasurement {
  final Pose worldPose;
  final float distanceMeters;
  final float relativeHeightMeters;
  final float confidence;

  TerrainMeasurement(Pose origin, Pose point, float confidence) {
    this.worldPose = point;
    float[] o = origin.getTranslation();
    float[] p = point.getTranslation();
    float dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2];
    this.distanceMeters = (float) Math.sqrt(dx * dx + dz * dz);
    this.relativeHeightMeters = dy;
    this.confidence = confidence;
  }
}
