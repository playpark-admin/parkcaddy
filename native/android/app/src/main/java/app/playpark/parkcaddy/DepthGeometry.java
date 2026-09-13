package app.playpark.parkcaddy;

/** Depth is distance along the optical axis in mm, not Euclidean ray length. */
final class DepthGeometry {
  static float[] unproject(int x, int y, int millimeters,
      float fx, float fy, float cx, float cy) {
    float d = millimeters * .001f;
    return new float[] {(x-cx)*d/fx, -(y-cy)*d/fy, -d};
  }
}
