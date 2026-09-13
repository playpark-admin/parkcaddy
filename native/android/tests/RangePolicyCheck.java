package app.playpark.parkcaddy;
public class RangePolicyCheck {
 public static void main(String[] args){
  if(TerrainMath.gridMeters(600)!=150)throw new AssertionError("150 m scale");
  if(RangePolicy.step(5)!=1||RangePolicy.step(15)!=4||RangePolicy.step(40)!=20||RangePolicy.step(100)!=40)throw new AssertionError("density");
  if(TerrainMath.gridMeters(RangePolicy.bin(100,100))!=100)throw new AssertionError("bin");
  int count=0;
  for(int b=0;b<4;b++)for(int x=-RangePolicy.LIMITS[b];x<=RangePolicy.LIMITS[b];x+=RangePolicy.STEPS[b])
   for(int z=-RangePolicy.LIMITS[b];z<=RangePolicy.LIMITS[b];z+=RangePolicy.STEPS[b]){
    double r=Math.hypot(x,z);if(r<=RangePolicy.LIMITS[b]&&(b==0||r>RangePolicy.LIMITS[b-1]))count++;
   }
  if(count>6000)throw new AssertionError("unbounded grid");
  System.out.println("PASS: 150 m scale, range density, coarse bins; bounded nodes="+count);
 }
}
