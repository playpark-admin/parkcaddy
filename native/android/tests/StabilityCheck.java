package app.playpark.parkcaddy;
import java.util.Arrays;
public final class StabilityCheck {
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 static void feed(StableHeight s,float h,long start,int count){for(int i=0;i<count;i++)s.observe(h+(i%3-1)*.005f,start+i*200,(i%9)*.02f,1.3f,0);}
 public static void main(String[] args){
  StableHeight s=new StableHeight();feed(s,-.14f,1000,9);
  check(s.valid()&&Math.abs(s.y+.14f)<.01,"negative stable height accepted");
  float original=s.y;
  check(!s.observe(Float.NaN,3000,0,1,0),"NaN ignored");
  s.observe(1,3000,.18f,1.3f,0);check(Math.abs(s.y-original)<.01,"single outlier must not jump");
  feed(s,-.14f,50000,9);check(s.valid()&&Math.abs(s.y-original)<.01,"saved height survives looking away");
  feed(s,.2f,60000,20);check(s.uncertain&&!s.valid()&&Math.abs(s.y-original)<.01,"contradiction flagged, not adopted");
  feed(s,-.14f,70000,20);check(s.valid(),"consistent rescan recovers");
  StableHeight rotationOnly=new StableHeight();
  for(int i=0;i<20;i++)rotationOnly.observe(.1f,i*200,0,1.3f,0);
  check(!rotationOnly.valid(),"rotation without translation is insufficient");
  check(s.deadband(2)>=.05f&&s.deadband(50)>=.25f,"small far differences suppressed");
  ReferenceWindow ref=new ReferenceWindow();boolean ready=false;
  for(int i=0;i<12;i++)ready=ref.add(-1.3f+(i%3-1)*.003f,1000+i*150);
  check(ready&&Math.abs(ref.median()+1.3f)<.01,"reference needs stable repeated observations");
  ref.clear();check(!ref.add(-1,10000),"reset reference");
  ref.add(-2,10200);check(Math.abs(ref.median()+2)<.01,"large reference shift restarts");
  StickyLabels labels=new StickyLabels();String[] keys={"a","b","c"};
  float[] x={.2f,.5f,.8f},y={.2f,.5f,.8f};
  labels.select(keys,x,y,new int[]{0,1},.1f,.1f);
  check(Arrays.equals(labels.select(keys,x,y,new int[]{2},.1f,.1f),new int[]{0,1,2}),"visible cell identity persists");
  labels.clear();check(Arrays.equals(labels.select(keys,x,y,new int[]{2},.1f,.1f),new int[]{2}),"reset clears labels");
  System.out.println("PASS: stable negative heights, spikes, persistence, conflicts, recovery, translation, reference and fixed labels");
 }
}
