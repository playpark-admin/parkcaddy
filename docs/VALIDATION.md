# 검증 기록 — 2026-09-27 / 2.2 자동 스캔

실행 코드: `b79b24088a6782acfba43dbe539f660e99958562`.

## 완료한 검사
- Node 테스트 43개 통과: 실제 깊이 역투영, 반복 관측 집계, 시간·이동폭·MAD 조건, 중복 깊이 버퍼 거부, 오래된 관측 제거, 미관측 지점 연결 금지, WebXR 세션 수명주기, 동의·삭제·업로드 경로.
- 브라우저 통합 검사 통과: 미지원 환경의 빈 그리드·미측정 숫자 숨김, 세로·가로·데스크톱 전체 화면, 설정 유지·오프라인 화면, 촬영 버튼 제거.
- 합성 WebXR 센서로 실제 앱과 엔진을 연결하여 관측 부족 진행 표시 → 자동 그리드·거리·높이 표시, 깊이·추적 손실 시 즉시 숨김을 확인. 이 입력은 테스트 전용이며 제품의 대체 측정 모드가 아닙니다.
- 새 Firebase 실제 서버 규칙 배포·컴파일 성공. WebXR 관측의 동의 후 자동 업로드, 소유자 포함 원자료 조회 차단, 원자적 삭제, 삭제 후 지연 업로드 거부 통과.
- 기존 사진/Android REST commit/iOS REST createDocument의 권한·삭제·동의 회귀 검사도 통과. 시험용 원자료와 익명 계정은 정리했고, 내용 없는 삭제표식만 유지했습니다.

## 플랫폼 빌드와 배포
[자동 스캔 빌드 검사](https://github.com/playpark-admin/parkcaddy/actions/runs/36272343814) 전체 성공.

- Android JDK17/SDK35: 호스트 검사 11개, APK 빌드, lint, Gradle 검사 성공.
- iOS: unsigned Simulator 빌드 성공. XCTest 28개, 실패 0개(자동 정책 6 + 깊이 계산 13 + 연구 기록 9).
- Firebase Hosting과 규칙 배포 완료. 배포된 주소에서도 브라우저 통합 검사와 실제 Firebase 수집·접근·삭제 회귀 검사가 통과했습니다.
- GitHub 설치 파일은 비로그인 요청에서 HTTP 200, APK MIME과 파일 크기 4,138,245 bytes를 확인했습니다.

웹: https://parkcaddy-ground-2026.web.app
Android: [2.2 미리보기 릴리스](https://github.com/playpark-admin/parkcaddy/releases/tag/ground-v2.2-preview)
APK SHA-256: `90FA745B5C620AA925F1C9E2AA0BDA21F653FEFDD8E5831171EF88692FDD53A1`.

Firebase Spark의 실행 파일 배포 제한 때문에 APK는 GitHub Releases에서 제공합니다. 결제 요금제는 변경하지 않았습니다. 빌드 이후 변경은 웹의 APK 링크, Hosting 배포 제외 설정, 브라우저 검사와 문서입니다. iOS 산출물은 서명되지 않은 시뮬레이터 앱이며 iPhone에 설치할 수 있는 배포본이 아닙니다.

## 해석 범위
실제 Android 휴대폰의 브라우저에서 깊이를 수신한 현장 검사는 아직 수행하지 않았습니다. 브라우저 모의 센서와 iOS 시뮬레이터는 카메라·ARCore·LiDAR·GPS 실측 검증을 대신하지 않습니다. 실제 잔디·햇빛·움직임 조건에서 cm 정확도가 보장된다는 의미도 아닙니다.

2.2 웹은 실제 WebXR 깊이가 제공되어 관측 조건을 통과한 경우에만 지형 격자를 표시합니다. 높이는 최초 지면 후보 대비 상대값이며, 물체의 의미 분류는 하지 않습니다. 넓고 평평한 책상·벤치는 지면으로 오인할 수 있습니다. 첫 지면을 잘못 선택했을 때 설정에서 기준을 다시 잡아야 합니다.

진행률은 관측 조건의 충족도를 나타냅니다. 확률적 정확도, 현장 오차 상한 또는 측량 정확도 보증이 아닙니다. 미지원 환경에는 실제 지면을 측정하는 것처럼 임의의 격자를 표시하지 않습니다.

## 이전 검증
- 2.1: 웹 24개, Android 호스트 10개·APK 빌드·lint, iOS XCTest 22개·시뮬레이터 빌드 통과. [실행 기록](https://github.com/playpark-admin/parkcaddy/actions/runs/36270205267). 2.1 웹의 그리드는 지형 측정이 아닌 화면 조준 안내였습니다.
- 2.0: 웹 7개, Android 호스트 9개·빌드·lint, iOS XCTest 13개 통과. [실행 기록](https://github.com/playpark-admin/parkcaddy/actions/runs/36267925930).
