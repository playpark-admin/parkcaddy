package app.playpark.parkcaddy;

/** Additional fail-closed tests. Synthetic inputs, not field accuracy tests. */
public final class ContinuationCheck {
  private static int tests;
  private static void check(String name, boolean ok) {
    if (!ok) throw new AssertionError(name);
    tests++; System.out.println("PASS " + name);
  }
  public static void main(String[] args) {
    StableHeight h = new StableHeight();
    for (int i = 0; i < 12; i++) h.observe(.1f, 1000 + 200*i, .02f*i, 1.3f, 0);
    check("admitted_before_gap", h.valid());
    long publishedAt = h.seen;
    h.observe(.1f, 20000, 0, 1.3f, 0);
    check("expired_evidence_not_valid_even_without_ui_freshness", !h.valid());
    check("expired_publication_not_refreshed", h.seen == publishedAt);
    check("one_new_observation_only", h.observationCount() == 1);
    for (int i = 1; i < 6; i++) h.observe(.1f, 20000 + 200*i, .02f*i, 1.3f, 0);
    check("six_new_samples_still_insufficient", !h.valid());
    h.observe(.1f, 21200, .12f, 1.3f, 0);
    check("new_evidence_requalifies_original_gates", h.valid());
    StableHeight moved = new StableHeight();
    for (int i=0;i<12;i++) moved.observe(0,1000+200*i,.02f*i,1.3f,0);
    moved.observe(.3f,20000,0,1.3f,0);
    for (int i=1;i<10;i++) moved.observe(.3f,20000+200*i,.02f*i,1.3f,0);
    check("expired_height_still_protects_against_conflict", !moved.valid() && moved.uncertain && Math.abs(moved.y)<1e-6);
    ReferenceWindow ref=new ReferenceWindow();
    ref.add(0,1000);ref.add(0,1050);
    check("reference_repeated_fast_frames_not_counted", ref.observationCount(1050)==1);
    ref.add(0,2500);
    check("reference_gap_restarts_evidence", ref.observationCount(2500)==1);
    ref.add(.2f,2650);
    check("reference_large_jump_restarts_evidence", ref.observationCount(2650)==1);
    ScanGuide guide=new ScanGuide();
    ScanProgress status=ScanProgress.measuring(9,9,4,9,.12f,1600,"accepted",true,2000);
    ScanGuide.State first=guide.update(status,true,true,true,12,45,3,.12f,1000);
    ScanGuide.State lost=guide.update(status,false,true,false,0,Float.NaN,0,0,1100);
    ScanGuide.State back=guide.update(status,true,true,true,12,45,3,.12f,1200);
    check("field_state_after_lock_has_no_toes", !first.showToes && first.showReadings);
    check("lost_tracking_never_shows_readings", !lost.showReadings);
    check("recovery_never_requires_toe_detector", !lost.requiresToeDetection() && !back.showToes);
    System.out.println("TOTAL " + tests + " continuation checks passed");
  }
}
