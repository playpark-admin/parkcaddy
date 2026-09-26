package app.playpark.parkcaddy;

import java.io.*;
import java.nio.file.*;
import java.util.concurrent.*;
import java.util.zip.*;

public final class RecordingConsentCheck {
  static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
  static byte[] export(MeasurementRecorder recorder) throws Exception {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    CountDownLatch done = new CountDownLatch(1); String[] error = {null};
    recorder.export(output, message -> { error[0] = message; done.countDown(); });
    check(done.await(10, TimeUnit.SECONDS) && error[0] == null, "export completes");
    return output.toByteArray();
  }
  static String readRuns(byte[] archive) throws Exception {
    StringBuilder text = new StringBuilder();
    try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
      ZipEntry entry; byte[] buffer = new byte[2048];
      while ((entry = zip.getNextEntry()) != null) {
        if (!entry.getName().endsWith(".jsonl")) continue;
        ByteArrayOutputStream output = new ByteArrayOutputStream(); int count;
        while ((count = zip.read(buffer)) != -1) output.write(buffer, 0, count);
        text.append(new String(output.toByteArray(), "UTF-8"));
      }
    }
    return text.toString();
  }
  public static void main(String[] args) throws Exception {
    File directory = Files.createTempDirectory("parkcaddy-consent-").toFile();
    MeasurementRecorder recorder = new MeasurementRecorder(directory, "{\"test_device\":true}", false);
    recorder.event("disabled_observation", 0, "{}");
    check(readRuns(export(recorder)).isEmpty(), "disabled recorder stores no device metadata or observations");
    recorder.enabled = true; recorder.event("opted_in", 0, "{}");
    String enabled = readRuns(export(recorder));
    check(enabled.contains("\"type\":\"metadata\"") && enabled.contains("opted_in"), "opt-in preserves schema metadata");
    recorder.enabled = false; recorder.event("disabled_again", 0, "{}");
    check(!readRuns(export(recorder)).contains("disabled_again"), "subsequent opt-out stops recording");
    recorder.close();
    System.out.println("PASS: default opt-out, metadata after consent and recording pause");
  }
}
