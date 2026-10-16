package app.playpark.parkcaddy;

/** Honest scan feedback. Ratios count observations/conditions, never terrain accuracy. */
final class ScanProgress {
  enum Stage { WAITING, REFERENCE, DEPTH, REPEATING, MOVE, STABILIZING, SHOWING, HELP, BLOCKED }
  final Stage stage;
  final String title, detail;
  final boolean indeterminate;
  final int value, maximum;
  private ScanProgress(Stage stage,String title,String detail,boolean indeterminate,int value,int maximum){
    this.stage=stage;this.title=title;this.detail=detail;this.indeterminate=indeterminate;
    this.maximum=Math.max(0,maximum);this.value=Math.max(0,Math.min(value,this.maximum));
  }
  static ScanProgress waiting(String title,String detail,long waitingMs){
    return new ScanProgress(waitingMs>=12000?Stage.HELP:Stage.WAITING,title,detail,waitingMs<12000,0,0);
  }
  static ScanProgress blocked(String detail){return new ScanProgress(Stage.BLOCKED,"자동 측정을 시작할 수 없어요",detail,false,0,0);}
  static ScanProgress reference(int observations,long waitingMs){
    int count=Math.max(0,Math.min(12,observations));
    if(waitingMs>=12000)return new ScanProgress(Stage.HELP,"기준 지면이 안정되지 않아요","밝은 지면의 무늬를 포함해 비춰 주세요 · 안정되면 자동으로 이어집니다",false,0,0);
    if(count==0)return waiting("지면을 자동으로 찾는 중", "밝은 지면의 무늬를 비추며 폰을 천천히 움직이세요",waitingMs);
    if(count>=12)return new ScanProgress(waitingMs>=12000?Stage.HELP:Stage.REFERENCE,"기준 높이 확인 중 · 12회 관측", "같은 지면을 잠시 비춰 주세요 · 흔들림을 확인합니다",waitingMs<12000,0,0);
    return new ScanProgress(Stage.REFERENCE,"기준 지면 확인 · "+count+"/12회", "같은 지면을 잠시 비춰 주세요",false,count,12);
  }
  static boolean fresh(long acceptedAt,long now){return acceptedAt>0&&now>=acceptedAt&&now-acceptedAt<=3000;}
  static ScanProgress measuring(int validDepthFrames,int candidates,int stable,int observations,float baselineMeters,long durationMs,String decision,boolean freshDepth,long waitingMs){
    if(!freshDepth||candidates==0){
      String detail=validDepthFrames==0?"가까운 지면의 무늬를 비추며 좌우로 천천히 움직이세요":"새 깊이를 확인 중 · 같은 지면을 다시 비춰 주세요";
      return new ScanProgress(waitingMs>=12000?Stage.HELP:Stage.DEPTH,
          waitingMs>=12000?"깊이 정보를 충분히 얻지 못했어요":"깊이 자동 스캔 · 유효 "+validDepthFrames+"회",detail,waitingMs<12000,0,0);
    }
    if(stable>0){
      int visible=Math.min(stable,candidates);
      return new ScanProgress(Stage.SHOWING,"높이·거리 자동 표시 · "+visible+"곳",
          visible<candidates?"관측 격자 "+visible+"/"+candidates+" 안정 · 나머지 보정 중":"현재 관측 격자 안정 · 다른 지면도 천천히 비춰 주세요",
          false,visible<candidates?visible:0,visible<candidates?candidates:0);
    }
    if("unstable_height".equals(decision)||"disagreement".equals(decision))
      return new ScanProgress(Stage.HELP,"관측 높이의 차이가 커요","폰과 같은 지면을 천천히 비춰 주세요 · 바람에 흔들리는 잔디는 피하세요",false,0,0);
    if(observations<7)return new ScanProgress(Stage.REPEATING,"관측 보정 중 · "+Math.max(0,observations)+"/7회", "같은 지면을 비춰 주세요 · 유효 깊이 "+validDepthFrames+"회",false,observations,7);
    if(baselineMeters<.08f)return new ScanProgress(Stage.MOVE,"관측 보정 중 · 옆으로 조금 이동", "같은 지면을 보며 폰을 좌우 10–20 cm 움직이세요",false,Math.round(Math.max(0,baselineMeters)*1000),80);
    if(durationMs<1200)return new ScanProgress(Stage.STABILIZING,"관측 보정 중 · 이동 조건 충족", "반복 관측을 확인하고 있어요",true,0,0);
    return new ScanProgress(waitingMs>=12000?Stage.HELP:Stage.STABILIZING,"관측 보정 중 · "+validDepthFrames+"회 깊이 수신",
        waitingMs>=12000?"지면 무늬를 포함해 천천히 비춰 주세요 · 조건이 맞으면 자동 표시됩니다":"높이 분산과 기준점을 확인하고 있어요",waitingMs<12000,0,0);
  }
}