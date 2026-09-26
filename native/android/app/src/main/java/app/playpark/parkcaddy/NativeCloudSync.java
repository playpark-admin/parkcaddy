package app.playpark.parkcaddy;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.*;

/** Opt-in numeric summaries only. No camera image, GPS, client reads or per-record send UI. */
final class NativeCloudSync {
  static final String CONSENT_VERSION="2026-09-27-native-v1";
  private static final String KEY="AIzaSyAEuFJs3RD_TjNDEWJ70FwrTEDEEGOZIf4";
  private static final String DATABASE="projects/parkcaddy-ground-2026/databases/(default)/documents";
  private static final String API="https://firestore.googleapis.com/v1/";
  private static NativeCloudSync instance;
  static synchronized NativeCloudSync get(Context context) {
    if(instance==null)instance=new NativeCloudSync(context.getApplicationContext());
    return instance;
  }
  private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();
  private final AtomicBoolean offered=new AtomicBoolean();
  private final SharedPreferences credentials;
  private CloudRecordQueue queue;
  private JSONObject auth;
  private volatile boolean foreground, blocked, enabled;
  private volatile long consentGeneration;
  private volatile String status="자동 제공 꺼짐";
  private volatile long nextOffer;
  private NativeCloudSync(Context context) {
    credentials=context.getSharedPreferences("native-cloud-identity",Context.MODE_PRIVATE);
    try { queue=new CloudRecordQueue(new File(context.getFilesDir(),"cloud-record-handles.properties")); enabled=queue.consented();consentGeneration=queue.generation(); }
    catch(Exception error){blocked=true;status="데이터 보호 저장소를 확인할 수 없어 전송을 중지했습니다";}
    worker.scheduleWithFixedDelay(this::drainSafely,5,30,TimeUnit.SECONDS);
  }
  boolean decided(){return blocked||queue.decided();}
  boolean consented(){return !blocked&&enabled;}
  String status(){return !blocked&&queue.deletionComplete()?"이 기기에서 제공한 자료 삭제 완료":status;}
  void foreground(boolean value){foreground=value;if(value)worker.execute(this::drainSafely);}
  synchronized void setConsent(boolean value){
    if(blocked)return;
    if(!value)enabled=false;
    try{queue.consent(value);consentGeneration=queue.generation();enabled=value&&queue.consented();nextOffer=0;status=value?"동의됨 · 측정 자료 자동 제공":"자동 제공 꺼짐";worker.execute(this::drainSafely);}
    catch(IOException error){blocked=true;status="동의 저장에 실패해 전송을 중지했습니다";}
  }
  synchronized void deleteAll(){
    if(blocked)return;
    enabled=false;
    try{queue.deleteAll();consentGeneration=queue.generation();status="삭제 요청 저장됨 · 연결되면 처리합니다";worker.execute(this::drainSafely);}
    catch(IOException error){blocked=true;status="삭제 요청을 보관하지 못했습니다 · 다시 시도해 주세요";}
  }
  // Called from the AR thread; throttle and move disk/network work off that thread.
  void offer(String metadata){
    long now=android.os.SystemClock.elapsedRealtime();
    if(!foreground||!consented()||now<nextOffer||!offered.compareAndSet(false,true))return;
    nextOffer=now+30000;long generation=consentGeneration;
    worker.execute(()->{
      try{
        if(!consented()||generation!=queue.generation())return;
        JSONObject identity=identity();
        if(!consented()||generation!=queue.generation())return;
        java.text.SimpleDateFormat date=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);date.setTimeZone(TimeZone.getTimeZone("UTC"));
        JSONObject body=new JSONObject().put("schemaVersion",1).put("platform","android")
            .put("createdAt",date.format(new Date())).put("consentVersion",CONSENT_VERSION).put("metadata",new JSONObject(metadata));
        if(queue.reserve(identity.getString("uid"),body.toString(),generation)==null)status="자료 보관 한도 또는 동의 상태로 대기 중";
        drainSafely();
      }catch(Exception error){status="연결 대기 · 카메라 측정은 계속됩니다";}
      finally{offered.set(false);}
    });
  }
  private void drainSafely(){
    if(blocked||!foreground||queue==null)return;
    try{
      List<CloudRecordQueue.Record> records=queue.records();
      if(records.isEmpty()){if(!consented()&&status.startsWith("삭제"))status="이 기기에서 제공한 자료 삭제 완료";return;}
      if(records.stream().noneMatch(record->record.state.equals("deleting")||queue.canUpload(record)))return;
      JSONObject identity=identity();String uid=identity.getString("uid"),token=identity.getString("token");
      // Deletions go first and keep their durable handles until the server acknowledges.
      for(CloudRecordQueue.Record record:records){
        if(!foreground)return;
        if(!uid.equals(record.owner))throw new IOException("Owner identity mismatch");
        if(record.state.equals("deleting")){
          Response result=deleteWithMarker(uid,record.id,token);
          if(result.code==200)queue.deleted(record);else{if(result.code==401)expireIdentity();throw new IOException("Delete pending");}
        }
      }
      for(CloudRecordQueue.Record record:queue.records()){
        if(!foreground||!queue.canUpload(record))continue;
        if(!uid.equals(record.owner))throw new IOException("Owner identity mismatch");
        JSONObject document=new JSONObject().put("name",DATABASE+"/users/"+uid+"/measurements/"+record.id)
            .put("fields",fields(new JSONObject(record.body)));
        String body=new JSONObject().put("writes",new JSONArray().put(new JSONObject().put("update",document))).toString();
        Response result=request("POST",API+DATABASE+":commit",body,token,"application/json",record);
        if(result.code>=200&&result.code<300){queue.uploaded(record);status="동의됨 · 측정 자료 자동 제공";}
        else{if(result.code==401)expireIdentity();throw new IOException("Upload pending");}
        // If consent changed while the request was in flight, remove its possible server result.
        if(!queue.canUpload(record)&&!consented()&&queue.hasDeletion()){
          for(CloudRecordQueue.Record pending:queue.records())if(pending.id.equals(record.id)&&pending.state.equals("deleting")){
            Response deleted=deleteWithMarker(uid,pending.id,token);
            if(deleted.code==200)queue.deleted(pending);
          }
        }
      }
      if(!consented())status=queue.hasDeletion()?"삭제 요청 보관 중 · 연결되면 처리합니다":"자동 제공 꺼짐";
    }catch(Exception error){status=queue.hasDeletion()?"삭제 요청 보관 중 · 앱을 열어 연결해 주세요":"연결 대기 · 카메라 측정은 계속됩니다";}
  }
  // Atomically retain only a deletion marker and remove the measurement. Server rules
  // reject every later write to this ID, including requests delayed across a timeout.
  private Response deleteWithMarker(String uid,String id,String token) throws IOException,JSONException {
    String owner=DATABASE+"/users/"+uid;
    JSONObject marker=new JSONObject().put("name",owner+"/measurementDeletions/"+id)
        .put("fields",new JSONObject().put("deleted",new JSONObject().put("booleanValue",true)));
    JSONArray writes=new JSONArray().put(new JSONObject().put("update",marker))
        .put(new JSONObject().put("delete",owner+"/measurements/"+id));
    return request("POST",API+DATABASE+":commit",new JSONObject().put("writes",writes).toString(),token,"application/json",null);
  }
  private JSONObject identity() throws Exception {
    if(auth==null){String encrypted=credentials.getString("encrypted",null);if(encrypted!=null)auth=new JSONObject(decrypt(encrypted));}
    if(auth==null){
      // No account is created before an explicit opt-in.
      if(!consented())throw new IOException("Consent required");
      Response response=request("POST","https://identitytoolkit.googleapis.com/v1/accounts:signUp?key="+KEY,"{\"returnSecureToken\":true}",null,"application/json",null);
      if(response.code!=200)throw new IOException("Anonymous auth unavailable");
      JSONObject result=new JSONObject(response.body);
      auth=new JSONObject().put("uid",result.getString("localId")).put("refresh",result.getString("refreshToken"))
          .put("token",result.getString("idToken")).put("expires",System.currentTimeMillis()+result.getLong("expiresIn")*1000-60000);
      saveIdentity();
    }else if(auth.optLong("expires",0)<=System.currentTimeMillis()){
      Response response=request("POST","https://securetoken.googleapis.com/v1/token?key="+KEY,
          "grant_type=refresh_token&refresh_token="+URLEncoder.encode(auth.getString("refresh"),"UTF-8"),null,"application/x-www-form-urlencoded",null);
      if(response.code!=200)throw new IOException("Refresh unavailable");
      JSONObject result=new JSONObject(response.body);
      if(!auth.getString("uid").equals(result.getString("user_id")))throw new IOException("Identity changed");
      auth.put("refresh",result.getString("refresh_token")).put("token",result.getString("id_token"))
          .put("expires",System.currentTimeMillis()+result.getLong("expires_in")*1000-60000);
      saveIdentity();
    }
    if(!auth.getString("uid").matches("[A-Za-z0-9_-]{1,128}"))throw new IOException("Invalid owner");
    return auth;
  }
  private void expireIdentity(){try{if(auth!=null)auth.put("expires",0);}catch(JSONException ignored){}}
  private void saveIdentity() throws Exception {
    try{if(!credentials.edit().putString("encrypted",encrypt(auth.toString())).commit())throw new IOException("Identity persistence failed");}
    catch(Exception error){auth=null;blocked=true;throw error;}
  }
  private javax.crypto.SecretKey key() throws Exception {
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
    String alias="parkcaddy.native-cloud.auth.v1";
    if(!store.containsAlias(alias)){
      KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
      generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
      generator.generateKey();
    }
    return (javax.crypto.SecretKey)store.getKey(alias,null);
  }
  private String encrypt(String value) throws Exception {
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
    return Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
  }
  private String decrypt(String value) throws Exception {
    String[] parts=value.split(":",2);if(parts.length!=2)throw new IOException("Invalid credential envelope");
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
    return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
  }
  private static JSONObject fields(JSONObject source) throws JSONException {
    JSONObject result=new JSONObject();Iterator<String> keys=source.keys();
    while(keys.hasNext()){String key=keys.next();result.put(key,value(source.get(key)));}return result;
  }
  private static JSONObject value(Object item) throws JSONException {
    JSONObject result=new JSONObject();
    if(item==JSONObject.NULL)return result.put("nullValue",JSONObject.NULL);
    if(item instanceof Boolean)return result.put("booleanValue",item);
    if(item instanceof Number){double number=((Number)item).doubleValue();if(!Double.isFinite(number))return result.put("nullValue",JSONObject.NULL);return result.put(item instanceof Integer||item instanceof Long?"integerValue":"doubleValue",item instanceof Integer||item instanceof Long?item.toString():item);}
    if(item instanceof JSONObject)return result.put("mapValue",new JSONObject().put("fields",fields((JSONObject)item)));
    if(item instanceof JSONArray){JSONArray array=new JSONArray();for(int i=0;i<((JSONArray)item).length();i++)array.put(value(((JSONArray)item).get(i)));return result.put("arrayValue",new JSONObject().put("values",array));}
    return result.put("stringValue",item.toString());
  }
  private static final class Response {final int code;final String body;Response(int code,String body){this.code=code;this.body=body;}}
  private Response request(String method,String url,String body,String token,String contentType,CloudRecordQueue.Record upload) throws IOException {
    if(upload!=null&&(!consented()||!queue.canUpload(upload)))throw new IOException("Consent changed");
    HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();
    connection.setConnectTimeout(10000);connection.setReadTimeout(15000);connection.setRequestMethod(method);
    connection.setInstanceFollowRedirects(false);connection.setRequestProperty("Content-Type",contentType);
    if(token!=null)connection.setRequestProperty("Authorization","Bearer "+token);
    try{
      if(body!=null){connection.setDoOutput(true);byte[] bytes=body.getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(bytes.length);
        if(upload!=null&&(!consented()||!queue.canUpload(upload)))throw new IOException("Consent changed");
        try(OutputStream output=connection.getOutputStream()){output.write(bytes);}}
      int code=connection.getResponseCode();InputStream input=code>=400?connection.getErrorStream():connection.getInputStream();
      ByteArrayOutputStream buffer=new ByteArrayOutputStream();
      if(input!=null)try(InputStream stream=input){byte[] bytes=new byte[4096];int count;while((count=stream.read(bytes))!=-1){if(buffer.size()+count>1048576)throw new IOException("Response too large");buffer.write(bytes,0,count);}}
      return new Response(code,new String(buffer.toByteArray(),StandardCharsets.UTF_8));
    }finally{connection.disconnect();}
  }
}