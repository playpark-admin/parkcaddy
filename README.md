# ParkCaddy

파크골프 지면의 상대 높낮이와 수평거리를 표시하는 실험용 AR 앱입니다.
최신 Android 기능: ARCore Raw Depth/신뢰도 필터, 안정화된 기준점, 거리별 격자,
히트맵, 6·15·50·150 m 보기, 로컬 측정 기록 및 ZIP 내보내기.

## 소스 구성

- `native/android`: 현재 개발 중인 Android 앱, Gradle Wrapper, 테스트 및 변경 기록
- `native/ios`: ARKit 초기 구현. Android와 기능 동등성 및 실기기 검증은 미완료
- `web`: 기존 Vite/웹 및 Colab 실험 소스. 실제 Android 측정 앱과 별개
- 루트 `index.html`: 기존 GitHub Pages 페이지. 이번 소스 공유에서 변경하지 않음

## 다른 PC에서 Android 개발 시작

1. Git과 Android Studio를 설치하고 이 저장소를 복제합니다.
   `git clone https://github.com/playpark-admin/parkcaddy.git`
2. Android Studio에서 `parkcaddy/native/android` 폴더를 엽니다.
3. SDK Manager에서 **Android SDK Platform 35**, SDK Build-Tools 및 Platform-Tools를 설치합니다.
4. **Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK**를 **JDK 17**로 지정합니다.
   JDK 25를 선택하면 Gradle 8.7과 호환되지 않습니다.
5. Gradle Sync를 실행합니다. 최초 실행에는 인터넷 연결이 필요합니다.
6. USB 디버깅을 허용한 ARCore Depth 지원 Android 폰을 선택하고 Run을 누릅니다.
   Android Studio가 생성하는 `local.properties`는 PC별 파일이므로 공유하지 않습니다.

명령행 빌드(먼저 JAVA_HOME=JDK 17, ANDROID_HOME=각 PC의 SDK 경로 설정):

```powershell
cd native/android
.\gradlew.bat :app:assembleDebug :app:lintDebug
```

macOS/Linux: `./gradlew :app:assembleDebug :app:lintDebug`

APK 출력: `native/android/app/build/outputs/apk/debug/app-debug.apk`
Gradle 8.7 / Android Gradle Plugin 8.6.1 / ARCore SDK 1.48.0.
다른 PC의 debug 서명키는 다를 수 있습니다. 설치 시 서명 충돌이 나면 기존 앱을 지우기 **전에**
측정 ZIP을 내보내세요. 앱 제거는 내부 기록을 삭제합니다. 서명키는 이 저장소에 올리지 않습니다.

## 측정 및 기록

밝은 바닥의 무늬·이음선을 비추고 기준점이 잡히면 폰을 천천히 좌우 이동해 스캔합니다.
보기 → 측정 데이터 다운로드 · ZIP에서 기록을 내보냅니다.
실측 기록은 개인정보 보호를 위해 저장소에 포함하지 않습니다.
데이터 형식/한도: [기록 안내](native/android/RECORDING-EXPORT.md).

50/150 m 보기는 실제 원거리 측량을 보장하지 않습니다. 미측정 격자는 기준 평면 추정입니다.
cm 표시는 cm 정확도 보장이 아니며 측정 기록도 정답 데이터가 아닙니다.
식생/사물을 지면과 완벽히 구분하지 못합니다.

## 웹 및 iOS

웹: Node.js 22 이상에서 `cd web`, `npm ci`, `npm run dev`.
`npm run build`는 웹 프로토타입을 빌드합니다. 터널/Colab 파일은 보관용 실험 도구이며
별도 의존성과 외부 서비스가 필요할 수 있습니다. 터널 실행은 웹 빌드에 필요하지 않습니다.

iOS: macOS, Xcode, XcodeGen이 필요합니다. `native/ios`에서 `xcodegen generate` 후
생성된 프로젝트를 열고 본인의 개발 팀/서명을 설정합니다. 지면 깊이 모드에는 LiDAR 지원 기기가 필요합니다.
Windows에서는 iOS 앱을 빌드할 수 없습니다.

## 공동 작업

읽기 공유: 저장소 URL을 전달합니다(비공개 저장소라면 권한 필요).
직접 push 권한은 소유자가 GitHub Settings → Collaborators에서 별도로 부여합니다.
각자 브랜치에서 작업한 뒤 Pull Request로 합치세요.
API 키, 서명키, 측정 ZIP/JSONL, 카메라 사진 및 PC별 설정은 커밋하지 마세요.
