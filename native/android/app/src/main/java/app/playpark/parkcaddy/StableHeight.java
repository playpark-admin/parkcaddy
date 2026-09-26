package app.playpark.parkcaddy;
import java.util.Arrays;

/** Robust repeatability filter. Thresholds are not calibrated accuracy bounds. */
final class StableHeight {
 private final float[] heights=new float[9],xs=new float[9],ys=new float[9],zs=new float[9];
 private final long[] times=new long[9];
 private int size,next,conflicts; private long lastInput=-1;
 float y,scatter,lastBaseline; long seen,lastObservation; boolean published,uncertain;
 String decision="insufficient_samples";
 int observationCount(){return size;}
 long observationDurationMs(){long oldest=lastInput;for(int i=0;i<size;i++)oldest=Math.min(oldest,times[i]);return Math.max(0,lastInput-oldest);}
 boolean observe(float h,long now,float x,float vertical,float z){
  if(!Float.isFinite(h)||!Float.isFinite(x)||!Float.isFinite(vertical)||!Float.isFinite(z)||now<=lastInput)return false;
  if(lastInput>=0&&now-lastInput>5000){size=next=0;}
  lastInput=lastObservation=now;
  heights[next]=h;xs[next]=x;ys[next]=vertical;zs[next]=z;times[next]=now;
  next=(next+1)%9;size=Math.min(9,size+1);
  if(size<7){decision="insufficient_samples";return false;}
  float[] sorted=Arrays.copyOf(heights,size);Arrays.sort(sorted);float median=sorted[size/2];
  float[] deviations=new float[size];long oldest=now;float baseline=0;
  for(int i=0;i<size;i++){
   deviations[i]=Math.abs(heights[i]-median);oldest=Math.min(oldest,times[i]);
   for(int j=0;j<i;j++)baseline=Math.max(baseline,(float)Math.sqrt(sq(xs[i]-xs[j])+sq(ys[i]-ys[j])+sq(zs[i]-zs[j])));
  }
  Arrays.sort(deviations);float mad=deviations[size/2];
  lastBaseline=baseline;
  if(now-oldest<1200){decision="insufficient_duration";return false;}
  if(baseline<.08f){decision="translation_required";return false;}
  if(mad>.025f||sorted[size-2]-sorted[1]>.08f){decision="unstable_height";return false;}
  if(published&&Math.abs(median-y)>.06f){decision="disagreement";if(++conflicts>=3)uncertain=true;return false;}
  decision="accepted";
  y=published?y+.08f*(median-y):median;scatter=mad;published=true;uncertain=false;conflicts=0;seen=now;return true;
 }
 boolean valid(){return published&&!uncertain;}
 float deadband(float distance){return Math.max(.05f,3*scatter+.005f*distance);}
 private static float sq(float n){return n*n;}
}
