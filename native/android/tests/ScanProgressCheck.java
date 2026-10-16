package app.playpark.parkcaddy;

public final class ScanProgressCheck {
  static void check(boolean value,String reason){if(!value)throw new AssertionError(reason);}
  public static void main(String[] args){
    ScanProgress scan=ScanProgress.reference(5,700);
    check(scan.stage==ScanProgress.Stage.REFERENCE&&scan.value==5&&scan.maximum==12,"reference progress counts actual observations");
    scan=ScanProgress.reference(12,1600);
    check(scan.maximum==0&&scan.indeterminate,"full reference count alone never implies accepted baseline");
    scan=ScanProgress.reference(5,12000);
    check(scan.stage==ScanProgress.Stage.HELP&&!scan.indeterminate&&scan.maximum==0,"stalled reference stops progress and offers action");
    scan=ScanProgress.waiting("추적 준비","밝은 지면을 비춰 주세요",12000);
    check(scan.stage==ScanProgress.Stage.HELP&&!scan.indeterminate,"tracking cannot spin forever");
    scan=ScanProgress.measuring(0,0,0,0,0,0,"",false,15000);
    check(scan.stage==ScanProgress.Stage.HELP&&!scan.indeterminate&&scan.maximum==0,"missing depth gives concrete help without invented completion");
    scan=ScanProgress.measuring(3,4,0,3,0,400,"insufficient_samples",true,5000);
    check(scan.stage==ScanProgress.Stage.REPEATING&&scan.value==3&&scan.maximum==7,"repeat progress is sample count not elapsed time");
    scan=ScanProgress.measuring(7,4,0,7,.04f,1200,"translation_required",true,12000);
    check(scan.stage==ScanProgress.Stage.MOVE&&scan.value==40&&scan.maximum==80,"motion progress requires actual baseline");
    scan=ScanProgress.measuring(8,4,0,8,.1f,1000,"insufficient_duration",true,1100);
    check(scan.stage==ScanProgress.Stage.STABILIZING&&scan.indeterminate,"time gate is independent from count and motion");
    scan=ScanProgress.measuring(9,4,0,9,.1f,1600,"unstable_height",true,2000);
    check(scan.stage==ScanProgress.Stage.HELP&&scan.maximum==0,"unstable observations never become a full progress bar");
    scan=ScanProgress.measuring(10,8,3,9,.1f,1600,"accepted",true,10000);
    check(scan.stage==ScanProgress.Stage.SHOWING&&scan.value==3&&scan.maximum==8,"first stable cells are shown without waiting for entire scan");
    scan=ScanProgress.measuring(10,3,3,9,.1f,1600,"accepted",true,10000);
    check(scan.stage==ScanProgress.Stage.SHOWING&&!scan.indeterminate&&scan.maximum==0,"accepted visible coverage removes spinner while scan continues");
    scan=ScanProgress.measuring(10,3,3,9,.1f,1600,"accepted",false,1000);
    check(scan.stage==ScanProgress.Stage.DEPTH,"stale depth cannot report showing even with old stable cells");
    check(ScanProgress.fresh(1000,4000)&&!ScanProgress.fresh(1000,4001)&&!ScanProgress.fresh(0,1)&&!ScanProgress.fresh(2000,1000),"freshness rejects old absent and future observations");
    ReferenceWindow reference=new ReferenceWindow();reference.add(0,1000);reference.add(0,1150);
    check(reference.observationCount(1200)==2&&reference.observationCount(2200)==0,"reference count expires rather than presenting old samples");
    StableHeight height=new StableHeight();height.observe(0,1000,0,1,0);height.observe(0,1200,.1f,1,0);
    check(height.observationDurationMs()==200,"window duration comes from actual sample timestamps");
    check(ScanProgress.blocked("깊이 지원 기기를 사용해 주세요").maximum==0,"unsupported hardware has no scan progress");
    System.out.println("PASS: automatic scan phases, measured ratios, immediate stable-cell display, motion/time gates, stale hiding and actionable timeout states");
  }
}