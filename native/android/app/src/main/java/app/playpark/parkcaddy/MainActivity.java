package app.playpark.parkcaddy;
import android.Manifest;
import android.content.pm.PackageManager;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.google.ar.core.*;
public final class MainActivity extends AppCompatActivity {
 private GLSurfaceView surface;private TerrainHudView hud;private TextView status;
 private MeasurementRecorder recorder;private TextView recordInfo;private Button download;private boolean exporting;
 private final ActivityResultLauncher<String> saveData=registerForActivityResult(new ActivityResultContracts.CreateDocument("application/zip"),uri->{
 if(uri==null){exporting=false;if(download!=null)download.setEnabled(true);return;}
 new Thread(()->{
 try{
 java.io.OutputStream output=getApplicationContext().getContentResolver().openOutputStream(uri,"w");
 if(output==null)throw new java.io.IOException("No output stream");
 recorder.export(output,error->runOnUiThread(()->{exporting=false;if(download!=null)download.setEnabled(true);if(!isDestroyed())new androidx.appcompat.app.AlertDialog.Builder(this).setTitle(error==null?"저장 완료":"저장 실패").setMessage(error==null?"선택한 위치에 ZIP을 저장했습니다. 내부 원본은 그대로 유지됩니다.":error+" 불완전한 파일은 사용하지 마세요.").setPositiveButton("확인",null).show();}));
 }catch(Exception e){runOnUiThread(()->{exporting=false;if(download!=null)download.setEnabled(true);if(recordInfo!=null)recordInfo.setText("파일 저장 실패 · 저장 위치를 다시 선택해 주세요");});}
 },"ParkCaddy-export").start();
 });
 private Session session;private ArCameraRenderer renderer;private boolean active,askedInstall=true,permissionPending;private long lastUi;
 private final ActivityResultLauncher<String> permission=registerForActivityResult(new ActivityResultContracts.RequestPermission(),ok->{permissionPending=false;if(ok)start();else status.setText("카메라 권한이 필요합니다 · 초기화를 눌러 다시 시도");});
 private android.graphics.drawable.GradientDrawable round(int color,int radius){android.graphics.drawable.GradientDrawable d=new android.graphics.drawable.GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
 private TextView label(String text,int size,int color){TextView t=new TextView(this);t.setText(text);t.setTextSize(size);t.setTextColor(color);return t;}
 private Button button(String text,boolean selected){Button b=new Button(this);b.setText(text);b.setTextSize(12);b.setAllCaps(false);b.setMinHeight(0);b.setMinimumHeight(0);b.setMinWidth(0);b.setMinimumWidth(0);b.setPadding(dp(4),0,dp(4),0);style(b,selected);return b;}
 private void style(Button b,boolean selected){b.setBackgroundTintList(null);b.setBackground(round(selected?0xFFD1FF59:0xFF253940,12));b.setTextColor(selected?0xFF102026:0xFFE8F3F3);b.setTypeface(null,android.graphics.Typeface.BOLD);}
 private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
 public void onCreate(Bundle b){
 super.onCreate(b);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
 FrameLayout root=new FrameLayout(this);root.setBackgroundColor(0xFF102026);setContentView(root);
 getWindow().setStatusBarColor(0xFF102026);getWindow().setNavigationBarColor(0xFF102026);
 androidx.core.view.WindowInsetsControllerCompat barsController=androidx.core.view.WindowCompat.getInsetsController(getWindow(),root);barsController.setAppearanceLightStatusBars(false);barsController.setAppearanceLightNavigationBars(false);
 androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root,(v,insets)->{androidx.core.graphics.Insets bars=insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
 androidx.core.view.ViewCompat.requestApplyInsets(root);
 String appVersion="unknown";try{appVersion=getPackageManager().getPackageInfo(getPackageName(),0).versionName;}catch(android.content.pm.PackageManager.NameNotFoundException ignored){}
 recorder=new MeasurementRecorder(new java.io.File(getFilesDir(),"measurement-recordings"),MeasurementRecorder.json("app_version",appVersion,"algorithm","stable-raw-v1-recorder1","device_model",android.os.Build.MODEL,"manufacturer",android.os.Build.MANUFACTURER,"android_sdk",android.os.Build.VERSION.SDK_INT,"arcore_sdk","1.48.0","confidence_min",180,"frame_spread_max_m",.12,"temporal_min_samples",7,"temporal_min_baseline_m",.08,"grid_unit_m",.25,"raw_depth_max_m",50,"height_gate_m",2));
 surface=new GLSurfaceView(this);surface.setEGLContextClientVersion(2);hud=new TerrainHudView(this);
 status=new TextView(this);status.setTextColor(-1);status.setTextSize(13);status.setPadding(dp(12),dp(8),dp(12),dp(8));status.setBackgroundColor(0xB0000000);
 renderer=new ArCameraRenderer((scene,message)->{long now=android.os.SystemClock.elapsedRealtime();if(now-lastUi<50)return;lastUi=now;runOnUiThread(()->{hud.setScene(scene);if(recordInfo!=null&&!exporting)recordInfo.setText(recorder.status());status.setText(!hud.grid ? "그리드 표시 꺼짐 · 하단 보기 설정에서 켜세요\n"+message : message);});});
 renderer.recorder=recorder;surface.setRenderer(renderer);surface.onPause();root.addView(surface);root.addView(hud);

 LinearLayout top=new LinearLayout(this);top.setPadding(dp(16),dp(10),dp(16),dp(10));
 top.setBackground(round(0xC9102026,18));
 TextView brand=label("PARKCADDY  /  TERRAIN",15,0xFFD1FF59);brand.setTypeface(null,android.graphics.Typeface.BOLD);top.addView(brand);
 FrameLayout.LayoutParams tp=new FrameLayout.LayoutParams(-2,-2,Gravity.TOP|Gravity.START);tp.setMargins(dp(12),dp(8),dp(12),0);root.addView(top,tp);
 LinearLayout bottom=new LinearLayout(this);bottom.setOrientation(LinearLayout.VERTICAL);bottom.setPadding(dp(14),dp(10),dp(14),dp(10));bottom.setBackground(round(0xEF102026,22));
 status.setTextSize(12);status.setPadding(0,0,0,dp(8));status.setBackgroundColor(0);status.setText("발 앞 바닥이 화면 아래쪽에 보이게 비춰 주세요");
 TextView notice=label("",12,0xFFFFDE8A);notice.setPadding(dp(8),dp(6),dp(8),dp(6));notice.setBackground(round(0xFF29382C,10));notice.setVisibility(View.GONE);bottom.addView(notice);
 ScrollView statusScroll=new ScrollView(this);statusScroll.setFillViewport(false);statusScroll.setVerticalScrollBarEnabled(true);statusScroll.setScrollbarFadingEnabled(false);
 statusScroll.addView(status,new ScrollView.LayoutParams(-1,-2));bottom.addView(statusScroll,new LinearLayout.LayoutParams(-1,dp(88)));
 LinearLayout ranges=new LinearLayout(this);bottom.addView(ranges);
 int[] values={6,15,50,150};Button[] chips=new Button[4];
 for(int i=0;i<values.length;i++){
 final int selected=values[i];Button chip=button(selected+" m",false);chips[i]=chip;
 LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(0,dp(40),1);cp.setMargins(dp(2),0,dp(2),dp(8));ranges.addView(chip,cp);
 chip.setOnClickListener(v->{renderer.rangeMeters=selected;for(int j=0;j<chips.length;j++)style(chips[j],values[j]==selected);notice.setVisibility(selected>15?View.VISIBLE:View.GONE);notice.setText(selected==50?"50 m 보기 · 미측정 구간은 평면 추정\n실제 높이·거리의 정확도를 보장하지 않습니다.":"150 m 보기 · 원거리는 평면 참고 표시\n150 m 지형을 실제 측정한 결과가 아닙니다.");});
 style(chip,selected==15);
 }
 LinearLayout actions=new LinearLayout(this);bottom.addView(actions);
 Button reset=button("↻  현재 위치로 초기화",true),toggle=button("보기  ▴",false);
 LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(0,dp(48),2);rp.rightMargin=dp(8);actions.addView(reset,rp);actions.addView(toggle,new LinearLayout.LayoutParams(0,dp(48),1));
 reset.setOnClickListener(v->{renderer.resetRequested=true;hud.resetLabels();hud.setScene(new TerrainHudView.Scene(new java.util.ArrayList<>()));status.setText("기준점 초기화 · 발 앞 평평한 지면을 천천히 비춰 주세요");if(!active)start();});
 ScrollView scroll=new ScrollView(this);scroll.setVisibility(View.GONE);bottom.addView(scroll,new LinearLayout.LayoutParams(-1,dp(230)));
 LinearLayout panel=new LinearLayout(this);panel.setPadding(0,dp(8),0,0);panel.setOrientation(LinearLayout.VERTICAL);scroll.addView(panel);
 toggle.setOnClickListener(v->{boolean open=scroll.getVisibility()!=View.VISIBLE;scroll.setVisibility(open?View.VISIBLE:View.GONE);toggle.setText(open?"보기  ▾":"보기  ▴");});
 recordInfo=label(recorder.status(),12,0xFFC1CCD0);panel.addView(recordInfo);
 CheckBox recording=new CheckBox(this);recording.setText("측정 데이터 자동 저장 (폰 내부)");recording.setTextColor(-1);recorder.enabled=getSharedPreferences("recording",MODE_PRIVATE).getBoolean("enabled",true);recording.setChecked(recorder.enabled);panel.addView(recording);
 recording.setOnCheckedChangeListener((v,on)->{if(!on)recorder.event("recording_paused",-1,"{}");recorder.enabled=on;getSharedPreferences("recording",MODE_PRIVATE).edit().putBoolean("enabled",on).apply();if(on)recorder.event("recording_resumed",-1,"{}");recordInfo.setText(recorder.status());});
 download=button("측정 데이터 다운로드 · ZIP",true);panel.addView(download,new LinearLayout.LayoutParams(-1,dp(48)));
 download.setOnClickListener(v->{if(exporting)return;exporting=true;download.setEnabled(false);recordInfo.setText("파일 저장 위치를 선택하세요");saveData.launch("ParkCaddy-measurements-"+new java.text.SimpleDateFormat("yyyyMMdd-HHmmss",java.util.Locale.ROOT).format(new java.util.Date())+".zip");});
 panel.addView(label("측정값·자세·신뢰도만 기록합니다. 영상·GPS·서버 전송 없음. 최대 100 MB, 초기화해도 기록은 유지됩니다. 앱 삭제 전 ZIP을 보관하세요.",11,0xFFAFBEC5));
 for(String name:new String[]{"그리드 표시","히트맵 표시"}){CheckBox check=new CheckBox(this);check.setText(name);check.setTextColor(-1);check.setButtonTintList(android.content.res.ColorStateList.valueOf(0xFFD1FF59));check.setChecked(true);panel.addView(check);check.setOnCheckedChangeListener((v,on)->{if(name.equals("그리드 표시"))hud.grid=on;else hud.heat=on;hud.invalidate();});}
 panel.addView(label("색상 강조 · 정확도를 높이는 설정은 아닙니다",12,0xFFC1CCD0));
 SeekBar seek=new SeekBar(this);seek.setMax(40);seek.setProgress(10);panel.addView(seek);seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar b,int p,boolean u){hud.sensitivity=1+p/10f;hud.invalidate();}public void onStartTrackingTouch(SeekBar b){}public void onStopTrackingTouch(SeekBar b){}});
 panel.addView(label("파랑 낮음 ← 초록 기준 → 빨강 높음\n색상 범위 ±2 m · 작은 차이는 중립색\n화살표는 필터 기준을 넘는 높이 차이만 표시\n거리: 초기화한 위치에서의 수평거리 (폰 회전과 무관)\n근거리 촘촘한 격자 / 먼거리 1·5·10 m 격자\n점선·≈ 거리: 기준 평면 추정 / 실선: 깊이 관측\n색상 없음: 높이 미측정 (음수 높이도 표시됩니다)\n50 m 이내 깊이 관측을 시도하며, 150 m는 평면 참고 보기입니다. 높이 수치는 보정 참고용이며 cm 정확도를 보장하지 않습니다.\nG번호가 같으면 같은 격자점입니다. 저장은 이전의 안정된 관측값이며 정확도 보장이 아닙니다.\n기준 지면을 약 2초 비춘 뒤 폰을 좌우 10~20 cm 이동하며 스캔하세요.\n초기화: 저장된 지형과 시작점을 지우고 현재 위치에서 다시 측정합니다.",12,0xFFAFBEC5));
 FrameLayout.LayoutParams bp=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);bp.setMargins(dp(10),0,dp(10),dp(8));root.addView(bottom,bp);
 bottom.addOnLayoutChangeListener((v,l,t,r,bt,ol,ot,or,ob)->{hud.bottomInset=bottom.getHeight()+dp(16);hud.invalidate();});
 root.addOnLayoutChangeListener((v,l,t,r,bt,ol,ot,or,ob)->{
 int available=bt-t-root.getPaddingTop()-root.getPaddingBottom();
 int infoHeight=Math.max(dp(48),Math.min(dp(88),available/7));
 if(statusScroll.getLayoutParams().height!=infoHeight){statusScroll.getLayoutParams().height=infoHeight;statusScroll.requestLayout();}
 int settingsHeight=Math.max(dp(64),Math.min(dp(230),available/4));
 if(scroll.getLayoutParams().height!=settingsHeight){scroll.getLayoutParams().height=settingsHeight;scroll.requestLayout();}
 });

 }
 protected void onResume(){super.onResume();start();}
 private void start(){
 if(active)return;
 if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){if(!permissionPending){permissionPending=true;permission.launch(Manifest.permission.CAMERA);}return;}
 try{
 if(session==null){
 ArCoreApk.Availability a=ArCoreApk.getInstance().checkAvailability(this);
 if(a.isTransient()){status.setText("기기 지원 확인 중");status.postDelayed(()->{if(!isFinishing()&&!isDestroyed()&&getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED))start();},500);return;}
 if(!a.isSupported()){status.setText("이 폰은 AR 측정을 지원하지 않습니다");return;}
 if(ArCoreApk.getInstance().requestInstall(this,askedInstall)==ArCoreApk.InstallStatus.INSTALL_REQUESTED){askedInstall=false;return;}
 Session candidate=new Session(this);
 if(!candidate.isDepthModeSupported(Config.DepthMode.AUTOMATIC)){candidate.close();status.setText("이 폰은 깊이 측정을 지원하지 않습니다");return;}
 Config config=new Config(candidate);config.setDepthMode(Config.DepthMode.AUTOMATIC);config.setFocusMode(Config.FocusMode.AUTO);config.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL);candidate.configure(config);session=candidate;
 }
 session.resume();renderer.session=session;renderer.rotation=getWindowManager().getDefaultDisplay().getRotation();surface.onResume();active=true;
 }catch(Exception e){android.util.Log.e("ParkCaddy","Start",e);status.setText("시작 실패 · "+e.getClass().getSimpleName()+" · 초기화로 재시도");}
 }
 protected void onPause(){surface.onPause();if(session!=null)session.pause();active=false;super.onPause();}
 protected void onDestroy(){renderer.session=null;if(recorder!=null)recorder.close();if(session!=null)session.close();super.onDestroy();}
}
