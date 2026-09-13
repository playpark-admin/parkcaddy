package app.playpark.parkcaddy;
public class GridDisplayCheck {
  static void check(boolean ok){if(!ok)throw new AssertionError();}
  public static void main(String[] args){
    check(GridDisplayPolicy.stride(1)==1);
    check(GridDisplayPolicy.stride(2)==2);
    check(GridDisplayPolicy.stride(4)==4);
    float[] d={1,2,3,4,5},x={.5f,.5f,.5f,.5f,.5f},y={.8f,.65f,.5f,.35f,.2f};
    int[] indices=GridDisplayPolicy.select(d,x,y,new boolean[5],.2f,.1f);
    check(indices.length==5);
    check(GridDisplayPolicy.select(d,x,new float[5],new boolean[5],.2f,.1f).length==1);
    check(GridDisplayPolicy.select(new float[0],new float[0],new float[0],new boolean[0],.2f,.1f).length==0);
    check(GridDisplayPolicy.heightLabel(.123f,true).contains("+12"));
    check(GridDisplayPolicy.heightLabel(-.12f,true).contains("-12"));
    check(GridDisplayPolicy.heightLabel(0,false).equals("높이 미측정"));
    System.out.println("PASS: distance-based spacing, five labels, overlap prevention, signed heights and unknown depth");
  }
}
