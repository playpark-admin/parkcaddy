# 검증 기록 — 2026-09-27

## 실행 완료
- 원본 Git 전체 이력 번들: verify 통과.
- 웹 물리 계산: Node 7개 테스트 통과. 입력 구간 전체 포괄, 잘못된 값과 지평선·거리 초과 차단.
- Android: 순수 Java 호스트 검사 9개 통과, Java 소스 15개 문법 검사 통과. 신규 필터/반복 timestamp/기록 동의 포함.
- 웹 브라우저: 가상 카메라·GPS로 촬영·기기 저장, 설정 재접속 유지, 모바일 가로 넘침 없음, 동의창, 오프라인 화면 검사 통과.
- 실제 새 Firebase: 익명 로그인, 동의 후 가상 사진/위치 전송, 본인 읽기, 타인 읽기 거부, verified 상태 위조 거부, 서버 기록 삭제 통과. 테스트용 계정 정리.
- 전송 상태: pending/uncertain/deleting을 먼저 저장. 모의 실패·응답 유실·저장 실패·중복 작업 등 9개 시나리오 통과.
- Firestore 규칙: 공식 배포 컴파일 및 서울 리전 배포 완료.
- Git 변경 형식 검사 통과.

## 아직 이 결과가 의미하지 않는 것
실제 잔디·햇빛·움직임·카메라 보정 조건에서 거리/높이 정밀도를 검증한 것은 아닙니다.
가상 브라우저 센서는 iPhone Safari/Android Chrome 실제 하드웨어 검사를 대신하지 않습니다.
Windows 로컬에 JDK17/Android SDK 및 Xcode가 없어 네이티브 APK 빌드/lint/iOS XCTest를 여기서 실행하지 않았습니다. GitHub Actions에서 별도 빌드 검증을 실행하도록 구성했습니다. 실제 상태는 Actions 결과를 확인합니다.

## GitHub 원격 검증 완료
코드 fefcbd33644cff1978790aacd47ae353dd3c3fc8 기준 [실행 결과](https://github.com/playpark-admin/parkcaddy/actions/runs/36267925930).
- 웹 수학 7개 성공.
- Android JDK17/SDK35: 9개 Java 호스트 검사, assembleDebug, lintDebug 성공. 테스트 APK 생성.
- iOS Xcode16.4: unsigned simulator build 성공, XCTest 실제 13개 실행·실패 0.
- 실제 배포 URL에서도 가상 사진·위치로 동의/전송/접근제어/삭제 검증 성공.
- Windows 로컬 미실행 제한은 원격 빌드로 보완했습니다. 실기기와 현장 정확도 검증은 여전히 별도입니다.
