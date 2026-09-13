package app.playpark.parkcaddy;
public class TrackingGuideCheck {
  public static void main(String[] args) {
    for(String code:new String[]{"INSUFFICIENT_LIGHT","INSUFFICIENT_FEATURES","EXCESSIVE_MOTION","BAD_STATE","CAMERA_UNAVAILABLE","NONE"})
      if(!TrackingGuide.tracking(code).contains("\n"))throw new AssertionError(code);
    if(!TrackingGuide.tracking("INSUFFICIENT_FEATURES").contains("경계"))throw new AssertionError();
    System.out.println("PASS: tracking reasons include corrective actions and fallback guidance");
  }
}
