package app.playpark.parkcaddy;

import java.util.ArrayList;
import java.util.List;

/** JVM checks. No AR device, camera or measurement-accuracy claim. */
public final class GuidedScanCheck {
  private static int count;
  private static void test(String name, Runnable body) {
    body.run(); count++; System.out.println("PASS " + name);
  }
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
  private static long feed(StableHeight h, long step, float metersPerSecond, long end) {
    long first = -1;
    for (long t = 0; t <= end; t += step)
      if (h.observe(.12f, 1000+t, metersPerSecond*t/1000f, 1.3f, 0) && first < 0) first = t;
    return first;
  }
  private static ScanProgress measure(int stable, float baseline) {
    return ScanProgress.measuring(9, 8, stable, 9, baseline, 1600,
        stable > 0 ? "accepted" : "translation_required", true, 2000);
  }
  private static ScanGuide.State state(ScanGuide g, ScanProgress p, boolean cam,
      boolean anchor, boolean anchorTracking, float down, int forward, float baseline, long now) {
    return g.update(p, cam, anchor, anchorTracking, 6, down, forward, baseline, now);
  }
  public static void main(String[] args) {
    test("fast_100ms_history_no_time_starvation", () -> {
      long first = feed(new StableHeight(), 100, .1f, 10000);
      check(first == 1200, "expected first admission at 1200 ms, got " + first);
    });
    test("slow_translation_keeps_earlier_positions", () -> {
      long first = feed(new StableHeight(), 200, .02f, 10000);
      check(first >= 4000 && first <= 4200, "expected measured 8 cm within window, got " + first);
    });
    test("minimum_7_samples_unchanged", () -> {
      StableHeight h = new StableHeight();
      for(int i=0;i<6;i++) h.observe(0, 1000+i*300, i*.04f, 1, 0);
      check(!h.valid(), "six samples must fail");
    });
    test("minimum_1200ms_unchanged", () -> {
      StableHeight h = new StableHeight();
      for(int i=0;i<7;i++) h.observe(0, 1000+i*150, i*.04f, 1, 0);
      check(!h.valid() && "insufficient_duration".equals(h.decision), "short window must fail");
    });
    test("rotation_only_never_qualifies", () -> check(feed(new StableHeight(), 200, 0, 20000)<0, "no translation"));
    test("subthreshold_motion_never_qualifies", () -> {
      StableHeight h=new StableHeight();
      for(int i=0;i<20;i++) h.observe(0,1000+i*200,(i%2)*.079f,1,0);
      check(!h.valid(), "7.9 cm is less than 8 cm");
    });
    test("duplicate_and_backward_times_rejected", () -> {
      StableHeight h=new StableHeight();h.observe(0,1000,0,1,0);
      h.observe(0,1000,1,1,0);h.observe(0,999,1,1,0);
      check(h.observationCount()==1 && h.lastObservation==1000, "duplicates must not count");
    });
    test("nonfinite_input_rejected", () -> {
      StableHeight h=new StableHeight();
      h.observe(Float.NaN,1000,0,1,0);h.observe(0,1001,Float.POSITIVE_INFINITY,1,0);
      check(h.observationCount()==0, "invalid numbers");
    });
    test("old_movement_expires", () -> {
      StableHeight h=new StableHeight();h.observe(0,1000,0,1,0);h.observe(0,1100,.04f,1,0);
      for(int i=0;i<40;i++)h.observe(0,7000+i*200,.04f,1,0);
      check(!h.valid() && h.lastBaseline==0, "old movement cannot satisfy a new scan");
    });
    test("gap_requires_new_samples", () -> {
      StableHeight h=new StableHeight();feed(h,200,.1f,1600);
      h.observe(.12f,20000,0,1.3f,0);
      check(h.observationCount()==1 && !ScanProgress.fresh(h.seen,20000), "gap freshness");
    });
    test("single_outlier_does_not_refresh", () -> {
      StableHeight h=new StableHeight();feed(h,200,.1f,2000);
      long seen=h.seen;float y=h.y;h.observe(1f,3200,.3f,1.3f,0);
      check(h.seen==seen && h.y==y, "outlier cannot refresh accepted evidence");
    });
    test("recent_conflict_not_hidden_by_long_history", () -> {
      StableHeight h=new StableHeight();feed(h,100,.1f,3000);
      for(int i=0;i<12;i++)h.observe(.5f,4100+i*100,.31f+i*.01f,1.3f,0);
      check(h.uncertain && !h.valid() && h.y<.2f, "recent jump must not be averaged away");
    });
    test("noisy_height_rejected", () -> {
      StableHeight h=new StableHeight();
      for(int i=0;i<30;i++)h.observe((i%2)*.15f,1000+i*200,i*.02f,1,0);
      check(!h.valid(), "MAD/spread criteria still apply");
    });
    test("history_memory_and_time_bounded", () -> {
      StableHeight h=new StableHeight();feed(h,100,.1f,600000);
      check(h.observationCount()<=64 && h.observationDurationMs()<=5000, "bounded storage");
    });
    test("shared_bias_is_NOT_detected_as_accuracy", () -> {
      StableHeight h=new StableHeight();
      for(int i=0;i<12;i++)h.observe(.05f,1000+i*200,i*.02f,1,0);
      check(h.valid() && Math.abs(h.y-.05f)<.00001f, "repeatability preserves bias; no truth claim");
    });
    test("reference_thresholds_unchanged", () -> {
      ReferenceWindow r=new ReferenceWindow();boolean ok=false;
      for(int i=0;i<11;i++)ok=r.add(0,1000+i*150);
      check(!ok,"11 samples");check(r.add(0,2650),"12 stable observations");
    });
    test("initial_guide_only_front_of_feet_optional", () -> {
      ScanGuide.State s=state(new ScanGuide(),ScanProgress.reference(6,900),true,false,false,85,0,0,1000);
      check(s.showToes && !s.requiresToeDetection() && !s.showReadings,"optional toes only");
    });
    test("toes_disappear_after_reference_lock", () -> {
      ScanGuide g=new ScanGuide();
      state(g,ScanProgress.reference(6,900),true,false,false,85,0,0,1000);
      ScanGuide.State s=state(g,measure(0,0),true,true,true,85,0,0,2000);
      check(!s.showToes && s.action==ScanGuide.Action.TILT_UP && !s.requiresToeDetection(),"tilt phase");
    });
    test("already_looking_forward_no_fixed_delta_required", () -> {
      ScanGuide.State s=state(new ScanGuide(),measure(0,.02f),true,true,true,45,3,.02f,1000);
      check(s.phase==ScanGuide.Phase.FIELD_SCAN && s.action==ScanGuide.Action.TRANSLATE,"no forced 20-40 degree rotation");
    });
    test("looking_at_sky_requests_tilt_down", () -> {
      ScanGuide.State s=state(new ScanGuide(),measure(0,0),true,true,true,-5,0,0,1000);
      check(s.action==ScanGuide.Action.TILT_DOWN && !s.showReadings,"sky is not field");
    });
    test("elapsed_time_never_forces_scan_completion", () -> {
      ScanGuide g=new ScanGuide();
      ScanGuide.State s=state(g,ScanProgress.reference(12,200000),true,false,false,80,0,0,200000);
      check(s.phase==ScanGuide.Phase.BASELINE && !s.showReadings && s.progress<1,"no timer completion");
    });
    test("field_scan_valid_without_toes", () -> {
      ScanGuide.State s=state(new ScanGuide(),measure(3,.1f),true,true,true,45,3,.1f,1000);
      check(s.phase==ScanGuide.Phase.SHOWING && !s.showToes && s.showReadings,"toes absent is normal");
    });
    test("field_view_can_return_to_near_ground_without_new_toe_step", () -> {
      ScanGuide g=new ScanGuide();state(g,measure(3,.1f),true,true,true,45,3,.1f,1000);
      ScanGuide.State s=state(g,measure(3,.1f),true,true,true,85,3,.1f,2000);
      check(s.phase==ScanGuide.Phase.SHOWING && !s.showToes, "no forced initial pose after entering field");
    });
    test("stale_depth_cannot_mark_showing", () -> {
      ScanProgress p=ScanProgress.measuring(10,8,3,9,.1f,1600,"accepted",false,1000);
      ScanGuide.State s=state(new ScanGuide(),p,true,true,true,45,0,.1f,1000);
      check(s.phase!=ScanGuide.Phase.SHOWING && !s.showReadings,"stale depth");
    });
    test("tracking_loss_hides_readings_and_no_toe_requirement", () -> {
      ScanGuide g=new ScanGuide();state(g,measure(3,.1f),true,true,true,45,3,.1f,1000);
      ScanGuide.State s=state(g,ScanProgress.waiting("tracking","",0),false,true,false,Float.NaN,0,0,1100);
      check(s.phase==ScanGuide.Phase.RECOVERY && !s.showToes && !s.showReadings,"recovery");
    });
    test("invalid_pose_cannot_show_values", () -> {
      ScanGuide.State s=state(new ScanGuide(),measure(3,.1f),true,true,true,Float.NaN,3,.1f,1000);
      check(!s.showReadings && s.phase==ScanGuide.Phase.RECOVERY,"invalid pose");
    });
    test("reset_allows_new_reference_guide", () -> {
      ScanGuide g=new ScanGuide();state(g,measure(3,.1f),true,true,true,45,3,.1f,1000);g.reset();
      check(state(g,ScanProgress.reference(0,0),false,false,false,Float.NaN,0,0,2000).showToes,"explicit reset");
    });
    test("motion_progress_is_measured_not_timed", () -> {
      ScanGuide.State s=state(new ScanGuide(),measure(0,.04f),true,true,true,45,4,.04f,100000);
      check(Math.abs(s.progress-.5f)<.001f && !s.requiresToeDetection(),"actual 4/8 cm");
    });
    test("camera_forward_vector_pitch_sign", () -> {
      check(ScanGuide.downwardDegrees(0,-1,0)==90,"down");
      check(ScanGuide.downwardDegrees(0,0,-1)==0,"horizon");
      check(ScanGuide.downwardDegrees(0,1,0)==-90,"sky");
      check(Float.isNaN(ScanGuide.downwardDegrees(0,0,0)),"zero vector");
    });
    test("short_pause_keeps_anchor_only", () -> {
      check(ResumePolicy.mayKeepAnchor(3000,true,true,.1f,0,0),"short nearby");
      check(!ResumePolicy.mayShowStoredCellsAfterPause(),"never re-show old cells");
    });
    test("long_pause_movement_or_tracking_loss_reject_reuse", () -> {
      check(!ResumePolicy.mayKeepAnchor(10001,true,true,0,0,0),"long pause");
      check(!ResumePolicy.mayKeepAnchor(1000,true,true,.6f,0,0),"moved");
      check(!ResumePolicy.mayKeepAnchor(1000,false,true,0,0,0),"camera");
      check(!ResumePolicy.mayKeepAnchor(1000,true,false,0,0,0),"anchor");
      check(!ResumePolicy.mayKeepAnchor(-1,true,true,0,0,0),"clock");
      check(!ResumePolicy.mayKeepAnchor(1000,true,true,Float.NaN,0,0),"NaN");
    });
    test("trace_off_writes_nothing", () -> {
      List<String> rows=new ArrayList<>();ScanTrace t=new ScanTrace((kind,payload)->rows.add(kind+payload));
      t.update("BASELINE","search",false,1000,false);t.finish("paused",9000,false);
      check(rows.isEmpty(),"no diagnostics without local opt-in");
    });
    test("trace_captures_failure_without_stable_cells", () -> {
      List<String> rows=new ArrayList<>();ScanTrace t=new ScanTrace((kind,payload)->rows.add(kind+payload));
      t.update("BLOCKED","unsupported",false,1000,true);
      t.update("BLOCKED","unsupported",false,5000,true);t.finish("paused",6000,true);
      check(rows.size()==3 && rows.get(1).startsWith("guide_wait") && rows.get(2).contains("\"first_observed_cells_ms\":null"),"failed attempt recorded");
    });
    test("trace_first_showing_and_pause_summary", () -> {
      List<String> rows=new ArrayList<>();ScanTrace t=new ScanTrace((kind,payload)->rows.add(kind+payload));
      t.update("BASELINE","reference",false,1000,true);
      t.update("SHOWING","showing",true,4200,true);t.finish("paused",5000,true);
      check(rows.stream().anyMatch(x->x.contains("\"time_to_first_cells_ms\":3200")),"elapsed first observation");
      int before=rows.size();t.finish("destroyed",5100,true);check(before==rows.size(),"no duplicate end");
    });
    test("trace_revocation_resets_no_hidden_history", () -> {
      List<String> rows=new ArrayList<>();ScanTrace t=new ScanTrace((kind,payload)->rows.add(kind+payload));
      t.update("BASELINE","reference",false,1000,true);
      t.update("BASELINE","reference",false,2000,false);
      t.update("SHOWING","showing",true,7000,true);
      check(rows.stream().anyMatch(x->x.contains("\"time_to_first_cells_ms\":0")),"new local consent interval");
    });
    test("base_and_strict_depth_gates_unchanged", () -> {
      MeasurementPolicy normal=new MeasurementPolicy(false), strict=new MeasurementPolicy(true);
      check(!normal.acceptsDepth(1,179)&&normal.acceptsDepth(1,180),"normal confidence");
      check(!strict.acceptsDepth(1,209)&&strict.acceptsDepth(1,210),"strict confidence");
      check(!normal.acceptsDepth(.29f,255)&&!normal.acceptsDepth(6.1f,255),"depth range");
      check(!normal.acceptsFrame(1,0,0)&&!normal.acceptsFrame(2,0,.121f),"frame policy");
    });
    System.out.println("TOTAL " + count + " focused JVM scenarios passed");
  }
}
