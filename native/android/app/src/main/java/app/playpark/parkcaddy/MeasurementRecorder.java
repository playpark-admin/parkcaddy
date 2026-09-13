package app.playpark.parkcaddy;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.zip.*;

/** App-private, bounded local telemetry. No network, photos, GPS or device identifiers. */
final class MeasurementRecorder implements AutoCloseable {
 static final long LIMIT=100L*1024*1024;
 private final File directory,file;
 private final ThreadPoolExecutor worker=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(64));
 private final AtomicLong dropped=new AtomicLong();
 private final String run=UUID.randomUUID().toString();
 private volatile long bytes;
 private volatile String problem="";
 volatile boolean enabled=true;
 private BufferedWriter writer;
 interface Completion {void done(String error);}
 MeasurementRecorder(File directory,String metadata){
  this.directory=directory;file=new File(directory,"run-"+System.currentTimeMillis()+"-"+run+".jsonl");
  submit(()->{
   try{
    if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Cannot create recording directory");
    for(File f:files())bytes+=f.length();
    append(json("type","metadata","schema",1,"run",run,"epoch_ms",System.currentTimeMillis(),"details",new Raw(metadata)));
   }catch(IOException e){problem="저장 실패: "+e.getClass().getSimpleName();}
  });
 }
 String status(){return String.format(Locale.KOREA,"%s · %.1f MB / 100 MB · 누락 %d",problem.isEmpty()?(enabled?"자동 기록 중":"기록 일시정지"):problem,bytes/1048576.0,dropped.get());}
 void event(String type,int segment,String payload){
  if(!enabled||!problem.isEmpty())return;
  String line=json("type",type,"schema",1,"run",run,"segment",segment,"epoch_ms",System.currentTimeMillis(),"data",new Raw(payload));
  submit(()->{try{append(line);}catch(IOException e){problem="저장 실패: "+e.getClass().getSimpleName();}});
 }
 private void submit(Runnable task){try{worker.execute(task);}catch(RejectedExecutionException e){dropped.incrementAndGet();}}
 private File[] files(){
  File[] files=directory.listFiles((dir,name)->name.startsWith("run-")&&name.endsWith(".jsonl"));
  if(files==null)return new File[0];Arrays.sort(files,Comparator.comparing(File::getName));return files;
 }
 private void append(String line)throws IOException{
  long size=line.getBytes(StandardCharsets.UTF_8).length+1;
  if(bytes+size>LIMIT){problem="100 MB 한도: 기록 중지 · 다운로드 후 보관하세요";return;}
  if(writer==null)writer=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(file,true),StandardCharsets.UTF_8));
  writer.write(line);writer.newLine();writer.flush();bytes+=size;
 }
 // The export is serialized after previous writes. Later frames queue or are counted as dropped.
 void export(OutputStream output,Completion completion){
  try{worker.execute(()->{
   String error=null;
   try(ZipOutputStream zip=new ZipOutputStream(output)){
    if(writer!=null)writer.flush();
    zip.putNextEntry(new ZipEntry("README.txt"));zip.write(README.getBytes(StandardCharsets.UTF_8));zip.closeEntry();
    zip.putNextEntry(new ZipEntry("export.json"));
    zip.write(json("schema",1,"export_epoch_ms",System.currentTimeMillis(),"current_run_dropped_chunks",dropped.get(),"recording_status",status()).getBytes(StandardCharsets.UTF_8));zip.closeEntry();
    byte[] buffer=new byte[16384];
    for(File f:files()){
     zip.putNextEntry(new ZipEntry(f.getName()));
     try(InputStream in=new FileInputStream(f)){int n;while((n=in.read(buffer))!=-1)zip.write(buffer,0,n);}
     zip.closeEntry();
    }
   }catch(Exception e){error="내보내기 실패: "+e.getClass().getSimpleName();}
   completion.done(error);
  });}catch(RejectedExecutionException e){try{output.close();}catch(IOException ignored){}completion.done("기록 처리 중입니다. 잠시 후 다시 다운로드하세요.");}
 }
 public void close(){submit(()->{try{if(writer!=null)writer.close();}catch(IOException ignored){}});worker.shutdown();}
 static final class Raw {final String value;Raw(String value){this.value=value;}}
 static String json(Object... pairs){
  StringBuilder b=new StringBuilder("{");for(int i=0;i<pairs.length;i+=2){if(i>0)b.append(',');value(b,pairs[i].toString());b.append(':');value(b,pairs[i+1]);}return b.append('}').toString();
 }
 private static void value(StringBuilder b,Object value){
  if(value==null){b.append("null");return;}
  if(value instanceof Raw){b.append(((Raw)value).value);return;}
  if(value instanceof Number){double d=((Number)value).doubleValue();b.append(Double.isFinite(d)?value.toString():"null");return;}
  if(value instanceof Boolean){b.append(value);return;}
  if(value instanceof float[]){b.append('[');float[] a=(float[])value;for(int i=0;i<a.length;i++){if(i>0)b.append(',');value(b,a[i]);}b.append(']');return;}
  if(value instanceof Iterable){b.append('[');boolean comma=false;for(Object x:(Iterable<?>)value){if(comma)b.append(',');value(b,x);comma=true;}b.append(']');return;}
  b.append('"');for(char c:value.toString().toCharArray()){switch(c){
   case '"':b.append("\\\"");break;case '\\':b.append("\\\\");break;case '\n':b.append("\\n");break;case '\r':b.append("\\r");break;case '\t':b.append("\\t");break;
   default:if(c<32)b.append(String.format(Locale.ROOT,"\\u%04x",(int)c));else b.append(c);
  }}b.append('"');
 }
 static final String README=
  "ParkCaddy calibration diagnostics / schema 1\n"+
  "JSONL: one JSON object per line. All run files are exported, including current partial run.\n"+
  "No camera images, audio, GPS, account or unique hardware identifier. No server upload.\n"+
  "Measurements are estimates, NOT ground truth. Compare to independently measured reference distances/heights.\n"+
  "Run UUID separates AR coordinate systems; segment increments on reset. Never combine coordinates across runs/segments without registration.\n"+
  "Frame telemetry sampled at most once per second. It is NOT a full depth/video recording.\n"+
  "epoch_ms=UTC Unix wall-clock milliseconds; frame_ns/depth_ns=AR timestamps, monotonic nanoseconds, not UTC.\n"+
  "camera_world and anchor_world are [tx,ty,tz,qx,qy,qz,qw] in ARCore world; camera_map is relative to anchor.\n"+
  "depth intrinsics fx,fy,cx,cy are scaled to depth image dimensions; raw depth is optical-axis millimetres.\n"+
  "raw_subset rows: [pixel_x,pixel_y,depth_mm,confidence_0_255]. Deterministic sparse subset, including low confidence; not the full image.\n"+
  "cells rows: [ix,iz,count,mean_input_height_m,min_height_m,max_height_m,mean_confidence,filtered_height_m_or_null,state].\n"+
  "Grid index unit 0.25 m, horizontal distance=hypot(ix,iz)*0.25. Negative height means below reference.\n"+
  "Cell state: frame_rejected, pending, stable, saved, disagreement. Stored filtered values are not independent ground truth.\n"+
  "Non-frame-rejected cell rows append: [temporal_decision,temporal_sample_count,camera_baseline_m]. Decisions distinguish sample/time shortage, translation_required, unstable_height, disagreement, accepted.\n"+
  "No automatic deletion. Recording stops at 100 MiB. App uninstall or Android clear-data removes internal files; export first.\n"+
  "A force stop/crash may leave an incomplete final JSON line; parsers should skip only that trailing malformed line.\n"+
  "Queue overflow is reported in export.json for the current run. Export does not delete originals.\n";
}
