package app.playpark.parkcaddy;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.*;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.google.ar.core.*;

/** Camera-first ground tool, intended to be opened and closed from a scorecard. */
public final class MainActivity extends AppCompatActivity {
  private GLSurfaceView surface;
  private TerrainHudView hud;
  private TextView status, recordInfo, debugInfo, referenceInfo, cloudInfo;
  private NativeCloudSync cloud;
  private boolean consentDialogVisible;
  private MeasurementRecorder recorder;
  private ArCameraRenderer renderer;
  private Session session;
  private SharedPreferences preferences;
  private MeasurementPolicy policy;
  private boolean active, askedInstall = true, permissionPending, exporting;
  private Button download;
  private ProgressBar scanBar;
  private long availabilityStarted;
  private long lastUi;
  private String fullGuidance = "발 앞 지면을 약 2초 비춘 뒤, 같은 지면을 보며 폰을 천천히 좌우로 움직이세요.";

  private final ActivityResultLauncher<String> permission = registerForActivityResult(
      new ActivityResultContracts.RequestPermission(), granted -> {
        permissionPending = false;
        if (granted) start();
        else showScan(ScanProgress.blocked("설정 → 사용자 보정 → 카메라 권한에서 허용해 주세요"));
      });
  private final ActivityResultLauncher<String> saveData = registerForActivityResult(
      new ActivityResultContracts.CreateDocument("application/zip"), uri -> {
        if (uri == null) { finishExport(null, false); return; }
        new Thread(() -> {
          try {
            java.io.OutputStream output = getContentResolver().openOutputStream(uri, "w");
            if (output == null) throw new java.io.IOException("No output stream");
            recorder.export(output, error -> finishExport(error, true));
          } catch (Exception e) { finishExport("저장 위치를 확인하고 다시 시도하세요.", true); }
        }, "ParkCaddy-export").start();
      });

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    preferences = getSharedPreferences("ground-v2", MODE_PRIVATE);
    policy = new MeasurementPolicy(preferences.getBoolean("strict", false));
    cloud = NativeCloudSync.get(this);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    // Only controls consume safe-area insets: camera and ground overlay fill the window.
    androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
    getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(android.graphics.Color.BLACK);
    setContentView(root);
    androidx.core.view.WindowInsetsControllerCompat bars = androidx.core.view.WindowCompat.getInsetsController(getWindow(), root);
    bars.setAppearanceLightStatusBars(false);
    bars.setAppearanceLightNavigationBars(false);
    String version = "unknown";
    try { version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
    catch (PackageManager.NameNotFoundException ignored) { }
    recorder = new MeasurementRecorder(new java.io.File(getFilesDir(), "measurement-recordings"),
        MeasurementRecorder.json("app_version", version, "device_model", android.os.Build.MODEL,
            "android_sdk", android.os.Build.VERSION.SDK_INT, "arcore_sdk", "1.48.0",
            "policy", new MeasurementRecorder.Raw(policy.metadata())), preferences.getBoolean("recording", false));
    surface = new GLSurfaceView(this);
    surface.setEGLContextClientVersion(2);
    hud = new TerrainHudView(this);
    hud.grid = preferences.getBoolean("grid", true);
    hud.heat = preferences.getBoolean("heat", true);
    hud.reference = preferences.getBoolean("reference", false);
    hud.largeLabels = preferences.getBoolean("large_labels", true);
    status = overlayLabel("발 앞 지면을 비춰 주세요", 18);
    status.setMaxLines(3);
    status.setGravity(Gravity.CENTER_VERTICAL);
    status.setEllipsize(android.text.TextUtils.TruncateAt.END);
    renderer = new ArCameraRenderer((scene, message, progress) -> {
      long now = android.os.SystemClock.elapsedRealtime();
      if (now - lastUi < 150) return;
      lastUi = now;
      runOnUiThread(() -> {
        if (isDestroyed() || !active) return;
        hud.setScene(scene);
        fullGuidance=message;
        showScan(progress);
        if (recordInfo != null && !exporting) recordInfo.setText(recorder.status());
        if (debugInfo != null) debugInfo.setText(renderer.debugInfo);
        if (referenceInfo != null) referenceInfo.setText(renderer.referenceInfo);
        if (cloudInfo != null) cloudInfo.setText(cloud.status());
      });
    });
    renderer.recorder = recorder;
    renderer.cloud = cloud;
    renderer.setPolicy(policy);
    renderer.rangeMeters = preferences.getInt("range_m", 6) == 3 ? 3 : 6;
    surface.setRenderer(renderer);
    surface.onPause();
    root.addView(surface, new FrameLayout.LayoutParams(-1, -1));
    root.addView(hud, new FrameLayout.LayoutParams(-1, -1));

    FrameLayout controls = new FrameLayout(this);
    root.addView(controls, new FrameLayout.LayoutParams(-1, -1));
    LinearLayout top = new LinearLayout(this);
    top.setGravity(Gravity.CENTER_VERTICAL);
    Button close = overlayButton("닫기"), settings = overlayButton("설정");
    close.setContentDescription("지면 확인 닫기");
    close.setOnClickListener(view -> finish());
    settings.setContentDescription("지면 확인 설정 및 실데이터 분석");
    settings.setOnClickListener(view -> showSettings());
    top.addView(close, new LinearLayout.LayoutParams(-2, -2));
    TextView title = overlayLabel("지면 확인", 18);
    title.setGravity(Gravity.CENTER);
    top.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
    top.addView(settings, new LinearLayout.LayoutParams(-2, -2));
    FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(-1, -2, Gravity.TOP);
    topParams.setMargins(dp(12), dp(8), dp(12), 0);
    controls.addView(top, topParams);

    LinearLayout bottom = new LinearLayout(this);
    bottom.setOrientation(LinearLayout.VERTICAL);
    bottom.setPadding(dp(14), dp(7), dp(14), dp(9));
    bottom.setBackground(round(0xDC162A2D, 16));
    bottom.addView(status, new LinearLayout.LayoutParams(-1, -2));
    scanBar=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
    scanBar.setProgressTintList(android.content.res.ColorStateList.valueOf(0xFFB4DDD0));
    scanBar.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(0xFFB4DDD0));
    bottom.addView(scanBar,new LinearLayout.LayoutParams(-1,dp(5)));
    showScan(ScanProgress.waiting("지면 자동 스캔 준비", "발 앞 지면을 비추면 자동으로 시작합니다",0));
    FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
    bottomParams.setMargins(dp(12), 0, dp(12), dp(8));
    controls.addView(bottom, bottomParams);
    bottom.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob) -> {
      hud.bottomInset = bottom.getHeight() + controls.getPaddingBottom() + dp(20);
      hud.invalidate();
    });
    androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(controls, (view, insets) -> {
      androidx.core.graphics.Insets safe = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() | androidx.core.view.WindowInsetsCompat.Type.displayCutout());
      view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
      hud.topInset = safe.top + dp(64);
      hud.bottomInset = bottom.getHeight() + safe.bottom + dp(20);
      hud.invalidate();
      return insets;
    });
    androidx.core.view.ViewCompat.requestApplyInsets(controls);
  }

  private void setGuidance(String message) {
    fullGuidance=message;
    showScan(ScanProgress.waiting("지면 자동 스캔",message,0));
  }
  private void showScan(ScanProgress progress) {
    String text=progress.title+"\n"+progress.detail;
    fullGuidance=text;
    if(!android.text.TextUtils.equals(status.getText(),text))status.setText(text);
    status.setContentDescription(text);
    if(scanBar==null)return;
    scanBar.setVisibility(progress.indeterminate||progress.maximum>0?android.view.View.VISIBLE:android.view.View.GONE);
    scanBar.setIndeterminate(progress.indeterminate);
    if(!progress.indeterminate&&progress.maximum>0){scanBar.setMax(progress.maximum);scanBar.setProgress(progress.value);}
    scanBar.setContentDescription(progress.title+" · "+progress.detail);
  }
  private void showSettings() {
    LinearLayout content = column();
    content.addView(label("지면 측정을 위한 보조 도구입니다. 향후 스코어카드에 연결할 수 있습니다.", 17));
    Button calibration = section(content, "사용자 보정", "기준 높이 · 관찰 범위 · 관측 필터");
    Button display = section(content, "화면과 안내", "격자 · 높낮이 색 · 큰 숫자 · 사용 방법");
    Button recording = section(content, "데이터 기록", "자동 제공 동의 · 제공 자료 삭제 · 기기 진단");
    Button analysis = section(content, "실데이터 분석", "실시간 관측값 · 계산식 · 오차와 반복성");
    AlertDialog dialog = panel("지면 확인 설정", content, false);
    calibration.setOnClickListener(view -> { dialog.dismiss(); showCalibration(); });
    display.setOnClickListener(view -> { dialog.dismiss(); showDisplay(); });
    recording.setOnClickListener(view -> { dialog.dismiss(); showRecording(); });
    analysis.setOnClickListener(view -> { dialog.dismiss(); showDebug(); });
  }

  private void showCalibration() {
    LinearLayout content = column();
    if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){
      Button cameraPermission=button("카메라 권한 설정");content.addView(cameraPermission,spaced());
      cameraPermission.setOnClickListener(view->startActivity(new android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getPackageName()))));
    }
    heading(content, "기준 높이");
    content.addView(label("처음 안정적으로 확인한 지면을 0 cm로 사용합니다. 카메라를 드는 높이와 움직임은 AR 센서가 추정하므로 키나 기본 높이를 입력할 필요가 없습니다.", 18));
    referenceInfo = label(renderer.referenceInfo, 18);
    content.addView(referenceInfo, spaced());
    content.addView(label("카메라 아래 0.4~2.3 m의 수평 평면을 지면 후보로 검사합니다. 책상·벤치처럼 넓고 평평한 물체도 통과할 수 있으므로 발 앞 잔디를 비추세요. 기준을 잘못 잡았거나 장소를 옮겼다면 다시 설정하세요. 사용자 입력으로 깊이 배율을 바꾸지 않습니다.", 17));
    Button reference = button("현재 지면으로 기준 다시 설정");
    content.addView(reference, spaced());
    heading(content, "관찰 범위");
    content.addView(label("가까운 지면 위주로 보려면 3 m를 선택하세요. 선택 범위가 센서의 정확도 보장 거리는 아닙니다.", 17));
    RadioGroup ranges = new RadioGroup(this);
    RadioButton near = radio("3 m 이내", 3), normal = radio("6 m 이내", 6);
    ranges.addView(near); ranges.addView(normal);
    ranges.check(renderer.rangeMeters);
    content.addView(ranges);
    ranges.setOnCheckedChangeListener((group, id) -> {
      int range = id == 3 ? 3 : 6;
      preferences.edit().putInt("range_m", range).apply();
      renderer.rangeMeters = range;
      resetMeasurement();
    });
    heading(content, "관측 필터");
    addToggle(content, "엄격한 관측 필터", "strict", policy.strict, on -> {
      policy = new MeasurementPolicy(on);
      renderer.setPolicy(policy);
      resetMeasurement();
    });
    content.addView(label("센서 신뢰도와 한 프레임의 높이 분포 조건을 강화합니다. 변경하면 기준점부터 다시 측정합니다. 반복성 확인용이며 실제 오차 상한을 보장하지 않습니다.", 17));
    AlertDialog dialog = panel("사용자 보정", content, true);
    reference.setOnClickListener(view -> { resetMeasurement(); dialog.dismiss(); });
    dialog.setOnDismissListener(view -> referenceInfo = null);
  }

  private void showDisplay() {
    LinearLayout content = column();
    heading(content, "화면 표시");
    addToggle(content, "격자 선 표시", "grid", hud.grid, on -> { hud.grid = on; hud.invalidate(); });
    addToggle(content, "높낮이 색 표시", "heat", hud.heat, on -> { hud.heat = on; hud.invalidate(); });
    addToggle(content, "측정 숫자 크게 보기", "large_labels", hud.largeLabels, on -> { hud.largeLabels = on; hud.resetLabels(); hud.invalidate(); });
    addToggle(content, "참고 평면 표시", "reference", hud.reference, on -> { hud.reference = on; hud.resetLabels(); hud.invalidate(); });
    content.addView(label("점선 참고 평면은 높이를 측정한 결과가 아닙니다. 빈 곳은 미측정 위치입니다. 3초 이상 갱신되지 않은 높이나 추적을 잃은 상태의 측정값은 숨깁니다.", 17));
    heading(content, "사용 방법");
    content.addView(label("① 멈춰 서서 발 앞 지면을 비추면 자동으로 스캔합니다.\n② 같은 지면을 보며 폰을 좌우 10–20 cm 천천히 움직이면 관측을 보정하고 안정된 격자부터 높이·거리를 자동 표시합니다. 회전만 하지 않습니다.\n③ 지면을 살펴본 뒤 닫기를 누릅니다. 현재 배포판에서는 지면 확인 화면을 종료합니다.", 18));
    heading(content, "현재 안내");
    content.addView(label(fullGuidance, 18));
    panel("화면과 안내", content, true);
  }

  private void showRecording() {
    LinearLayout content = column();
    heading(content, "관리자 분석용 자동 제공");
    CheckBox sharing = new CheckBox(this);
    sharing.setText("측정 수치 자동 제공에 동의"); sharing.setTextSize(19); sharing.setTextColor(0xFF172D30);
    sharing.setMinHeight(dp(56)); sharing.setChecked(cloud.consented());
    sharing.setButtonTintList(android.content.res.ColorStateList.valueOf(0xFF28685F));
    content.addView(sharing);
    sharing.setOnClickListener(view -> {
      if(sharing.isChecked()){sharing.setChecked(false);requestCloudConsent(() -> sharing.setChecked(cloud.consented()));}
      else cloud.setConsent(false);
      if(cloudInfo!=null)cloudInfo.setText(cloud.status());
    });
    content.addView(label("동의하면 실제 깊이·상대 높이·거리·반복성의 수치 요약을 자동 제공합니다. 사진·음성·GPS는 보내지 않습니다. 자료는 관리자만 분석하며 일반 사용자에게 전송 목록을 표시하지 않습니다. 동의를 꺼도 지면 확인은 계속 사용할 수 있습니다.",18));
    cloudInfo=label(cloud.status(),17); content.addView(cloudInfo);
    Button delete=button("제공한 자료 삭제 및 자동 제공 끄기"); content.addView(delete,spaced());
    delete.setOnClickListener(view -> {
      cloud.deleteAll(); sharing.setChecked(false); cloudInfo.setText(cloud.status());
    });
    content.addView(label("동의를 끄면 새 전송을 중지하고 전송 대기 자료를 취소합니다. 삭제 요청은 이 기기에서 제공한 자료 전체에 적용하며 연결될 때 재시도합니다. 삭제 완료를 확인하기 전 앱을 삭제하거나 앱 데이터를 지우면 삭제에 필요한 권한을 잃을 수 있습니다.",17));
    heading(content, "기기 내 진단 저장 · 별도 선택");
    addToggle(content, "진단 기록 저장", "recording", recorder.enabled, on -> {
      if (!on) recorder.event("recording_paused", -1, "{}");
      recorder.enabled = on;
      if (on) recorder.event("recording_resumed", -1, policy.metadata());
      if (recordInfo != null) recordInfo.setText(recorder.status());
    });
    content.addView(label("깊이 관측값, 카메라 자세, 필터 판정과 기기 모델을 이 폰에만 저장합니다. 이 로컬 진단 파일에는 사진·음성·GPS를 포함하지 않습니다. 위 자동 제공 동의와 별도로 동작합니다. 최대 100 MiB이며 진단 프레임은 초당 최대 1회 저장합니다.", 18));
    recordInfo = label(recorder.status(), 18);
    content.addView(recordInfo, spaced());
    download = button("진단 기록 내보내기 · ZIP");
    download.setEnabled(!exporting);
    content.addView(download, spaced());
    content.addView(label("기록을 끄거나 다시 측정해도 이전 파일은 유지됩니다. 앱을 삭제하기 전에 내보내세요.", 17));
    download.setOnClickListener(view -> {
      if (exporting) return;
      exporting = true;
      download.setEnabled(false);
      saveData.launch("ParkCaddy-measurements-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.ROOT).format(new java.util.Date()) + ".zip");
    });
    AlertDialog dialog = panel("데이터 기록", content, true);
    dialog.setOnDismissListener(view -> { recordInfo = null; download = null; cloudInfo = null; });
  }

  private void showDebug() {
    LinearLayout content = column();
    heading(content, "실시간 관측 · 약 0.5초마다 갱신");
    debugInfo = label(renderer.debugInfo, 17);
    debugInfo.setTypeface(android.graphics.Typeface.MONOSPACE);
    debugInfo.setTextIsSelectable(true);
    content.addView(debugInfo);
    heading(content, "좌표와 계산 모델");
    content.addView(label("ARCore Raw Depth d(mm)를 m로 바꾸고 카메라 내부 파라미터로 역투영합니다.\n\nx = (u − cx) × d / fx\ny = −(v − cy) × d / fy\nz = −d\np기준 = T기준⁻¹ × T카메라 × p카메라\n수평거리 = √(x기준² + z기준²)\n상대 높이 = y기준 (기준 지면 0 cm)\n\nu·v·cx·cy·fx·fy는 픽셀 단위입니다. 깊이는 광학축 방향 거리이며 사선 거리가 아닙니다. GPS 고도나 사용자 키로 거리를 환산하지 않습니다.", 18));
    heading(content, "반복 관측과 채택 조건");
    content.addView(label("새 Raw Depth 시점만 집계하며 약 180 ms 이상 간격으로 처리합니다. 같은 격자의 최근 최대 9개 관측에서 7회 이상·1.2초 이상·카메라 이동폭 8 cm 이상을 요구합니다. 중앙절대편차(MAD) ≤ 2.5 cm, 양 끝 관측을 제외한 높이 범위 ≤ 8 cm인 경우 값을 채택합니다.\n\n실시간 MAD는 안정 격자의 반복성 통계입니다. 0~255 신뢰도는 센서 입력값이며 정확도 확률이나 95% 신뢰구간이 아닙니다. ‘최대 이동폭’도 지면 측량 오차가 아닙니다.", 18));
    heading(content, "불확실성과 물리적 한계");
    content.addView(label("반복 촬영은 일부 흔들림과 이상값을 줄입니다. 시간적으로 인접한 프레임의 오차는 상관될 수 있으므로 촬영 횟수만으로 1/√N 개선을 주장할 수 없습니다. 센서 깊이 편향·기준 평면 오류·카메라 자세 드리프트·잔디 윗면 편향은 따로 남습니다.\n\n작은 각도에서 자세 기울기 오차 δθ(rad)가 높이에 미치는 크기는 대략 r × δθ(m)입니다. 이 식에는 실제 각도 오차를 대입해야 하며, 현재 앱은 그 오차를 측정하지 않으므로 정확도 상한을 계산하지 않습니다.\n\n0.25 m 격자 반올림으로 수평 위치는 최대 약 17.7 cm 이동할 수 있습니다. cm 표시는 cm 정확도 보증이 아닙니다. 알려진 거리·높이와 비교하여 편향, MAE, RMSE, 95백분위 오차와 결측률을 평가해야 합니다.", 18));
    heading(content, "다중 사용자 데이터");
    content.addView(label("GPS는 같은 장소의 기록을 찾는 데 쓰일 수 있지만 서로 다른 AR 좌표의 직접 평균에는 적합하지 않습니다. 공통 시각 특징이나 기준점으로 정합하고 세션별 편향을 평가한 뒤 통합해야 합니다. 자동 제공에 동의하면 최대 24개 격자의 최근 수치와 품질 요약을 30초 이상 간격으로 관리자 분석용 저장소에 전송합니다. 위치는 미수집(null)으로 기록하며 여러 사람의 지형을 자동 정합하지 않습니다. 구장 전체 절대 고도, 공 인식과 궤적은 계산하지 않습니다.", 18));
    AlertDialog dialog = panel("실데이터 분석", content, true);
    dialog.setOnDismissListener(view -> debugInfo = null);
  }

  private void requestCloudConsent(Runnable completed) {
    if(consentDialogVisible)return;
    consentDialogVisible=true;
    AlertDialog dialog=new AlertDialog.Builder(this).setTitle("측정 수치를 개선 연구에 제공할까요?")
        .setMessage("동의하면 실제 깊이·높낮이·거리·관측 품질과 기기 모델의 수치 요약을 측정 중 자동 전송합니다. 사진·영상·음성·GPS 위치는 전송하지 않습니다.\n\n자료는 관리자만 분석하며 개별 전송 조작이나 목록은 없습니다. 거절해도 측정 기능은 동일합니다. 설정 → 데이터 기록에서 동의를 철회하거나 이 기기에서 제공한 자료를 삭제할 수 있습니다.")
        .setNegativeButton("제공 안 함",(view,which)->{cloud.setConsent(false);if(completed!=null)completed.run();})
        .setPositiveButton("동의하고 계속",(view,which)->{cloud.setConsent(true);if(completed!=null)completed.run();})
        .create();
    dialog.setOnCancelListener(view->{cloud.setConsent(false);if(completed!=null)completed.run();});
    dialog.setOnDismissListener(view->consentDialogVisible=false);
    dialog.show();
  }

  private interface ToggleAction { void changed(boolean on); }
  private void addToggle(LinearLayout parent, String title, String key, boolean value, ToggleAction action) {
    CheckBox check = new CheckBox(this);
    check.setText(title); check.setTextSize(19); check.setTextColor(0xFF172D30);
    check.setButtonTintList(android.content.res.ColorStateList.valueOf(0xFF28685F));
    check.setMinHeight(dp(56)); check.setPadding(0, dp(8), 0, dp(8)); check.setChecked(value);
    parent.addView(check);
    check.setOnCheckedChangeListener((button, on) -> { preferences.edit().putBoolean(key, on).apply(); action.changed(on); });
  }
  private RadioButton radio(String title, int id) {
    RadioButton radio = new RadioButton(this); radio.setId(id); radio.setText(title); radio.setTextSize(19);
    radio.setTextColor(0xFF172D30); radio.setMinHeight(dp(56));
    radio.setButtonTintList(android.content.res.ColorStateList.valueOf(0xFF28685F)); return radio;
  }
  private void heading(LinearLayout parent, String title) {
    TextView heading = label(title, 21); heading.setTypeface(null, android.graphics.Typeface.BOLD);
    parent.addView(heading, spaced());
  }
  private Button section(LinearLayout parent, String title, String detail) {
    Button item = button(title + "  ›"); item.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
    parent.addView(item, spaced()); parent.addView(label(detail, 16)); return item;
  }
  private AlertDialog panel(String title, LinearLayout content, boolean child) {
    ScrollView scroll = new ScrollView(this); scroll.setBackgroundColor(0xFFFAFCFB); scroll.addView(content);
    AlertDialog.Builder builder = new AlertDialog.Builder(this).setTitle(title).setView(scroll).setPositiveButton("측정으로", null);
    if (child) builder.setNegativeButton("설정", (dialog, which) -> showSettings());
    AlertDialog dialog = builder.create();
    dialog.setOnShowListener(view -> {
      for (int type : new int[]{AlertDialog.BUTTON_POSITIVE, AlertDialog.BUTTON_NEGATIVE}) {
        Button control = dialog.getButton(type);
        if (control != null) { control.setTextSize(18); control.setMinHeight(dp(56)); control.setTextColor(0xFF28685F); }
      }
    });
    dialog.show();
    return dialog;
  }
  private void resetMeasurement() {
    renderer.resetRequested = true; hud.resetLabels();
    hud.setScene(new TerrainHudView.Scene(new java.util.ArrayList<>()));
    setGuidance("발 앞 지면을 약 2초 비춰 주세요");
    if (!active) start();
  }
  private void finishExport(String error, boolean showResult) {
    runOnUiThread(() -> {
      exporting = false;
      if (download != null) download.setEnabled(true);
      if (!isDestroyed() && showResult) new AlertDialog.Builder(this).setTitle(error == null ? "저장 완료" : "저장 실패")
          .setMessage(error == null ? "선택한 위치에 ZIP을 저장했습니다. 폰 내부 원본도 유지됩니다." : error + " 불완전한 파일은 사용하지 마세요.")
          .setPositiveButton("확인", null).show();
    });
  }
  private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
  private android.graphics.drawable.GradientDrawable round(int color, int radius) {
    android.graphics.drawable.GradientDrawable shape = new android.graphics.drawable.GradientDrawable();
    shape.setColor(color); shape.setCornerRadius(dp(radius)); return shape;
  }
  private TextView label(String text, int size) { TextView view = new TextView(this); view.setText(text); view.setTextSize(size); view.setTextColor(0xFF243D40); view.setPadding(0, dp(5), 0, dp(5)); return view; }
  private TextView overlayLabel(String text, int size) {
    TextView view = label(text, size); view.setTextColor(android.graphics.Color.WHITE);
    view.setShadowLayer(dp(3), 0, dp(1), 0xD0000000); return view;
  }
  private LinearLayout column() { LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); view.setPadding(dp(20), dp(8), dp(20), dp(16)); return view; }
  private LinearLayout.LayoutParams spaced() { LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(14); return params; }
  private Button button(String text) {
    Button view = new Button(this); view.setText(text); view.setTextSize(19); view.setAllCaps(false); view.setMinHeight(dp(56)); view.setMinimumHeight(dp(56));
    view.setPadding(dp(16), dp(10), dp(16), dp(10)); view.setTextColor(0xFF204D48);
    view.setBackgroundTintList(null); view.setBackground(round(0xFFE7F0ED, 12)); return view;
  }
  private Button overlayButton(String text) {
    Button view = button(text); view.setTextSize(18); view.setMinWidth(dp(64)); view.setMinimumWidth(dp(64));
    view.setTextColor(android.graphics.Color.WHITE); view.setBackground(round(0xDC162A2D, 12)); return view;
  }

  @Override protected void onResume() { super.onResume(); if(cloud!=null)cloud.foreground(true); start(); }
  private void start() {
    if (active || surface == null) return;
    if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      if (!permissionPending && !preferences.getBoolean("camera_permission_asked",false)) {
        preferences.edit().putBoolean("camera_permission_asked",true).apply();
        permissionPending = true; permission.launch(Manifest.permission.CAMERA);
      } else if(!permissionPending)showScan(ScanProgress.blocked("설정 → 사용자 보정 → 카메라 권한에서 허용해 주세요"));
      return;
    }
    try {
      if (session == null) {
        ArCoreApk.Availability availability = ArCoreApk.getInstance().checkAvailability(this);
        if (availability.isTransient()) {
          long now=android.os.SystemClock.elapsedRealtime();if(availabilityStarted==0)availabilityStarted=now;
          showScan(ScanProgress.waiting("기기 지원 확인 중","연결을 확인해 주세요 · AR 지원 확인 후 자동 시작합니다",now-availabilityStarted));
          status.postDelayed(() -> { if (!isFinishing() && !isDestroyed() && getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) start(); }, 500);
          return;
        }
        if (!availability.isSupported()) { showScan(ScanProgress.blocked("ARCore 깊이 지원 기기에서 열어 주세요 · 이 폰에는 측정값을 표시하지 않습니다")); return; }
        if (ArCoreApk.getInstance().requestInstall(this, askedInstall) == ArCoreApk.InstallStatus.INSTALL_REQUESTED) { askedInstall = false; return; }
        Session candidate = new Session(this);
        if (!candidate.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) { candidate.close(); showScan(ScanProgress.blocked("이 폰은 깊이를 지원하지 않습니다 · ARCore Depth 지원 기기를 사용해 주세요")); return; }
        Config config = new Config(candidate); config.setDepthMode(Config.DepthMode.AUTOMATIC); config.setFocusMode(Config.FocusMode.AUTO); config.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL);
        candidate.configure(config); session = candidate;
      }
      session.resume(); renderer.session = session; renderer.rotation = getWindowManager().getDefaultDisplay().getRotation(); surface.onResume(); active = true;
      if(!cloud.decided())requestCloudConsent(null);
    } catch (Exception error) { android.util.Log.e("ParkCaddy", "Start", error); showScan(ScanProgress.blocked("다른 카메라 앱을 닫은 뒤 앱을 다시 열어 주세요 · "+error.getClass().getSimpleName())); }
  }
  @Override protected void onPause() { if(renderer!=null)renderer.resetRequested=true; if(hud!=null)hud.setScene(new TerrainHudView.Scene(new java.util.ArrayList<>())); if(cloud!=null)cloud.foreground(false); if (surface != null) surface.onPause(); if (session != null) session.pause(); active = false; super.onPause(); }
  @Override protected void onDestroy() { if (renderer != null) renderer.session = null; if (recorder != null) recorder.close(); if (session != null) session.close(); super.onDestroy(); }
}