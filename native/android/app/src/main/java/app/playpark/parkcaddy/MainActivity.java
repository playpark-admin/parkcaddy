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

/** Senior-first local AR measurement. Never substitutes sample terrain for sensor data. */
public final class MainActivity extends AppCompatActivity {
  private GLSurfaceView surface;
  private TerrainHudView hud;
  private TextView status, recordInfo, debugInfo;
  private MeasurementRecorder recorder;
  private ArCameraRenderer renderer;
  private Session session;
  private SharedPreferences preferences;
  private MeasurementPolicy policy;
  private boolean active, askedInstall = true, permissionPending, exporting;
  private Button download;
  private long lastUi;

  private final ActivityResultLauncher<String> permission = registerForActivityResult(
      new ActivityResultContracts.RequestPermission(), granted -> {
        permissionPending = false;
        if (granted) start();
        else status.setText("카메라 권한이 필요합니다. ‘다시 측정’을 눌러 재시도하세요.");
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
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    getWindow().setStatusBarColor(0xFF102026);
    getWindow().setNavigationBarColor(0xFF102026);
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(0xFF102026);
    setContentView(root);
    androidx.core.view.WindowInsetsControllerCompat bars = androidx.core.view.WindowCompat.getInsetsController(getWindow(), root);
    bars.setAppearanceLightStatusBars(false);
    bars.setAppearanceLightNavigationBars(false);
    androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
      androidx.core.graphics.Insets system = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars());
      view.setPadding(system.left, system.top, system.right, system.bottom);
      return insets;
    });
    androidx.core.view.ViewCompat.requestApplyInsets(root);
    String version = "unknown";
    try { version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
    catch (PackageManager.NameNotFoundException ignored) { }
    recorder = new MeasurementRecorder(new java.io.File(getFilesDir(), "measurement-recordings"),
        MeasurementRecorder.json("app_version", version, "device_model", android.os.Build.MODEL,
            "android_sdk", android.os.Build.VERSION.SDK_INT, "arcore_sdk", "1.48.0",
            "policy", new MeasurementRecorder.Raw(policy.metadata())), preferences.getBoolean("recording", false));
    recorder.enabled = preferences.getBoolean("recording", false);
    surface = new GLSurfaceView(this);
    surface.setEGLContextClientVersion(2);
    hud = new TerrainHudView(this);
    hud.grid = preferences.getBoolean("grid", true);
    hud.heat = preferences.getBoolean("heat", true);
    hud.reference = preferences.getBoolean("reference", false);
    hud.largeLabels = preferences.getBoolean("large_labels", true);
    status = label("1. 멈춰 서서 발 앞 지면을 비춰 주세요.\n2. 같은 지면을 보며 폰을 천천히 좌우로 움직이세요.", 20);
    renderer = new ArCameraRenderer((scene, message) -> {
      long now = android.os.SystemClock.elapsedRealtime();
      if (now - lastUi < 150) return;
      lastUi = now;
      runOnUiThread(() -> {
        if (isDestroyed()) return;
        hud.setScene(scene);
        status.setText(message);
        if (recordInfo != null && !exporting) recordInfo.setText(recorder.status());
        if (debugInfo != null) debugInfo.setText(renderer.debugInfo);
      });
    });
    renderer.recorder = recorder;
    renderer.setPolicy(policy);
    renderer.rangeMeters = 6;
    surface.setRenderer(renderer);
    surface.onPause();
    root.addView(surface);
    root.addView(hud);

    TextView title = label("파크캐디 · 지면 살펴보기", 20);
    title.setPadding(dp(14), dp(10), dp(14), dp(10));
    title.setBackground(round(0xED102026, 18));
    FrameLayout.LayoutParams titleParams = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START);
    titleParams.setMargins(dp(10), dp(8), dp(10), 0);
    root.addView(title, titleParams);

    LinearLayout bottom = column();
    bottom.setBackground(round(0xF5102026, 22));
    TextView mode = label("가까운 6 m 보기 · 현장 정확도 검증 전", 18);
    mode.setTextColor(0xFFD1FF59);
    bottom.addView(mode);
    ScrollView guidance = new ScrollView(this);
    guidance.addView(status);
    bottom.addView(guidance, new LinearLayout.LayoutParams(-1, dp(132)));
    TextView legend = label("색: 높낮이 추정 · 빈 곳: 높이 미측정", 17);
    legend.setPadding(0, dp(4), 0, dp(10));
    bottom.addView(legend);
    LinearLayout actions = new LinearLayout(this);
    Button reset = button("다시 측정", true), settings = button("설정", false);
    LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(0, -2, 1);
    actionParams.rightMargin = dp(10);
    actions.addView(reset, actionParams);
    actions.addView(settings, new LinearLayout.LayoutParams(0, -2, 1));
    bottom.addView(actions);
    reset.setOnClickListener(view -> resetMeasurement());
    settings.setOnClickListener(view -> showSettings());
    FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
    bottomParams.setMargins(dp(10), 0, dp(10), dp(8));
    root.addView(bottom, bottomParams);
    bottom.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob) -> { hud.bottomInset = bottom.getHeight() + dp(16); hud.invalidate(); });
    root.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob) -> {
      int available = b - t - root.getPaddingTop() - root.getPaddingBottom();
      int height = Math.max(dp(72), Math.min(dp(132), available / 5));
      if (guidance.getLayoutParams().height != height) { guidance.getLayoutParams().height = height; guidance.requestLayout(); }
    });
  }

  private void showSettings() {
    LinearLayout content = column();
    content.addView(label("화면과 기록", 22));
    addToggle(content, "격자 선 표시", "grid", hud.grid, on -> { hud.grid = on; hud.invalidate(); });
    addToggle(content, "높낮이 색 표시", "heat", hud.heat, on -> { hud.heat = on; hud.invalidate(); });
    addToggle(content, "참고 평면 격자 표시", "reference", hud.reference, on -> { hud.reference = on; hud.resetLabels(); hud.invalidate(); });
    content.addView(label("참고 격자는 점선과 ≈로 표시합니다. 그곳의 지면 높이를 측정한 결과가 아닙니다.", 18));
    addToggle(content, "측정 숫자 크게 보기", "large_labels", hud.largeLabels, on -> { hud.largeLabels = on; hud.resetLabels(); hud.invalidate(); });
    addToggle(content, "엄격한 관측 필터", "strict", policy.strict, on -> {
      policy = new MeasurementPolicy(on);
      renderer.setPolicy(policy);
      hud.resetLabels();
      hud.setScene(new TerrainHudView.Scene(new java.util.ArrayList<>()));
      status.setText("필터를 변경했습니다. 기준 지면을 다시 비춰 주세요.");
    });
    content.addView(label("엄격 모드는 센서 신뢰도와 같은 격자의 높이 분산 기준을 높입니다. 측정되지 않는 곳이 늘어날 수 있으며 정확도 보증은 아닙니다. 변경하면 기준점과 지형을 다시 측정합니다.", 18));
    addToggle(content, "진단 기록을 폰에 저장", "recording", recorder.enabled, on -> {
      if (!on) recorder.event("recording_paused", -1, "{}");
      recorder.enabled = on;
      if (on) recorder.event("recording_resumed", -1, policy.metadata());
      if (recordInfo != null) recordInfo.setText(recorder.status());
    });
    content.addView(label("깊이 관측값·카메라 자세·기기 모델을 폰에만 저장합니다. 사진·음성·GPS는 기록하지 않고 서버로 전송하지 않습니다. 최대 100 MB입니다. 앱 삭제 전 기록을 내보내세요.", 18));
    recordInfo = label(recorder.status(), 18);
    content.addView(recordInfo);
    download = button("진단 기록 내보내기 · ZIP", false);
    download.setEnabled(!exporting);
    content.addView(download, spaced());
    download.setOnClickListener(view -> {
      if (exporting) return;
      exporting = true;
      download.setEnabled(false);
      saveData.launch("ParkCaddy-measurements-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.ROOT).format(new java.util.Date()) + ".zip");
    });
    Button debug = button("디버그 · 측정 원리와 상태", false);
    content.addView(debug, spaced());
    AlertDialog dialog = panel("설정", content);
    debug.setOnClickListener(view -> { dialog.dismiss(); showDebug(); });
    dialog.setOnDismissListener(view -> { recordInfo = null; download = null; });
  }

  private void showDebug() {
    LinearLayout content = column();
    content.addView(label("실제 센서 진단", 22));
    debugInfo = label(renderer.debugInfo, 18);
    debugInfo.setTextIsSelectable(true);
    content.addView(debugInfo);
    content.addView(label("계산 원리", 22), spaced());
    content.addView(label("ARCore의 카메라·움직임 추정과 Raw Depth를 사용합니다. 깊이(mm)를 카메라 내부 파라미터로 3차원 위치로 바꾸고 고정 기준점 좌표로 변환합니다.\n\n수평거리 = √(x² + z²)\n상대 높이 = 관측 y − 기준 y\n\n카메라 축 방향 깊이는 사선 거리와 다릅니다. GPS 높이를 사용한 계산이 아닙니다.", 18));
    content.addView(label("채택 기준과 오차", 22), spaced());
    content.addView(label("같은 격자에서 7회 이상·1.2초 이상 관측하고 카메라가 8 cm 이상 이동해야 높이를 표시합니다. 중앙절대편차(MAD) ≤ 2.5 cm, 일부 이상값을 뺀 범위 ≤ 8 cm 조건을 사용합니다.\n\n센서 신뢰도(0~255)는 오차 확률이 아닙니다. 필터를 통과해도 기준점·추적 오차나 잔디 윗면으로 인한 편향이 남습니다. 반복해서 비슷한 값이 나오는 것과 참값에 가까운 것은 다릅니다. 연속 촬영은 서로 비슷한 오차를 공유할 수 있어 횟수만 늘려 정밀도가 보장되지 않습니다.\n\n0.25 m 격자로 묶어 수평 위치가 최대 약 18 cm 이동할 수 있습니다. 높이 cm 표시는 cm 정확도 보증이 아닙니다. 줄자·수평계 또는 측량 기준값으로 현장 오차를 확인해야 합니다.\n\n이 버전은 구장 전체의 절대 고도, 공 인식, 공 궤적을 계산하지 않습니다. GPS와 사진 누적 수집은 별도 수집 서비스에서 진행합니다. 위치만 같다고 서로 다른 AR 좌표를 합치면 안 됩니다.", 18));
    AlertDialog dialog = panel("디버그", content);
    dialog.setOnDismissListener(view -> debugInfo = null);
  }

  private interface ToggleAction { void changed(boolean on); }
  private void addToggle(LinearLayout parent, String title, String key, boolean value, ToggleAction action) {
    CheckBox check = new CheckBox(this);
    check.setText(title); check.setTextSize(20); check.setTextColor(0xFFF2F8F5);
    check.setButtonTintList(android.content.res.ColorStateList.valueOf(0xFFD1FF59));
    check.setMinHeight(dp(64)); check.setPadding(0, dp(8), 0, dp(8)); check.setChecked(value);
    parent.addView(check);
    check.setOnCheckedChangeListener((button, on) -> { preferences.edit().putBoolean(key, on).apply(); action.changed(on); });
  }

  private AlertDialog panel(String title, LinearLayout content) {
    ScrollView scroll = new ScrollView(this); scroll.setBackgroundColor(0xFF102026); scroll.addView(content);
    AlertDialog dialog = new AlertDialog.Builder(this).setTitle(title).setView(scroll).setPositiveButton("닫기", null).create();
    dialog.setOnShowListener(view -> { Button close = dialog.getButton(AlertDialog.BUTTON_POSITIVE); close.setTextSize(20); close.setMinHeight(dp(56)); });
    dialog.show();
    return dialog;
  }
  private void resetMeasurement() {
    renderer.resetRequested = true; hud.resetLabels();
    hud.setScene(new TerrainHudView.Scene(new java.util.ArrayList<>()));
    status.setText("발 앞 지면을 약 2초 비춘 뒤 폰을 좌우로 천천히 움직이세요.");
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
  private TextView label(String text, int size) { TextView view = new TextView(this); view.setText(text); view.setTextSize(size); view.setTextColor(0xFFF2F8F5); view.setPadding(0, dp(4), 0, dp(4)); return view; }
  private LinearLayout column() { LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); view.setPadding(dp(16), dp(12), dp(16), dp(12)); return view; }
  private LinearLayout.LayoutParams spaced() { LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(12); return params; }
  private Button button(String text, boolean primary) {
    Button view = new Button(this); view.setText(text); view.setTextSize(20); view.setAllCaps(false); view.setMinHeight(dp(64)); view.setMinimumHeight(dp(64));
    view.setPadding(dp(12), dp(12), dp(12), dp(12)); view.setTextColor(primary ? 0xFF102026 : 0xFFF2F8F5);
    view.setBackgroundTintList(null); view.setBackground(round(primary ? 0xFFD1FF59 : 0xFF29464A, 14)); return view;
  }

  @Override protected void onResume() { super.onResume(); start(); }
  private void start() {
    if (active || surface == null) return;
    if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      if (!permissionPending) { permissionPending = true; permission.launch(Manifest.permission.CAMERA); }
      return;
    }
    try {
      if (session == null) {
        ArCoreApk.Availability availability = ArCoreApk.getInstance().checkAvailability(this);
        if (availability.isTransient()) {
          status.setText("기기 지원을 확인하고 있습니다.");
          status.postDelayed(() -> { if (!isFinishing() && !isDestroyed() && getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) start(); }, 500);
          return;
        }
        if (!availability.isSupported()) { status.setText("이 폰은 AR 지면 측정을 지원하지 않습니다. 측정 숫자를 표시하지 않습니다."); return; }
        if (ArCoreApk.getInstance().requestInstall(this, askedInstall) == ArCoreApk.InstallStatus.INSTALL_REQUESTED) { askedInstall = false; return; }
        Session candidate = new Session(this);
        if (!candidate.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) { candidate.close(); status.setText("이 폰은 깊이 측정을 지원하지 않습니다. 측정 숫자를 표시하지 않습니다."); return; }
        Config config = new Config(candidate); config.setDepthMode(Config.DepthMode.AUTOMATIC); config.setFocusMode(Config.FocusMode.AUTO); config.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL);
        candidate.configure(config); session = candidate;
      }
      session.resume(); renderer.session = session; renderer.rotation = getWindowManager().getDefaultDisplay().getRotation(); surface.onResume(); active = true;
    } catch (Exception error) { android.util.Log.e("ParkCaddy", "Start", error); status.setText("시작하지 못했습니다. ‘다시 측정’을 눌러 주세요.\n" + error.getClass().getSimpleName()); }
  }
  @Override protected void onPause() { if (surface != null) surface.onPause(); if (session != null) session.pause(); active = false; super.onPause(); }
  @Override protected void onDestroy() { if (renderer != null) renderer.session = null; if (recorder != null) recorder.close(); if (session != null) session.close(); super.onDestroy(); }
}
