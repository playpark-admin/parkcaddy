package app.playpark.parkcaddy;

public final class DepthGeometryCheck {
  private static void near(float actual, float expected) {
    if (Math.abs(actual-expected) > .00001f) throw new AssertionError(actual+" != "+expected);
  }
  public static void main(String[] args) {
    float[] center=DepthGeometry.unproject(80,60,2000,100,100,80,60);
    near(center[0],0);near(center[1],0);near(center[2],-2);
    float[] lowerRight=DepthGeometry.unproject(130,110,2000,100,100,80,60);
    near(lowerRight[0],1);near(lowerRight[1],-1);near(lowerRight[2],-2);
    float[] scaled=DepthGeometry.unproject(260,220,2000,200,200,160,120);
    for(int i=0;i<3;i++)near(scaled[i],lowerRight[i]);
    System.out.println("PASS: mm scale, optical axis depth, image Y inversion, intrinsics resolution scaling");
  }
}
