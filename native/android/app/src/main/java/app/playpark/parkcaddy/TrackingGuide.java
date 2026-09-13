package app.playpark.parkcaddy;
final class TrackingGuide {
  static String tracking(String reason) {
    switch(reason) {
      case "INSUFFICIENT_LIGHT": return "격자 대기: 빛이 부족합니다\n렌즈를 가리지 말고 더 밝은 지면을 비춰 주세요.";
      case "INSUFFICIENT_FEATURES": return "격자 대기: 바닥 특징이 부족합니다\n잔디 경계·돌·바닥 무늬를 포함해 폰을 천천히 옆으로 이동하세요.";
      case "EXCESSIVE_MOTION": return "격자 대기: 폰 움직임이 너무 빠릅니다\n잠시 안정시킨 뒤 가까운 바닥을 천천히 스캔하세요.";
      case "BAD_STATE": return "격자 대기: 위치 추적 복구 중입니다\n원래 지면으로 돌아오세요. 계속되면 초기화 후 앱을 다시 여세요.";
      case "CAMERA_UNAVAILABLE": return "격자 대기: 카메라를 사용할 수 없습니다\n다른 카메라 앱을 닫고 ParkCaddy를 다시 여세요.";
      default: return "격자 대기: 위치 추적 준비 중입니다\n가까운 바닥의 무늬를 비추고 폰을 천천히 좌우로 이동하세요.";
    }
  }
}
