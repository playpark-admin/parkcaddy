import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** No GitHub account, Python, SDK installation or license auto-acceptance.
 * Run from the Android project root: java tools/PreviewBuild.java [--check|--preflight]
 * Default: verify wrapper, compile/run host tests, validate SDK, assemble + lint.
 * Host/syntax checks are NOT an Android build or measurement-accuracy validation.
 */
class PreviewBuild {
  static final String WRAPPER_SHA="cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8";
  static final String DIST_SHA="544c35d6bd849ae8a5ed0bcea39ba677dc40f49df7d1835561582da2009b961d";
  static final String[] PURE={"StableHeight","ReferenceWindow","ScanProgress","StickyLabels",
      "ScanGuide","ScanTrace","MeasurementRecorder","MeasurementPolicy","ResumePolicy"};
  static final String[] TESTS={"StabilityCheck","ScanProgressCheck","GuidedScanCheck","ContinuationCheck"};
  static Path root, runDir;
  static final Properties status=new Properties();
  static boolean win=System.getProperty("os.name").toLowerCase(Locale.ROOT).contains("win");
  static String javaTool(String name) {
    return Paths.get(System.getProperty("java.home"),"bin",name+(win?".exe":"")).toString();
  }
  static String sha(Path p) throws Exception {
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    try(InputStream in=Files.newInputStream(p)) { byte[] b=new byte[32768]; int n;
      while((n=in.read(b))!=-1) md.update(b,0,n); }
    StringBuilder out=new StringBuilder(); for(byte b:md.digest()) out.append(String.format("%02x",b&255));
    return out.toString();
  }
  static void verifyWrapper() throws Exception {
    Path jar=root.resolve("gradle/wrapper/gradle-wrapper.jar");
    if(!Files.isRegularFile(jar)||!WRAPPER_SHA.equals(sha(jar)))
      throw new IOException("Gradle wrapper is missing or differs from the official Gradle 8.7 checksum.");
    Properties p=new Properties();
    try(InputStream in=Files.newInputStream(root.resolve("gradle/wrapper/gradle-wrapper.properties"))) {p.load(in);}
    if(!"https://services.gradle.org/distributions/gradle-8.7-bin.zip".equals(p.getProperty("distributionUrl"))
       ||!DIST_SHA.equals(p.getProperty("distributionSha256Sum")))
      throw new IOException("Unexpected Gradle distribution URL or checksum; review before running.");
    status.setProperty("wrapperIntegrity","passed");
  }
  static void run(String label,List<String> cmd,Path sdk,long timeoutMinutes) throws Exception {
    System.out.println("\n["+label+"] Running. Log: "+runDir.resolve(label+".log"));
    ProcessBuilder pb=new ProcessBuilder(cmd).directory(root.toFile()).redirectErrorStream(true);
    if(sdk!=null) { pb.environment().put("ANDROID_HOME",sdk.toString());pb.environment().put("ANDROID_SDK_ROOT",sdk.toString()); }
    Process proc=pb.start();
    final IOException[] streamError=new IOException[1];
    Thread pump=new Thread(() -> {
      try(BufferedReader reader=new BufferedReader(new InputStreamReader(proc.getInputStream(),StandardCharsets.UTF_8));
          PrintWriter writer=new PrintWriter(Files.newBufferedWriter(runDir.resolve(label+".log"),StandardCharsets.UTF_8))) {
        String line;while((line=reader.readLine())!=null) {System.out.println(line);writer.println(line);writer.flush();}
      } catch(IOException e) {streamError[0]=e;}
    },"build-log");
    pump.setDaemon(true);pump.start();
    if(!proc.waitFor(timeoutMinutes,TimeUnit.MINUTES)) {proc.destroyForcibly();pump.join(3000);throw new IOException(label+" timed out.");}
    pump.join(5000);
    if(streamError[0]!=null) throw streamError[0];
    if(proc.exitValue()!=0) throw new IOException(label+" failed (exit "+proc.exitValue()+"). See its log; no APK was approved.");
  }
  static void hostChecks() throws Exception {
    Path src=root.resolve("app/src/main/java/app/playpark/parkcaddy");
    Path classes=runDir.resolve("host-classes");Files.createDirectories(classes);
    List<String> args=new ArrayList<>(Arrays.asList(javaTool("javac"),"--release","8","-encoding","UTF-8","-d",classes.toString()));
    for(String n:PURE) args.add(src.resolve(n+".java").toString());
    for(String n:TESTS) args.add(root.resolve("tests/"+n+".java").toString());
    run("host-compile",args,null,2);
    for(String n:TESTS) run(n,Arrays.asList(javaTool("java"),"-cp",classes.toString(),"app.playpark.parkcaddy."+n),null,2);
    status.setProperty("hostTests","passed");
    run("syntax-compiler",Arrays.asList(javaTool("javac"),"-encoding","UTF-8","-d",classes.toString(),root.resolve("tools/JavaSyntaxCheck.java").toString()),null,2);
    // The parser walks only app/src and tests; it never parses Gradle caches/build outputs.
    run("syntax-only",Arrays.asList(javaTool("java"),"-cp",classes.toString(),"JavaSyntaxCheck",root.toString()),null,2);
    status.setProperty("javaSyntaxOnly","passed");
  }
  static Path resolveSdk(String requested) throws Exception {
    List<Path> candidates=new ArrayList<>();
    if(requested!=null) candidates.add(Paths.get(requested));
    else {
      Path local=root.resolve("local.properties");
      if(Files.isRegularFile(local)) {Properties p=new Properties();try(InputStream in=Files.newInputStream(local)){p.load(in);}
        if(p.getProperty("sdk.dir")!=null)candidates.add(Paths.get(p.getProperty("sdk.dir")));}
      for(String key:new String[]{"ANDROID_HOME","ANDROID_SDK_ROOT"})
        if(System.getenv(key)!=null&&!System.getenv(key).trim().isEmpty()) candidates.add(Paths.get(System.getenv(key)));
      String home=System.getProperty("user.home");
      candidates.add(Paths.get(home,"AppData","Local","Android","Sdk"));
      candidates.add(Paths.get(home,"Library","Android","sdk"));candidates.add(Paths.get(home,"Android","Sdk"));
    }
    for(Path path:candidates) if(Files.isRegularFile(path.resolve("platforms/android-35/android.jar"))) {
      String aapt=win?"aapt2.exe":"aapt2";
      if(!Files.isRegularFile(path.resolve("build-tools/34.0.0/"+aapt)))
        throw new IOException("SDK found, but Build Tools 34.0.0 is missing. Install it with Android Studio SDK Manager: "+path);
      return path.toAbsolutePath().normalize();
    }
    throw new IOException("Android SDK Platform 35 not found. Install Platform 35 and Build Tools 34.0.0 in Android Studio.\nThen set ANDROID_HOME or run with --sdk /path/to/Android/Sdk. No SDK/license was installed automatically.");
  }
  static void sourceManifest() throws Exception {
    List<Path> files;
    try(Stream<Path> walk=Files.walk(root)) {
      files=walk.filter(Files::isRegularFile).filter(p -> {
        String rel=root.relativize(p).toString().replace('\\','/');
        return rel.startsWith("app/src/")||rel.startsWith("tests/")||rel.startsWith("tools/")
            ||rel.equals("build.gradle")||rel.equals("app/build.gradle")||rel.equals("settings.gradle")||rel.startsWith("gradle/wrapper/");
      }).sorted().collect(Collectors.toList());
    }
    StringBuilder text=new StringBuilder();for(Path p:files)text.append(sha(p)).append("  ").append(root.relativize(p).toString().replace('\\','/')).append('\n');
    Files.write(runDir.resolve("SOURCE-SHA256.txt"),text.toString().getBytes(StandardCharsets.UTF_8));
  }
  static void saveStatus() throws IOException {
    try(OutputStream out=Files.newOutputStream(runDir.resolve("STATUS.properties"))) {status.store(out,"A successful host check alone is not an APK build or accuracy validation");}
  }
  public static void main(String[] args) throws Exception {
    String mode="build",sdkArg=null;
    for(int i=0;i<args.length;i++) {
      if("--check".equals(args[i]))mode="check";
      else if("--preflight".equals(args[i]))mode="preflight";
      else if("--build".equals(args[i]))mode="build";
      else if("--sdk".equals(args[i])&&i+1<args.length)sdkArg=args[++i];
      else {System.err.println("Usage: java tools/PreviewBuild.java [--check|--preflight|--build] [--sdk PATH]");System.exit(2);}
    }
    root=Paths.get("").toAbsolutePath().normalize();
    if(!Files.isRegularFile(root.resolve("app/build.gradle"))) {System.err.println("Run from the Android project root (the folder containing app and gradlew).");System.exit(2);}
    String tag=LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"))+"-"+UUID.randomUUID().toString().substring(0,8);
    runDir=root.resolve("build-logs").resolve(tag);Files.createDirectories(runDir);
    status.setProperty("mode",mode);status.setProperty("hostTests","not_run");status.setProperty("javaSyntaxOnly","not_run");
    status.setProperty("apkBuild","not_run");status.setProperty("androidLint","not_run");status.setProperty("deviceTest","not_run");
    status.setProperty("fieldAccuracy","not_validated");status.setProperty("githubModified","false");
    int exit=0;
    try {
      int jdk=Integer.parseInt(System.getProperty("java.specification.version"));
      if(jdk<17||jdk>21)throw new IOException("Use JDK 17 (recommended) or 21 for this pinned Gradle 8.7 project.");
      if(!Files.isRegularFile(Paths.get(javaTool("javac"))))throw new IOException("A JDK including javac is required, not a JRE.");
      verifyWrapper();sourceManifest();
      if(!"preflight".equals(mode))hostChecks();
      if("check".equals(mode)) System.out.println("\nHOST CHECKS PASSED. APK not built. Android UI and field accuracy NOT tested.");
      else {
        Path sdk=resolveSdk(sdkArg);status.setProperty("sdkPreflight","passed");
        if("preflight".equals(mode)) System.out.println("SDK and wrapper found. Build and device tests NOT run.");
        else {
          status.setProperty("apkBuild","running");saveStatus();
          List<String> gradle=Arrays.asList(javaTool("java"),"-Dfile.encoding=UTF-8","-cp",root.resolve("gradle/wrapper/gradle-wrapper.jar").toString(),
              "org.gradle.wrapper.GradleWrapperMain","--no-daemon","--console=plain","--stacktrace",":app:assembleDebug",":app:lintDebug");
          run("android-build-and-lint",gradle,sdk,30);
          Path apk=root.resolve("app/build/outputs/apk/debug/app-debug.apk");
          if(!Files.isRegularFile(apk)||Files.size(apk)<10000)throw new IOException("Gradle returned successfully but the expected APK was not found.");
          Path copy=runDir.resolve("ParkCaddy-2.3.1-guided-preview-test.apk");Files.copy(apk,copy);
          Files.write(runDir.resolve("APK-SHA256.txt"),(sha(copy)+"  "+copy.getFileName()+"\n").getBytes(StandardCharsets.UTF_8));
          status.setProperty("apkBuild","passed");status.setProperty("androidLint","passed");status.setProperty("apk",copy.getFileName().toString());
          System.out.println("\nBUILD + LINT PASSED: "+copy+"\nSeparate debug app ID: app.playpark.parkcaddy.guidedpreview\nDevice operation and field accuracy are still NOT validated. No automatic installation or upload performed.");
        }
      }
    } catch(Exception e) {
      exit=1;status.setProperty("failure",e.toString());
      if("running".equals(status.getProperty("apkBuild")))status.setProperty("apkBuild","failed_or_lint_failed");
      else if(!"check".equals(mode))status.setProperty("apkBuild","blocked_before_android_build");
      System.err.println("\nSTOPPED: "+e.getMessage()+"\nLogs: "+runDir+"\nNo new APK has been approved by this run.");
    } finally {saveStatus();}
    if(exit!=0)System.exit(exit);
  }
}
