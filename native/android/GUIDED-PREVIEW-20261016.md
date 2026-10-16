# ParkCaddy 2.3.1 guided preview 인수 통합

## 기준과 변경 범위

- 저장소: https://github.com/playpark-admin/parkcaddy
- 비교 기준: feature/ground-v2 / 6a80f810cdece32ba91719ffac5b55282a5a4553
- 첨부 독립 프로젝트 ZIP SHA-256: 1e9a77c3bec19676604ead673a8c3e3d10f6542b3b12f008506a2397f8f80a2b
- 첨부 manifest 59개 파일 일치 확인 후 통합. 기존 Android 작업 변경 없음 확인.
- 기존 Java 수정: ArCameraRenderer, MainActivity, MeasurementPolicy, StableHeight.
- 추가 Java: GuideOverlayView, ResumePolicy, ScanGuide, ScanTrace.
- 추가 검사: GuidedScanCheck, ContinuationCheck. 기존 테스트 유지.
- 빌드 도구와 debug 전용 manifest, versionCode 5, debug applicationId suffix 추가.
- 기존 run-host-checks.ps1에 신규 순수 Java 의존성 3개 추가.
- 기존 클라우드 동의/철회/삭제 및 기록 코드는 변경하지 않음. 아이콘 변경 없음.
- 전체 덮어쓰기, 운영 앱 설치/삭제, GitHub push는 수행하지 않음.

## 빌드 방법

Android Studio에서 이 android 폴더를 열고 Gradle JDK를 JDK 17로 설정합니다.
AGP 8.6.1 / Gradle 8.7 / ARCore 1.48.0 / compileSdk 35를 유지합니다.
SDK platform 35와 Build Tools 34.0.0이 필요합니다.

PowerShell 예시(경로는 자신의 PC에 맞게 변경):

```powershell
$env:JAVA_HOME='C:\Program Files\Java\jdk-17'
& "$env:JAVA_HOME\bin\java.exe" tools/PreviewBuild.java --build --sdk 'C:\Users\leeik\AppData\Local\Android\Sdk'
& ./run-host-checks.ps1 -JavaHome $env:JAVA_HOME
```

`--check`는 호스트/문법 검사, `--preflight`는 준비 상태 검사이며 APK 빌드가 아닙니다.
`--build`는 호스트 검사 후 assembleDebug와 lintDebug를 실행합니다.
성공 결과는 build-logs/<실행ID>/에 APK, SHA-256, 상태, 로그로 보존됩니다.
debug 서명키는 공유하지 않습니다. 다른 PC의 debug 서명키가 다르면 기존 테스트 앱 위 업데이트가 거부될 수 있습니다. 이때 데이터 삭제부터 하지 말고 진단 ZIP을 먼저 내보낸 뒤 별도 설치 방식을 결정하세요.

## 설치 및 현장 비교 체크리스트

1. APK를 폰에 복사하고 직접 설치합니다. 앱 이름은 '파크캐디 현장테스트', ID는 `app.playpark.parkcaddy.guidedpreview`입니다. 운영 앱과 분리됩니다.
2. 카메라 권한 및 ARCore 지원 상태를 확인합니다. ARCore 미지원 기기에서 측정 가능하다고 간주하지 않습니다.
3. 처음에는 발 앞의 무늬 있는 지면을 비춥니다. 발 모양 일치나 발 인식은 조건이 아닙니다. 관측 수/기간/안정성 충족 시에만 기준을 확정합니다.
4. 기준 확정 후 전방 지면으로 기울입니다. 발끝이 화면에서 사라져도 정상입니다. 같은 지면을 보며 실제 폰 위치를 좌우로 천천히 이동합니다. 제자리 회전만으로 이동 조건이 충족되어서는 안 됩니다.
5. 알려진 동일 지점을 위/아래 각도에서 비교합니다. 줄자 등 독립 기준과 비교하고, 표시 높이/거리, 측정 소요 시간, 조명, 지면 재질을 기록합니다. 1cm 숫자 표시를 1cm 정확도로 해석하지 않습니다.
6. 3m/6m 보기 전환 시 불필요한 기준 재설정이 없어야 합니다. 미관측/불안정/만료 격자는 최신 높이로 표시되어서는 안 됩니다.
7. 잠깐 화면 중단 후 조건 충족 시 앵커만 유지하고 셀은 새로 관측해야 합니다. 오래 중단하거나 크게 이동한 경우 재기준 안내를 확인합니다.
8. 설정 → 데이터 기록 → 진단 기록 저장은 선택 사항입니다. 켠 뒤 대기/실패와 정상 표시를 모두 재현하고 '진단 기록 내보내기 · ZIP'으로 저장합니다. 기록을 꺼도 이전 파일은 유지됩니다.
9. 자동 제공 동의는 별도 선택이며 거절해도 측정 기능은 동일해야 합니다. 기존 철회/삭제 동작을 보존합니다. 실제 서버 삭제와 기기 UI 검증은 별도로 수행해야 합니다.

50m/150m 실측, GPS 공동지도, 타구 방향 추천, 다타구 정합은 이번 완료 범위가 아닙니다.
자동 검사 및 Android 빌드 성공은 실기기 동작, cm 정확도, 야외 소요 시간 단축의 증거가 아닙니다.
