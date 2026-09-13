package app.playpark.parkcaddy;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.*;
public final class RecorderCheck {
 static void check(boolean b,String s){if(!b)throw new AssertionError(s);}
 static byte[] export(MeasurementRecorder r)throws Exception{
  ByteArrayOutputStream out=new ByteArrayOutputStream();CountDownLatch done=new CountDownLatch(1);String[] error={null};
  r.export(out,e->{error[0]=e;done.countDown();});check(done.await(10,TimeUnit.SECONDS),"export timeout");check(error[0]==null,"export error "+error[0]);return out.toByteArray();
 }
 public static void main(String[] args)throws Exception{
  File dir=Files.createTempDirectory("parkcaddy-recorder-test-").toFile();
  MeasurementRecorder r=new MeasurementRecorder(dir,MeasurementRecorder.json("test",true));
  r.event("test",0,MeasurementRecorder.json("height",-.14f,"text","한글\nquote\"\\","not_finite",Float.NaN));
  r.event("reset",1,"{}");r.enabled=false;r.event("must_not_record",1,"{}");
  byte[] zip=export(r);int runs=0;String contents="";
  try(ZipInputStream in=new ZipInputStream(new ByteArrayInputStream(zip))){
   ZipEntry e;while((e=in.getNextEntry())!=null){ByteArrayOutputStream b=new ByteArrayOutputStream();in.transferTo(b);if(e.getName().endsWith(".jsonl")){runs++;contents=b.toString("UTF-8");}}
  }
  check(runs==1,"one run");check(contents.contains("\"height\":-0.14"),"signed height");
  check(contents.contains("\"not_finite\":null"),"nonfinite JSON");check(!contents.contains("must_not_record"),"pause");
  check(contents.contains("\"segment\":1"),"reset segmented");check(dir.listFiles().length==1,"export retains source");
  r.close();
  MeasurementRecorder second=new MeasurementRecorder(dir,"{}");
  byte[] two=export(second);runs=0;
  try(ZipInputStream in=new ZipInputStream(new ByteArrayInputStream(two))){ZipEntry e;while((e=in.getNextEntry())!=null)if(e.getName().endsWith(".jsonl"))runs++;}
  check(runs==2,"prior runs persist");second.close();
  System.out.println("PASS: JSON escaping, finite numbers, ZIP, pause, reset segments and persistent prior runs");
  System.out.println("Test files: "+dir);
 }
}
