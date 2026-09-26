package app.playpark.parkcaddy;

import java.io.*;
import java.util.*;

/** Durable owner/document handles. Never remove a handle before acknowledged deletion. */
final class CloudRecordQueue {
  static final int MAX_PENDING = 64, MAX_HANDLES = 5000;
  static final class Record {
    final String id, owner, body, state;
    final long generation;
    Record(String id, String owner, String body, String state, long generation) {
      this.id=id; this.owner=owner; this.body=body; this.state=state; this.generation=generation;
    }
  }
  private final File file;
  private final Properties data = new Properties();
  private boolean healthy = true;
  CloudRecordQueue(File file) throws IOException {
    this.file=file;
    File backup=new File(file.getPath()+".bak");
    if (!file.exists() && backup.exists() && !backup.renameTo(file)) throw new IOException("Queue recovery failed");
    if (file.exists()) try (InputStream input=new FileInputStream(file)) { data.load(input); }
  }
  synchronized boolean decided() { return Boolean.parseBoolean(data.getProperty("decided","false")); }
  synchronized boolean consented() { return healthy && Boolean.parseBoolean(data.getProperty("consent","false")); }
  synchronized long generation() { return Long.parseLong(data.getProperty("generation","0")); }
  synchronized void consent(boolean value) throws IOException {
    data.setProperty("decided","true"); data.setProperty("consent",String.valueOf(value));
    data.setProperty("generation",String.valueOf(generation()+1));
    if(value)data.remove("delete_requested");
    for (Record record : records()) if (record.state.equals("pending")) markDeleting(record.id);
    persist();
  }
  synchronized Record reserve(String owner,String body,long generation) throws IOException {
    if (!consented() || generation!=generation() || !owner.matches("[A-Za-z0-9_-]{1,128}")) return null;
    List<Record> existing=records();
    if (existing.size()>=MAX_HANDLES || existing.stream().filter(record -> record.state.equals("pending")).count()>=MAX_PENDING) return null;
    String id=UUID.randomUUID().toString();
    data.setProperty(id+".owner",owner); data.setProperty(id+".body",body);
    data.setProperty(id+".state","pending"); data.setProperty(id+".generation",String.valueOf(generation));
    persist(); return get(id);
  }
  synchronized boolean canUpload(Record record) {
    Record current=get(record.id);
    return consented() && current!=null && current.state.equals("pending")
        && current.generation==generation() && current.generation==record.generation && current.owner.equals(record.owner);
  }
  synchronized void uploaded(Record record) throws IOException {
    if (get(record.id)==null) return;
    if (canUpload(record)) { data.setProperty(record.id+".state","sent"); data.remove(record.id+".body"); }
    else markDeleting(record.id);
    persist();
  }
  synchronized boolean deletionComplete(){return Boolean.parseBoolean(data.getProperty("delete_requested","false"))&&records().isEmpty();}
  synchronized void deleteAll() throws IOException {
    data.setProperty("delete_requested","true");
    data.setProperty("decided","true"); data.setProperty("consent","false");
    data.setProperty("generation",String.valueOf(generation()+1));
    for (Record record : records()) markDeleting(record.id);
    persist();
  }
  synchronized void deleted(Record record) throws IOException {
    Record current=get(record.id);
    if (current==null || !current.state.equals("deleting") || !current.owner.equals(record.owner)) return;
    for (String suffix : new String[]{"owner","body","state","generation"}) data.remove(record.id+"."+suffix);
    persist();
  }
  synchronized boolean hasDeletion() { return records().stream().anyMatch(record -> record.state.equals("deleting")); }
  synchronized List<Record> records() {
    ArrayList<Record> records=new ArrayList<>();
    for (String key:data.stringPropertyNames()) if(key.endsWith(".owner")) {
      Record record=get(key.substring(0,key.length()-6)); if(record!=null) records.add(record);
    }
    records.sort(Comparator.comparing(record->record.id)); return records;
  }
  private Record get(String id) {
    String owner=data.getProperty(id+".owner");
    if(owner==null)return null;
    return new Record(id,owner,data.getProperty(id+".body",""),data.getProperty(id+".state","deleting"),Long.parseLong(data.getProperty(id+".generation","-1")));
  }
  private void markDeleting(String id) { data.setProperty(id+".state","deleting"); data.remove(id+".body"); }
  private void persist() throws IOException {
    File parent=file.getParentFile();
    try {
      if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("Queue directory unavailable");
      File temporary=new File(file.getPath()+".tmp"),backup=new File(file.getPath()+".bak");
      try(FileOutputStream output=new FileOutputStream(temporary)){data.store(output,"ParkCaddy private upload handles");output.getFD().sync();}
      if(backup.exists()&&!backup.delete())throw new IOException("Queue backup unavailable");
      if(file.exists()&&!file.renameTo(backup))throw new IOException("Queue checkpoint failed");
      if(!temporary.renameTo(file)){if(backup.exists())backup.renameTo(file);throw new IOException("Queue replace failed");}
      if(backup.exists())backup.delete();
    } catch(IOException error) { healthy=false; throw error; }
  }
}