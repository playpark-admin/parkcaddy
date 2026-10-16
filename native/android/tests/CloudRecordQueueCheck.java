package app.playpark.parkcaddy;
import java.io.*;
import java.nio.file.*;
import java.util.concurrent.*;

public final class CloudRecordQueueCheck {
  static void check(boolean ok,String reason){if(!ok)throw new AssertionError(reason);}
  public static void main(String[] args)throws Exception{
    File directory=Files.createTempDirectory("parkcaddy-cloud-").toFile();File file=new File(directory,"queue.properties");
    CloudRecordQueue queue=new CloudRecordQueue(file);
    check(!queue.decided()&&!queue.consented(),"default opt-out");
    check(queue.reserve("owner_a","{}",0)==null,"no write without consent");
    queue.consent(true);long generation=queue.generation();
    CloudRecordQueue.Record first=queue.reserve("owner_a","{\"metric\":1}",generation);
    check(first!=null&&queue.canUpload(first),"consented write admitted");
    CloudRecordQueue restored=new CloudRecordQueue(file);
    check(restored.consented()&&restored.records().get(0).id.equals(first.id),"restart preserves consent and stable document id");
    check(restored.records().get(0).owner.equals("owner_a"),"owner persisted before network");
    check(queue.reserve("bad/owner","{}",generation)==null,"owner cannot escape path");
    queue.consent(false);
    check(!queue.canUpload(first)&&queue.hasDeletion(),"revocation immediately blocks retries and preserves cleanup handle");
    queue.uploaded(first);
    check(queue.records().get(0).state.equals("deleting"),"in-flight success after revoke becomes deletion");
    restored=new CloudRecordQueue(file);
    check(restored.hasDeletion()&&!restored.consented(),"deletion survives process death");
    queue.consent(true);
    check(!queue.canUpload(first),"re-consent never revives old generation");
    CloudRecordQueue.Record second=queue.reserve("owner_a","{}",queue.generation());
    queue.uploaded(second);
    check(queue.records().stream().filter(r->r.id.equals(second.id)).findFirst().get().body.isEmpty(),"acknowledged summary removed locally but handle retained");
    CountDownLatch inFlight=new CountDownLatch(1),finish=new CountDownLatch(1);
    CloudRecordQueue.Record third=queue.reserve("owner_a","{}",queue.generation());
    Thread request=new Thread(()->{try{check(queue.canUpload(third),"initial request authorized");inFlight.countDown();finish.await();queue.uploaded(third);}catch(Exception error){throw new RuntimeException(error);}});
    request.start();check(inFlight.await(2,TimeUnit.SECONDS),"simulated upload began");
    queue.deleteAll();finish.countDown();request.join();
    check(!queue.consented()&&queue.records().stream().allMatch(r->r.state.equals("deleting")),"delete/upload race cannot resurrect records");
    restored=new CloudRecordQueue(file);
    check(restored.records().size()==3,"failed or pending deletes retain all owner handles");
    for(CloudRecordQueue.Record record:restored.records())restored.deleted(record);
    check(new CloudRecordQueue(file).deletionComplete(),"delete acknowledgment durably completes removal");
    CloudRecordQueue recovery=new CloudRecordQueue(file);recovery.consent(true);
    CloudRecordQueue.Record retained=recovery.reserve("owner_a","{}",recovery.generation());
    File backup=new File(file.getPath()+".bak");check(file.renameTo(backup),"simulate interrupted replace");
    check(new CloudRecordQueue(file).records().get(0).id.equals(retained.id),"backup recovery retains document handle");
    System.out.println("PASS: opt-in, durable owner/id, same-id retry, revocation, re-consent generations, in-flight delete race and crash recovery");
  }
}