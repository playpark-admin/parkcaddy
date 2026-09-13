package app.playpark.parkcaddy;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Display-only choices. Measurement coordinates and distance scale stay unchanged. */
final class GridDisplayPolicy {
  static int stride(float cameraMeters) {
    return cameraMeters < 2 ? 1 : cameraMeters < 4 ? 2 : 4;
  }
  static String heightLabel(float meters, boolean known) {
    if (!known || !Float.isFinite(meters)) return "높이 미측정";
    int cm = Math.round(meters * 100);
    return String.format(Locale.KOREA, "높이 ≈ %s%d cm", cm > 0 ? "+" : "", cm);
  }
  // Points are normalized screen positions. Choose one representative in each
  // visible distance band, then avoid overlapping neighboring labels.
  static int[] select(float[] distance, float[] x, float[] y, boolean[] known,
      float minDx, float minDy) {
    if (distance.length == 0) return new int[0];
    float min = Float.MAX_VALUE, max = -Float.MAX_VALUE;
    for (float d : distance) { min = Math.min(min, d); max = Math.max(max, d); }
    List<Integer> selected = new ArrayList<>();
    float span = Math.max(.01f, max-min);
    for (int band=0; band<5; band++) {
      int best=-1; float score=Float.MAX_VALUE;
      float target=min+span*(band+.5f)/5;
      for (int i=0; i<distance.length; i++) {
        int bucket=Math.min(4,(int)((distance[i]-min)/span*5));
        if (bucket!=band) continue;
        boolean overlaps=false;
        for (int previous:selected)
          if (Math.abs(x[i]-x[previous])<minDx && Math.abs(y[i]-y[previous])<minDy) overlaps=true;
        if (overlaps) continue;
        float s=Math.abs(distance[i]-target)/span+Math.abs(x[i]-.5f)*.5f+(known[i]?0:.04f);
        if(s<score){score=s;best=i;}
      }
      if(best>=0)selected.add(best);
    }
    int[] result=new int[selected.size()];
    for(int i=0;i<result.length;i++)result[i]=selected.get(i);
    return result;
  }
}
