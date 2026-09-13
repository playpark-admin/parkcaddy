package app.playpark.parkcaddy;
import java.util.Arrays;

/** Multiple observations of one tracked plane; no scene-wide slope subtraction. */
final class ReferenceWindow {
 private final float[] heights=new float[12];
 private int count; private long first,last;
 void clear(){count=0;first=last=0;}
 boolean add(float height,long now){
  if(!Float.isFinite(height))return false;
  if(count>0&&now-last<120)return false;
  if(count>0&&(now-last>1000||Math.abs(height-median())>.06f))clear();
  if(count==0)first=now;
  if(count<12)heights[count++]=height;else{System.arraycopy(heights,1,heights,0,11);heights[11]=height;}
  last=now;
  if(count<12||now-first<1500)return false;
  float[] a=Arrays.copyOf(heights,count);Arrays.sort(a);return a[count-2]-a[1]<=.03f;
 }
 float median(){if(count==0)return 0;float[] a=Arrays.copyOf(heights,count);Arrays.sort(a);return a[count/2];}
}
