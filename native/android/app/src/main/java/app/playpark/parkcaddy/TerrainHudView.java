package app.playpark.parkcaddy;
import android.content.Context;
import android.graphics.*;
import android.view.View;
import java.util.*;
final class TerrainHudView extends View {
 static final class Node {final int ix,iz,step;final float x,y,height,cameraMeters;final boolean known,uncertain,saved;final float deadband;Node(int ix,int iz,float x,float y,float h,boolean known,boolean uncertain,boolean saved,float deadband,int step,float cameraMeters){this.uncertain=uncertain;this.saved=saved;this.deadband=deadband;this.step=step;this.ix=ix;this.iz=iz;this.x=x;this.y=y;height=h;this.known=known;this.cameraMeters=cameraMeters;}}
 static final class Scene {final HashMap<String,Node> nodes=new HashMap<>();Scene(List<Node> list){for(Node n:list)nodes.put(n.ix+":"+n.iz,n);}}
 private final StickyLabels sticky=new StickyLabels();
 void resetLabels(){sticky.clear();}
 private Scene scene=new Scene(new ArrayList<>());
 int topInset,bottomInset; boolean grid=true,heat=true,reference=false,largeLabels=true;float sensitivity=2;
 private final Paint paint=new Paint(3);
 private final Path fill=new Path();
 private final android.graphics.DashPathEffect dash=new android.graphics.DashPathEffect(new float[]{8,9},0);
 private long debugTime; TerrainHudView(Context c){super(c);setWillNotDraw(false);setLayerType(View.LAYER_TYPE_SOFTWARE,null);}
 void setScene(Scene s){scene=s;invalidate();}
 private float x(Node n){return(n.x+1)*getWidth()/2;}
 private float y(Node n){return(1-n.y)*getHeight()/2;}
 private int color(float h,float threshold){if(Math.abs(h)<=threshold)return 0x407FAD9A;float v=Math.min(1,(float)Math.sqrt((Math.abs(h)-threshold)/2)*sensitivity);return Color.HSVToColor(100,new float[]{h>=0?150*(1-v):150+80*v,.9f,1});}
 protected void onDraw(Canvas canvas){
 Scene s=scene;if(android.os.SystemClock.elapsedRealtime()-debugTime>3000){debugTime=android.os.SystemClock.elapsedRealtime();android.util.Log.d("ParkCaddyHud","draw nodes="+s.nodes.size()+" size="+getWidth()+"x"+getHeight()+" grid="+grid); }paint.setStrokeWidth(2*getResources().getDisplayMetrics().density);
 for(Node a:s.nodes.values()){if(!reference&&!a.known)continue;
 Node b=s.nodes.get((a.ix+a.step)+":"+a.iz),c=s.nodes.get(a.ix+":"+(a.iz+a.step)),d=s.nodes.get((a.ix+a.step)+":"+(a.iz+a.step));
 if(heat&&a.known&&b!=null&&b.known&&c!=null&&c.known&&d!=null&&d.known){Path p=fill;p.reset();p.moveTo(x(a),y(a));p.lineTo(x(b),y(b));p.lineTo(x(d),y(d));p.lineTo(x(c),y(c));p.close();paint.setColor(color((a.height+b.height+c.height+d.height)/4,Math.max(Math.max(a.deadband,b.deadband),Math.max(c.deadband,d.deadband))));canvas.drawPath(p,paint);}
 if(grid){
 int stride=Math.max(a.step,GridDisplayPolicy.stride(a.cameraMeters)); if(b!=null && Math.floorMod(a.iz,stride)==0)edge(canvas,a,b);if(c!=null && Math.floorMod(a.ix,stride)==0)edge(canvas,a,c);paint.setPathEffect(null);
 Node lower=a;for(Node n:new Node[]{b,c,s.nodes.get((a.ix-a.step)+":"+a.iz),s.nodes.get(a.ix+":"+(a.iz-a.step))})if(n!=null&&n.known&&n.height<lower.height)lower=n;
 if(a.known&&Math.floorMod(a.ix,stride)==0&&Math.floorMod(a.iz,stride)==0&&a.height-lower.height>a.deadband+lower.deadband){float dx=(x(lower)-x(a))*.5f,dy=(y(lower)-y(a))*.5f,len=(float)Math.hypot(dx,dy);
 if(len>8){float ex=x(a)+dx,ey=y(a)+dy;paint.setColor(Color.WHITE);canvas.drawLine(x(a),y(a),ex,ey,paint);float ux=dx/len,uy=dy/len;canvas.drawLine(ex,ey,ex-8*ux+5*uy,ey-8*uy-5*ux,paint);canvas.drawLine(ex,ey,ex-8*ux-5*uy,ey-8*uy+5*ux,paint);}}
 }}

 if(grid||heat)drawLabels(canvas,s);

 }
private void drawLabels(Canvas canvas, Scene s) {
 float density=getResources().getDisplayMetrics().density;
 float text=(largeLabels?18:14)*getResources().getDisplayMetrics().scaledDensity;
 paint.setTextSize(text);paint.setTextAlign(Paint.Align.CENTER);paint.setTypeface(Typeface.DEFAULT_BOLD);
 float boxWidth=Math.max(paint.measureText("높이 ≈ -200 cm"),paint.measureText("높이 재측정 필요"))+24*density, boxHeight=text*3.8f;
 ArrayList<Node> visible=new ArrayList<>();
 for(Node n:s.nodes.values()){if(!reference&&!n.known)continue;
   float px=x(n),py=y(n);
   if(px>boxWidth/2+8*density&&px<getWidth()-boxWidth/2-8*density
       &&py>Math.max(60*density,topInset)+boxHeight&&py<getHeight()-bottomInset-12*density)visible.add(n);
 }
 visible.sort((a,b)->{int d=Float.compare(TerrainMath.distance(a.ix,a.iz),TerrainMath.distance(b.ix,b.iz));if(d!=0)return d;return Integer.compare(a.ix,b.ix);});
 int count=visible.size();float[] distances=new float[count],xs=new float[count],ys=new float[count];boolean[] known=new boolean[count];
 for(int i=0;i<count;i++){Node n=visible.get(i);distances[i]=TerrainMath.distance(n.ix,n.iz);xs[i]=x(n)/getWidth();ys[i]=y(n)/getHeight();known[i]=n.known;}
 int[] picks=GridDisplayPolicy.select(distances,xs,ys,known,(boxWidth+12*density)/getWidth(),(boxHeight+12*density)/getHeight());
 String[] keys=new String[count];for(int i=0;i<count;i++)keys[i]=visible.get(i).ix+":"+visible.get(i).iz;
 picks=sticky.select(keys,xs,ys,picks,(boxWidth+12*density)/getWidth(),(boxHeight+12*density)/getHeight());
 for(int i:picks){
   Node n=visible.get(i);float px=x(n),py=y(n);
   paint.setColor(0xDF071920);canvas.drawRoundRect(px-boxWidth/2,py-boxHeight,px+boxWidth/2,py,8*density,8*density,paint);
   paint.setColor(Color.WHITE);
   canvas.drawText(String.format(Locale.KOREA,"≈%.1f m",distances[i]),px,py-boxHeight+text*1.1f,paint);
   paint.setColor(n.known?0xFF87F1D1:0xFFB8C1C6);
   canvas.drawText(n.uncertain?"높이 재측정 필요":GridDisplayPolicy.heightLabel(n.height,n.known),px,py-boxHeight+text*2.25f,paint);
   paint.setTextSize(text*.78f);paint.setColor(0xFFC0CFD3);
   canvas.drawText((n.uncertain?"다시 관측":!n.known?"참고 평면":n.saved?"이전 관측":Math.abs(n.height)<=n.deadband?"작은 높이차":"기준 지면 대비"),px,py-text*.4f,paint);
   paint.setTextSize(text);
   paint.setColor(0xFFFFFFFF);canvas.drawCircle(px,py+3*density,2*density,paint);
 }
}
private void edge(Canvas canvas,Node a,Node b){
 boolean known=a.known&&b.known;if(!known&&!reference)return;
 paint.setColor(known?0xE023E9CA:0x709AAAB0);paint.setPathEffect(known?null:dash);
 canvas.drawLine(x(a),y(a),x(b),y(b),paint);paint.setPathEffect(null);
}
}

