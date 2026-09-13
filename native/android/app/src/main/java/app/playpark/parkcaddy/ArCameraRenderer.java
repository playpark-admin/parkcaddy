package app.playpark.parkcaddy;
import android.opengl.*;
import android.util.Log;
import com.google.ar.core.*;
import java.nio.*;
import java.util.*;
final class ArCameraRenderer implements GLSurfaceView.Renderer {
 interface Listener {void update(TerrainHudView.Scene scene,String message);}
 private final Listener listener;
 volatile MeasurementRecorder recorder;private int segment;private long lastTelemetry,lastStatusRecord;private String lastRecordedStatus="";
 volatile Session session; volatile int rotation; volatile boolean resetRequested; volatile int rangeMeters=15;
 private int width,height,texture,program; private Anchor anchor;
 private final HashMap<String,Cell> cells=new HashMap<>();
 private long lastSample,lastFrame,lastDepth;
 private String referenceMessage="바닥 찾는 중 · 사물 사이로 바닥이 보이게 비춰 주세요";
 private Plane referencePlane; private final ReferenceWindow reference=new ReferenceWindow();
 private final float[] vp=new float[16],view=new float[16],projection=new float[16];
 private final FloatBuffer quad=floats(new float[]{-1,-1,1,-1,-1,1,1,1}),uv=floats(new float[8]);
 static final class Cell {final int x,z;final StableHeight estimate=new StableHeight();Cell(int x,int z){this.x=x;this.z=z;}}
 ArCameraRenderer(Listener l){listener=l;}
 private static FloatBuffer floats(float[] a){FloatBuffer b=ByteBuffer.allocateDirect(a.length*4).order(ByteOrder.nativeOrder()).asFloatBuffer();b.put(a).rewind();return b;}
 public void onSurfaceCreated(javax.microedition.khronos.opengles.GL10 gl,javax.microedition.khronos.egl.EGLConfig c){
 int[] t=new int[1];GLES20.glGenTextures(1,t,0);texture=t[0];GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,texture);
 for(int p:new int[]{GLES20.GL_TEXTURE_MIN_FILTER,GLES20.GL_TEXTURE_MAG_FILTER})GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,p,GLES20.GL_LINEAR);
 for(int p:new int[]{GLES20.GL_TEXTURE_WRAP_S,GLES20.GL_TEXTURE_WRAP_T})GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,p,GLES20.GL_CLAMP_TO_EDGE);
 program=GLES20.glCreateProgram();
 GLES20.glAttachShader(program,shader(GLES20.GL_VERTEX_SHADER,"attribute vec2 p; attribute vec2 uv; varying vec2 v; void main(){gl_Position=vec4(p,0.,1.);v=uv;}"));
 GLES20.glAttachShader(program,shader(GLES20.GL_FRAGMENT_SHADER,"#extension GL_OES_EGL_image_external : require\nprecision mediump float; varying vec2 v; uniform samplerExternalOES tex; void main(){gl_FragColor=texture2D(tex,v);}"));
 GLES20.glLinkProgram(program);int[] ok=new int[1];GLES20.glGetProgramiv(program,GLES20.GL_LINK_STATUS,ok,0);if(ok[0]==0)throw new IllegalStateException(GLES20.glGetProgramInfoLog(program));
 }
 private static int shader(int type,String source){int s=GLES20.glCreateShader(type);GLES20.glShaderSource(s,source);GLES20.glCompileShader(s);int[] ok=new int[1];GLES20.glGetShaderiv(s,GLES20.GL_COMPILE_STATUS,ok,0);if(ok[0]==0)throw new IllegalStateException(GLES20.glGetShaderInfoLog(s));return s;}
 public void onSurfaceChanged(javax.microedition.khronos.opengles.GL10 gl,int w,int h){width=w;height=h;GLES20.glViewport(0,0,w,h);}
 public void onDrawFrame(javax.microedition.khronos.opengles.GL10 gl){
 GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);Session s=session;if(s==null||width==0)return;
 try{
 if(resetRequested){segment++;record("reset",MeasurementRecorder.json("elapsed_ms",android.os.SystemClock.elapsedRealtime()));if(anchor!=null)anchor.detach();anchor=null;cells.clear();reference.clear();referencePlane=null;lastDepth=0;resetRequested=false;}
 s.setCameraTextureName(texture);s.setDisplayGeometry(rotation,width,height);Frame f=s.update();drawCamera(f);
 if(f.getCamera().getTrackingState()!=TrackingState.TRACKING){reference.clear();empty(TrackingGuide.tracking(f.getCamera().getTrackingFailureReason().name()));return;}
 if(anchor==null)lock(f);
 if(anchor==null){empty(referenceMessage);return;}
 if(anchor.getTrackingState()!=TrackingState.TRACKING){empty("격자 대기: 기존 기준점을 놓쳤습니다\n원래 지면을 다시 비추세요. 위치를 옮겼다면 현재 위치로 초기화하세요.");return;}
 long now=android.os.SystemClock.elapsedRealtime();
 if(now-lastSample>180&&f.getTimestamp()!=lastFrame){sample(f,now);lastSample=now;lastFrame=f.getTimestamp();}
 f.getCamera().getViewMatrix(view,0);f.getCamera().getProjectionMatrix(projection,0,.1f,250);Matrix.multiplyMM(vp,0,projection,0,view,0);
 ArrayList<TerrainHudView.Node> nodes=new ArrayList<>();Pose pose=anchor.getPose();

 float[] cameraPosition=f.getCamera().getPose().getTranslation(); int measured=0;
 for(int band=0;band<RangePolicy.LIMITS.length;band++){
 int limit=Math.min(RangePolicy.LIMITS[band],Math.round(rangeMeters/TerrainMath.GRID_METERS));
 int spacing=RangePolicy.STEPS[band],previous=band==0?0:RangePolicy.LIMITS[band-1];
 if(limit<=previous)break;
 for(int ix=-limit;ix<=limit;ix+=spacing)for(int iz=-limit;iz<=limit;iz+=spacing){
 // Align all rings to the same world origin even for a truncated view range.
 if(Math.floorMod(ix,spacing)!=0||Math.floorMod(iz,spacing)!=0)continue;
 double radius=Math.hypot(ix,iz);if(radius>limit||(band>0&&radius<=previous))continue;
 Cell c=cells.get(ix+":"+iz);boolean known=c!=null&&c.estimate.valid();float elevation=known?c.estimate.y:0;
 float[] world=pose.transformPoint(new float[]{TerrainMath.gridMeters(ix),elevation,TerrainMath.gridMeters(iz)}),clip=new float[4];
 Matrix.multiplyMV(clip,0,vp,0,new float[]{world[0],world[1],world[2],1},0);
 if(clip[3]<.15f||Math.abs(clip[0])>clip[3]*1.3||Math.abs(clip[1])>clip[3]*1.3)continue;
 if(known)measured++;
 nodes.add(new TerrainHudView.Node(ix,iz,clip[0]/clip[3],clip[1]/clip[3],elevation,known,c!=null&&c.estimate.uncertain,known&&now-c.estimate.seen>3000,c==null?.05f:c.estimate.deadband(TerrainMath.distance(ix,iz)),spacing,(float)Math.hypot(world[0]-cameraPosition[0],world[2]-cameraPosition[2])));
 }
 } 
 String message=rangeMeters+" m 보기 · 시작 위치 고정 · 안정 높이 "+measured+"개 · 저장값 유지";
 if(nodes.isEmpty()) message="격자가 시야 밖에 있습니다 · 선택한 보기 범위\n카메라를 발 앞쪽으로 낮추세요. 멀리 이동했다면 현재 위치로 초기화하세요.";
 else if(measured==0) message="기준 격자 표시 중 · 높이는 미측정입니다\n점선은 평면 추정입니다. 폰을 좌우로 10~20 cm 천천히 이동하며 같은 바닥을 2~3초 스캔하세요.";
 if(cells.values().stream().anyMatch(c->c.estimate.uncertain))message+="\n관측 불일치: 같은 격자를 다시 스캔하세요. 지속되면 초기화하세요.";
 
 listener.update(new TerrainHudView.Scene(nodes),message);

 }catch(com.google.ar.core.exceptions.SessionPausedException ignored){}catch(Exception e){Log.e("ParkCaddy","AR frame",e);empty("측정 재시도 중 · "+e.getClass().getSimpleName());}
 }
 private void record(String type,String payload){MeasurementRecorder out=recorder;if(out!=null)out.event(type,segment,payload);}
 private void empty(String m){long now=android.os.SystemClock.elapsedRealtime();if(!m.equals(lastRecordedStatus)||now-lastStatusRecord>3000){record("status",MeasurementRecorder.json("elapsed_ms",now,"message",m,"range_m",rangeMeters));lastRecordedStatus=m;lastStatusRecord=now;}listener.update(new TerrainHudView.Scene(new ArrayList<>()),m);}
 private void drawCamera(Frame f){
 if(f.getTimestamp()==0)return;
 quad.rewind();uv.rewind();f.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,quad,Coordinates2d.TEXTURE_NORMALIZED,uv);quad.rewind();uv.rewind();GLES20.glUseProgram(program);
 int p=GLES20.glGetAttribLocation(program,"p"),u=GLES20.glGetAttribLocation(program,"uv");
 GLES20.glVertexAttribPointer(p,2,GLES20.GL_FLOAT,false,0,quad);GLES20.glEnableVertexAttribArray(p);GLES20.glVertexAttribPointer(u,2,GLES20.GL_FLOAT,false,0,uv);GLES20.glEnableVertexAttribArray(u);
 GLES20.glActiveTexture(GLES20.GL_TEXTURE0);GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,texture);GLES20.glUniform1i(GLES20.glGetUniformLocation(program,"tex"),0);
 GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP,0,4);GLES20.glDisableVertexAttribArray(p);GLES20.glDisableVertexAttribArray(u);
 }
 private void lock(Frame f){
 Pose camera=f.getCamera().getPose();
 boolean sawPlane=false,wrongHeight=false;
 referenceMessage="바닥 찾는 중 · 사물만 보이면 기준을 잡을 수 없습니다\n밝은 곳에서 타일·마루 이음선이 보이게 폰을 허리 높이로 들고 천천히 좌우 이동하세요.";
 for(float y:new float[]{.8f,.65f,.5f})for(float x:new float[]{.5f,.3f,.7f})for(HitResult hit:f.hitTest(width*x,height*y)){
 if(!(hit.getTrackable() instanceof Plane))continue;
 Plane p=(Plane)hit.getTrackable();Plane parent=p.getSubsumedBy();if(parent!=null)p=parent;
 if(p.getType()!=Plane.Type.HORIZONTAL_UPWARD_FACING||p.getTrackingState()!=TrackingState.TRACKING||!p.isPoseInPolygon(hit.getHitPose()))continue;
 sawPlane=true;float floor=hit.getHitPose().ty(),above=camera.ty()-floor;
 if(above<.4f||above>2.3f){wrongHeight=true;continue;}
 if(referencePlane!=null&&referencePlane.getSubsumedBy()!=null)referencePlane=referencePlane.getSubsumedBy();
 // ARCore may return a new Java wrapper for the SAME logical plane each frame.
 if(!p.equals(referencePlane)){reference.clear();referencePlane=p;}
 referenceMessage="바닥 후보 인식 · 기준 높이를 안정화하는 중\n같은 바닥을 약 2초 유지해 주세요. 보정 후 점선 격자가 먼저 표시됩니다.";
 if(reference.add(floor,android.os.SystemClock.elapsedRealtime())){
 anchor=session.createAnchor(Pose.makeTranslation(camera.tx(),reference.median(),camera.tz()));
 record("reference",MeasurementRecorder.json("pose",poseValues(anchor.getPose()),"frame_ns",f.getTimestamp()));
 Log.i("ParkCaddy","Reference locked after stable plane observations");
 }
 return;
 }
 if(sawPlane&&wrongHeight)referenceMessage="평면은 찾았지만 기준 높이 조건이 맞지 않습니다\n폰을 바닥에서 0.4~2.3 m 높이로 들고, 책상 대신 발 앞 바닥을 비춰 주세요.";
 }

 private static float[] poseValues(Pose p){float[] t=p.getTranslation(),q=p.getRotationQuaternion();return new float[]{t[0],t[1],t[2],q[0],q[1],q[2],q[3]};}
 private void sample(Frame f,long now){
 try(android.media.Image depth=f.acquireRawDepthImage16Bits();android.media.Image confidence=f.acquireRawDepthConfidenceImage()){
 if(depth.getTimestamp()==lastDepth)return;lastDepth=depth.getTimestamp();
 if(confidence.getWidth()!=depth.getWidth()||confidence.getHeight()!=depth.getHeight())return;
 android.media.Image.Plane confidencePlane=confidence.getPlanes()[0];ByteBuffer confidenceData=confidencePlane.getBuffer();
 CameraIntrinsics intr=f.getCamera().getImageIntrinsics();
 int[] size=intr.getImageDimensions();float[] focal=intr.getFocalLength(),center=intr.getPrincipalPoint();
 float sx=(float)depth.getWidth()/size[0],sy=(float)depth.getHeight()/size[1];
 float fx=focal[0]*sx,fy=focal[1]*sy,cx=center[0]*sx,cy=center[1]*sy;
 android.media.Image.Plane plane=depth.getPlanes()[0];ByteBuffer data=plane.getBuffer().order(ByteOrder.LITTLE_ENDIAN);
 Pose cameraToMap=anchor.getPose().inverse().compose(f.getCamera().getPose());
 boolean logFrame=recorder!=null&&recorder.enabled&&now-lastTelemetry>=1000;if(logFrame)lastTelemetry=now;
 ArrayList<Object> rawLog=logFrame?new ArrayList<>():null,cellLog=logFrame?new ArrayList<>():null;
 int validPixels=0,lowConfidence=0,outside=0;
 HashMap<String,float[]> batches=new HashMap<>();
 int step=1; // Raw depth is sparse: inspect every pixel, confidence-gated.
 for(int y=0;y<depth.getHeight();y+=step)for(int x=0;x<depth.getWidth();x+=step){
 int conf=confidenceData.get(y*confidencePlane.getRowStride()+x*confidencePlane.getPixelStride())&0xff;
 int offset=y*plane.getRowStride()+x*plane.getPixelStride();int mm=data.getShort(offset)&0xffff;float d=mm*.001f;
 if(logFrame&&x%16==0&&y%16==0)rawLog.add(new float[]{x,y,mm,conf});
 if(conf<180){lowConfidence++;continue;}validPixels++;
 if(d<.3f||d>50)continue;
 float[] p=cameraToMap.transformPoint(DepthGeometry.unproject(x,y,mm,fx,fy,cx,cy));
 float distance=(float)Math.hypot(p[0],p[2]);if(distance<.3f||distance>rangeMeters||Math.abs(p[1])>2){outside++;continue;}
 int ix=RangePolicy.bin(p[0],distance),iz=RangePolicy.bin(p[2],distance);String key=ix+":"+iz;
 float[] a=batches.get(key);
 if(a==null){a=new float[]{ix,iz,0,0,p[1],p[1],0};batches.put(key,a);}
 a[2]+=p[1];a[3]++;a[6]+=conf;a[4]=Math.min(a[4],p[1]);a[5]=Math.max(a[5],p[1]);
 }
 for(Map.Entry<String,float[]> entry:batches.entrySet()){
 float[] a=entry.getValue();if(a[3]<2||a[5]-a[4]>.12f){if(logFrame)cellLog.add(Arrays.asList((int)a[0],(int)a[1],(int)a[3],a[2]/a[3],a[4],a[5],a[6]/a[3],null,"frame_rejected"));continue;}
 float y=a[2]/a[3];Cell c=cells.get(entry.getKey());
 if(c==null){c=new Cell((int)a[0],(int)a[1]);cells.put(entry.getKey(),c);}
 c.estimate.observe(y,now,cameraToMap.tx(),cameraToMap.ty(),cameraToMap.tz());
 if(logFrame)cellLog.add(Arrays.asList(c.x,c.z,(int)a[3],y,a[4],a[5],a[6]/a[3],c.estimate.published?c.estimate.y:null,c.estimate.uncertain?"disagreement":!c.estimate.published?"pending":now-c.estimate.seen>3000?"saved":"stable",c.estimate.decision,c.estimate.observationCount(),c.estimate.lastBaseline));
 }
 if(logFrame)record("depth_frame",MeasurementRecorder.json("frame_ns",f.getTimestamp(),"depth_ns",depth.getTimestamp(),"elapsed_ms",now,"range_m",rangeMeters,"rotation",rotation,"tracking",f.getCamera().getTrackingState().name(),"camera_world",poseValues(f.getCamera().getPose()),"anchor_world",poseValues(anchor.getPose()),"camera_map",poseValues(cameraToMap),"width",depth.getWidth(),"height",depth.getHeight(),"fx",fx,"fy",fy,"cx",cx,"cy",cy,"confidence_pass_pixels",validPixels,"low_confidence_pixels",lowConfidence,"outside_map_pixels",outside,"raw_subset",rawLog,"cells",cellLog));
 cells.values().removeIf(c->!c.estimate.published&&now-c.estimate.lastObservation>30000);
 }catch(com.google.ar.core.exceptions.NotYetAvailableException ignored){if(now-lastStatusRecord>3000){record("depth_unavailable",MeasurementRecorder.json("elapsed_ms",now,"range_m",rangeMeters));lastStatusRecord=now;}}
 }
}
