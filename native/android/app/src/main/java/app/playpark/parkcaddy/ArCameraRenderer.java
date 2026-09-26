package app.playpark.parkcaddy;
import android.opengl.*;
import android.util.Log;
import com.google.ar.core.*;
import java.nio.*;
import java.util.*;
final class ArCameraRenderer implements GLSurfaceView.Renderer {
 interface Listener {void update(TerrainHudView.Scene scene,String message,ScanProgress progress);}
 private final Listener listener;
 volatile NativeCloudSync cloud; private final String cloudSession=UUID.randomUUID().toString();
 volatile MeasurementRecorder recorder;private int segment;private long lastTelemetry,lastStatusRecord;private String lastRecordedStatus="";
 volatile Session session; volatile int rotation; volatile boolean resetRequested; volatile int rangeMeters=6;
 private int width,height,texture,program; private Anchor anchor;
 private MeasurementPolicy policy=new MeasurementPolicy(false),pendingPolicy;
 volatile String debugInfo="AR 세션 준비 중 · 아직 관측된 깊이 없음";
 volatile String referenceInfo="기준 높이: 지면 인식 대기\n카메라 높이: 아직 관측값 없음";
 private int depthWidth,depthHeight,confidencePassed,confidenceRejected,usablePixels,frameRejected;
 private long lastDepthAt,lastDebug,lastUsableDepthAt,scanWaitSince;
 private int validDepthFrames;private boolean trackingInterrupted;private String scanWaitPhase="";
 private String depthStatus="아직 관측된 깊이 없음";
 private float depthFx,depthFy,cameraMapX,cameraMapY,cameraMapZ,meanDepthMeters;
 synchronized void setPolicy(MeasurementPolicy value){pendingPolicy=value;}
 private synchronized MeasurementPolicy takePolicy(){MeasurementPolicy value=pendingPolicy;pendingPolicy=null;return value;}
 private final HashMap<String,Cell> cells=new HashMap<>();
 private long lastSample,lastFrame,lastDepth,lastReferenceFrame;
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
 MeasurementPolicy changed=takePolicy();
 if(changed!=null){policy=changed;resetRequested=true;}
 if(resetRequested){segment++;record("reset",MeasurementRecorder.json("elapsed_ms",android.os.SystemClock.elapsedRealtime()));if(anchor!=null)anchor.detach();anchor=null;cells.clear();reference.clear();referencePlane=null;lastDepth=lastDepthAt=lastDebug=lastUsableDepthAt=lastReferenceFrame=0;validDepthFrames=0;scanWaitPhase="";depthWidth=depthHeight=confidencePassed=confidenceRejected=usablePixels=frameRejected=0;depthFx=depthFy=cameraMapX=cameraMapY=cameraMapZ=0;depthStatus="기준점 재설정 · 깊이 대기";record("measurement_policy",policy.metadata());resetRequested=false;}
 s.setCameraTextureName(texture);s.setDisplayGeometry(rotation,width,height);Frame f=s.update();drawCamera(f);
 if(f.getCamera().getTrackingState()!=TrackingState.TRACKING){invalidateTracking();reference.clear();empty(TrackingGuide.tracking(f.getCamera().getTrackingFailureReason().name()));return;}
 if(anchor==null)lock(f);
 if(anchor==null){long at=android.os.SystemClock.elapsedRealtime();empty(referenceMessage,referenceMessage.contains("기준 높이 조건")?ScanProgress.blocked("폰을 지면에서 0.4–2.3 m 높이로 들고 발 앞을 비춰 주세요"):ScanProgress.reference(reference.observationCount(at),waitElapsed("reference",at)));return;}
 if(anchor.getTrackingState()!=TrackingState.TRACKING){invalidateTracking();empty("격자 대기: 기존 기준점을 놓쳤습니다\n원래 지면을 다시 비추세요. 위치를 옮겼다면 현재 위치로 초기화하세요.");return;}
 long now=android.os.SystemClock.elapsedRealtime();
 if(lastUsableDepthAt>0&&!ScanProgress.fresh(lastUsableDepthAt,now))invalidateTracking();
 if(trackingInterrupted){trackingInterrupted=false;scanWaitPhase="";}
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
 Cell c=cells.get(ix+":"+iz);boolean known=c!=null&&c.estimate.valid()&&ScanProgress.fresh(c.estimate.seen,now)&&ScanProgress.fresh(lastUsableDepthAt,now);float elevation=known?c.estimate.y:0;
 float[] world=pose.transformPoint(new float[]{TerrainMath.gridMeters(ix),elevation,TerrainMath.gridMeters(iz)}),clip=new float[4];
 Matrix.multiplyMV(clip,0,vp,0,new float[]{world[0],world[1],world[2],1},0);
 if(clip[3]<.15f||Math.abs(clip[0])>clip[3]*1.3||Math.abs(clip[1])>clip[3]*1.3)continue;
 if(known)measured++;
 nodes.add(new TerrainHudView.Node(ix,iz,clip[0]/clip[3],clip[1]/clip[3],elevation,known,c!=null&&c.estimate.uncertain,known&&now-c.estimate.seen>3000,c==null?.05f:c.estimate.deadband(TerrainMath.distance(ix,iz)),spacing,(float)Math.hypot(world[0]-cameraPosition[0],world[2]-cameraPosition[2])));
 }
 } 
 String message="관측 높이 "+measured+"곳 · 시작 위치 기준\n천천히 같은 지면을 비추세요. 현장 정확도는 검증 전입니다.";
 if(nodes.isEmpty()) message="격자가 시야 밖에 있습니다 · 선택한 보기 범위\n카메라를 발 앞쪽으로 낮추세요. 멀리 이동했다면 현재 위치로 초기화하세요.";
 else if(measured==0) message="아직 높이를 측정하지 못했습니다\n같은 바닥을 보며 폰을 좌우 10~20 cm 천천히 움직이세요.";
 if(cells.values().stream().anyMatch(c->c.estimate.uncertain))message+="\n관측 불일치: 같은 격자를 다시 스캔하세요. 지속되면 초기화하세요.";
 
 updateDiagnostics(now);listener.update(new TerrainHudView.Scene(nodes),message,scanProgress(nodes,now));

 }catch(com.google.ar.core.exceptions.SessionPausedException ignored){}catch(Exception e){Log.e("ParkCaddy","AR frame",e);empty("측정 재시도 중 · "+e.getClass().getSimpleName());}
 }
 private void record(String type,String payload){MeasurementRecorder out=recorder;if(out!=null)out.event(type,segment,payload);}
 private long waitElapsed(String phase,long now){if(!phase.equals(scanWaitPhase)){scanWaitPhase=phase;scanWaitSince=now;}return Math.max(0,now-scanWaitSince);}
 private void invalidateTracking(){
  if(trackingInterrupted)return;trackingInterrupted=true;
  // Old coordinates must earn fresh observations after relocalization.
  cells.clear();lastDepthAt=lastUsableDepthAt=0;validDepthFrames=0;
 }
 private ScanProgress scanProgress(ArrayList<TerrainHudView.Node> nodes,long now){
  int candidates=0,stable=0;StableHeight best=null;
  for(TerrainHudView.Node node:nodes){
   if(Math.abs(node.x)>1||Math.abs(node.y)>1)continue;
   Cell cell=cells.get(node.ix+":"+node.iz);
   if(cell==null||!ScanProgress.fresh(cell.estimate.lastObservation,now))continue;
   candidates++;if(node.known)stable++;
   if(best==null||cell.estimate.observationCount()>best.observationCount()||(cell.estimate.observationCount()==best.observationCount()&&cell.estimate.lastBaseline>best.lastBaseline))best=cell.estimate;
  }
  boolean freshDepth=ScanProgress.fresh(lastUsableDepthAt,now);
  long wait=waitElapsed(stable>0?"showing":!freshDepth||candidates==0?"depth":"measure",now);
  return ScanProgress.measuring(validDepthFrames,candidates,stable,best==null?0:best.observationCount(),
    best==null?0:best.lastBaseline,best==null?0:best.observationDurationMs(),best==null?"":best.decision,freshDepth,wait);
 }
 private void empty(String m){long now=android.os.SystemClock.elapsedRealtime();String[] lines=m.split("\\n",2);empty(m,ScanProgress.waiting(lines[0],lines.length>1?lines[1]:"밝은 지면의 무늬를 천천히 비춰 주세요",waitElapsed("tracking:"+m,now)));}
 private void empty(String m,ScanProgress progress){referenceInfo="현재 기준 높이를 확인할 수 없습니다.\n"+m;debugInfo="추적 / 기준점 상태\n"+m+"\n현재 수치를 표시하지 않습니다.\n"+policyText();long now=android.os.SystemClock.elapsedRealtime();if(!m.equals(lastRecordedStatus)||now-lastStatusRecord>3000){record("status",MeasurementRecorder.json("elapsed_ms",now,"message",m,"range_m",rangeMeters));lastRecordedStatus=m;lastStatusRecord=now;}listener.update(new TerrainHudView.Scene(new ArrayList<>()),m,progress);}
 private void drawCamera(Frame f){
 if(f.getTimestamp()==0)return;
 quad.rewind();uv.rewind();f.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,quad,Coordinates2d.TEXTURE_NORMALIZED,uv);quad.rewind();uv.rewind();GLES20.glUseProgram(program);
 int p=GLES20.glGetAttribLocation(program,"p"),u=GLES20.glGetAttribLocation(program,"uv");
 GLES20.glVertexAttribPointer(p,2,GLES20.GL_FLOAT,false,0,quad);GLES20.glEnableVertexAttribArray(p);GLES20.glVertexAttribPointer(u,2,GLES20.GL_FLOAT,false,0,uv);GLES20.glEnableVertexAttribArray(u);
 GLES20.glActiveTexture(GLES20.GL_TEXTURE0);GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,texture);GLES20.glUniform1i(GLES20.glGetUniformLocation(program,"tex"),0);
 GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP,0,4);GLES20.glDisableVertexAttribArray(p);GLES20.glDisableVertexAttribArray(u);
 }
 private void lock(Frame f){
 if(f.getTimestamp()<=lastReferenceFrame)return;lastReferenceFrame=f.getTimestamp();
 Pose camera=f.getCamera().getPose();
 boolean sawPlane=false,wrongHeight=false;
 referenceMessage="지면 후보 찾는 중 · 책상·벤치 대신 발 앞 지면을 비춰 주세요\n밝은 곳에서 타일·마루 이음선이 보이게 폰을 허리 높이로 들고 천천히 좌우 이동하세요.";
 for(float y:new float[]{.8f,.65f,.5f})for(float x:new float[]{.5f,.3f,.7f})for(HitResult hit:f.hitTest(width*x,height*y)){
 if(!(hit.getTrackable() instanceof Plane))continue;
 Plane p=(Plane)hit.getTrackable();Plane parent=p.getSubsumedBy();if(parent!=null)p=parent;
 if(p.getType()!=Plane.Type.HORIZONTAL_UPWARD_FACING||p.getTrackingState()!=TrackingState.TRACKING||!p.isPoseInPolygon(hit.getHitPose()))continue;
 sawPlane=true;float floor=hit.getHitPose().ty(),above=camera.ty()-floor;
 if(above<.4f||above>2.3f){wrongHeight=true;continue;}
 if(referencePlane!=null&&referencePlane.getSubsumedBy()!=null)referencePlane=referencePlane.getSubsumedBy();
 // ARCore may return a new Java wrapper for the SAME logical plane each frame.
 if(!p.equals(referencePlane)){reference.clear();referencePlane=p;}
 referenceMessage="바닥 후보 인식 · 기준 높이를 안정화하는 중\n같은 바닥을 약 2초 유지해 주세요. 이후 폰을 좌우로 천천히 움직여 주세요.";
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
 if(depth.getTimestamp()<=lastDepth)return;lastDepth=depth.getTimestamp();
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
 int validPixels=0,lowConfidence=0,outside=0,depthCount=0;double depthTotal=0;usablePixels=frameRejected=0;
 HashMap<String,float[]> batches=new HashMap<>();
 int step=1; // Raw depth is sparse: inspect every pixel, confidence-gated.
 for(int y=0;y<depth.getHeight();y+=step)for(int x=0;x<depth.getWidth();x+=step){
 int conf=confidenceData.get(y*confidencePlane.getRowStride()+x*confidencePlane.getPixelStride())&0xff;
 int offset=y*plane.getRowStride()+x*plane.getPixelStride();int mm=data.getShort(offset)&0xffff;float d=mm*.001f;
 if(logFrame&&x%16==0&&y%16==0)rawLog.add(new float[]{x,y,mm,conf});
 if(conf<policy.confidenceMin){lowConfidence++;continue;}validPixels++;
 if(!policy.acceptsDepth(d,conf))continue;depthCount++;depthTotal+=d;
 float[] p=cameraToMap.transformPoint(DepthGeometry.unproject(x,y,mm,fx,fy,cx,cy));
 float distance=(float)Math.hypot(p[0],p[2]);if(distance<.3f||distance>rangeMeters||Math.abs(p[1])>2){outside++;continue;}
 usablePixels++;int ix=RangePolicy.bin(p[0],distance),iz=RangePolicy.bin(p[2],distance);String key=ix+":"+iz;
 float[] a=batches.get(key);
 if(a==null){a=new float[]{ix,iz,0,0,p[1],p[1],0};batches.put(key,a);}
 a[2]+=p[1];a[3]++;a[6]+=conf;a[4]=Math.min(a[4],p[1]);a[5]=Math.max(a[5],p[1]);
 }
 int acceptedBatches=0;
 for(Map.Entry<String,float[]> entry:batches.entrySet()){
 float[] a=entry.getValue();if(!policy.acceptsFrame(a[3],a[4],a[5])){frameRejected++;if(logFrame)cellLog.add(Arrays.asList((int)a[0],(int)a[1],(int)a[3],a[2]/a[3],a[4],a[5],a[6]/a[3],null,"frame_rejected"));continue;}
 acceptedBatches++;float y=a[2]/a[3];Cell c=cells.get(entry.getKey());
 if(c==null){c=new Cell((int)a[0],(int)a[1]);cells.put(entry.getKey(),c);}
 c.estimate.observe(y,now,cameraToMap.tx(),cameraToMap.ty(),cameraToMap.tz());
 if(logFrame)cellLog.add(Arrays.asList(c.x,c.z,(int)a[3],y,a[4],a[5],a[6]/a[3],c.estimate.published?c.estimate.y:null,c.estimate.uncertain?"disagreement":!c.estimate.published?"pending":now-c.estimate.seen>3000?"saved":"stable",c.estimate.decision,c.estimate.observationCount(),c.estimate.lastBaseline));
 }
 if(acceptedBatches>0){validDepthFrames++;lastUsableDepthAt=now;}
 depthWidth=depth.getWidth();depthHeight=depth.getHeight();depthFx=fx;depthFy=fy;
 meanDepthMeters=depthCount==0?Float.NaN:(float)(depthTotal/depthCount);
 confidencePassed=validPixels;confidenceRejected=lowConfidence;lastDepthAt=now;
 cameraMapX=cameraToMap.tx();cameraMapY=cameraToMap.ty();cameraMapZ=cameraToMap.tz();
 depthStatus="Raw Depth 수신";
 if(logFrame)record("depth_frame",MeasurementRecorder.json("policy",new MeasurementRecorder.Raw(policy.metadata()),"frame_ns",f.getTimestamp(),"depth_ns",depth.getTimestamp(),"elapsed_ms",now,"range_m",rangeMeters,"rotation",rotation,"tracking",f.getCamera().getTrackingState().name(),"camera_world",poseValues(f.getCamera().getPose()),"anchor_world",poseValues(anchor.getPose()),"camera_map",poseValues(cameraToMap),"width",depth.getWidth(),"height",depth.getHeight(),"fx",fx,"fy",fy,"cx",cx,"cy",cy,"confidence_pass_pixels",validPixels,"low_confidence_pixels",lowConfidence,"outside_map_pixels",outside,"raw_subset",rawLog,"cells",cellLog));
 cells.values().removeIf(c->!c.estimate.published&&now-c.estimate.lastObservation>30000);
 }catch(com.google.ar.core.exceptions.NotYetAvailableException ignored){depthStatus="새 깊이 관측 대기";if(now-lastStatusRecord>3000){record("depth_unavailable",MeasurementRecorder.json("elapsed_ms",now,"range_m",rangeMeters));lastStatusRecord=now;}}
 }
 private String policyText(){
 return "필터: "+(policy.strict?"엄격":"기본")+" / 센서 신뢰도 ≥ "+policy.confidenceMin+"/255"+
   "\n광학축 깊이 0.3~"+policy.depthMaxMeters+" m / 격자 내 한 프레임 높이 폭 ≤ "+Math.round(policy.frameSpreadMaxMeters*100)+" cm"+
   "\n신뢰도와 반복 안정성은 정확도 확률이 아닙니다.";
 }
 private void updateDiagnostics(long now){
 if(now-lastDebug<500)return;lastDebug=now;
 if(lastDepthAt==0){
  referenceInfo="기준 지면: 0 cm (AR 자동 설정)\n카메라 높이: 새 깊이 관측 대기";
  debugInfo="추적: 정상 / 기준점: 고정\n깊이 관측: 아직 없음\n픽셀 통계·MAD·카메라 좌표: 관측 대기\n"+policyText();
  return;
 }
 referenceInfo=String.format(Locale.KOREA,"기준 지면: 0 cm (AR 자동 설정)\n카메라의 기준 지면 대비 높이: %.2f m\n마지막 깊이 관측: %s",cameraMapY,lastDepthAt==0?"아직 없음":String.format(Locale.KOREA,"%.1f초 전",(now-lastDepthAt)/1000f));
 int stable=0,pending=0,uncertain=0,retained=0;float maxBaseline=0,maxScatter=0;
 for(Cell cell:cells.values()){
  StableHeight estimate=cell.estimate;
  if(estimate.valid()&&ScanProgress.fresh(estimate.seen,now))stable++;else if(estimate.valid())retained++;else if(estimate.uncertain)uncertain++;else pending++;
  maxBaseline=Math.max(maxBaseline,estimate.lastBaseline);
  if(estimate.valid())maxScatter=Math.max(maxScatter,estimate.scatter);
 }
 debugInfo=String.format(Locale.KOREA,
  "추적: 정상 / 기준점: 고정\n%s / 마지막 수신: %s\n깊이 영상: %d × %d px / fx %.1f px / fy %.1f px\n신뢰도 통과 %d / 탈락 %d 픽셀\n지면 후보 %d 픽셀 / 프레임 탈락 %d 격자\n현재 안정 %d / 대기 %d / 불일치 %d / 과거 %d 격자\n관측 이동폭 최대 %.1f cm / 안정 격자 MAD 최대 %.1f cm\n카메라 기준점 좌표: (%.2f, %.2f, %.2f) m\n깊이 시점: %d ns\n유효 깊이 프레임: %d회\n단조 경과시계: %d ms\n격자 크기: 0.25 m / 관찰 범위: %d m\n%s",
  depthStatus,lastDepthAt==0?"없음":String.format(Locale.KOREA,"%.1f초 전",(now-lastDepthAt)/1000f),
  depthWidth,depthHeight,depthFx,depthFy,confidencePassed,confidenceRejected,usablePixels,frameRejected,
  stable,pending,uncertain,retained,maxBaseline*100,maxScatter*100,cameraMapX,cameraMapY,cameraMapZ,lastDepth,validDepthFrames,now,rangeMeters,policyText());
 NativeCloudSync sync=cloud;
 if(sync!=null&&sync.consented()&&stable>0&&now-lastDepthAt<=3000){
  ArrayList<Cell> ordered=new ArrayList<>(cells.values());
  ordered.sort((a,b)->Float.compare(TerrainMath.distance(a.x,a.z),TerrainMath.distance(b.x,b.z)));
  ArrayList<Object> samples=new ArrayList<>();
  for(Cell cell:ordered){
   if(!cell.estimate.valid()||now-cell.estimate.seen>3000)continue;
   samples.add(new MeasurementRecorder.Raw(MeasurementRecorder.json("xM",TerrainMath.gridMeters(cell.x),"zM",TerrainMath.gridMeters(cell.z),
     "relativeHeightM",cell.estimate.y,"horizontalDistanceM",TerrainMath.distance(cell.x,cell.z),"madM",cell.estimate.scatter,
     "observations",cell.estimate.observationCount(),"ageMs",now-cell.estimate.seen)));
   if(samples.size()>=24)break;
  }
  if(!samples.isEmpty())sync.offer(MeasurementRecorder.json("algorithm",MeasurementPolicy.ALGORITHM,"accuracyValidated",false,
   "sessionId",cloudSession,"segment",segment,"location",null,"locationSource","not_collected","photosIncluded",false,
   "deviceModel",android.os.Build.MODEL,"depthWidthPx",depthWidth,"depthHeightPx",depthHeight,"fxPx",depthFx,"fyPx",depthFy,
   "meanOpticalDepthM",meanDepthMeters,"depthTimestampNs",lastDepth,"elapsedMs",now,"rangeM",rangeMeters,
   "confidencePassedPixels",confidencePassed,"confidenceRejectedPixels",confidenceRejected,"stableCells",stable,"pendingCells",pending,
   "uncertainCells",uncertain,"cameraHeightM",cameraMapY,"policy",new MeasurementRecorder.Raw(policy.metadata()),"samples",samples));
 }
 }
}
