import { estimateFlatDistance } from "./physics.mjs";
import { saveRecord, listRecords, deleteRecord } from "./storage.mjs";
import {
  cloudConfigured,
  prepareUpload,
  uploadRecord,
  removeCloudRecord,
} from "./cloud.mjs";
import { createCollector, COLLECTION_CONSENT_VERSION } from "./collection.mjs";
import { summarizeAngles } from "./diagnostics.mjs";
import { connectScorecard } from "./embed.mjs";
const $ = (s) => document.querySelector(s);
const defaults = {
  largeText: false,
  voice: false,
  haptic: true,
  grid: true,
  estimate: false,
  heightM: 1.2,
  heightErrorM: 0.05,
  angleErrorDeg: 1,
  angleOffset: 0,
};
let settings = { ...defaults };
try {
  settings = {
    ...defaults,
    ...JSON.parse(localStorage.getItem("pc-settings") || "{}"),
  };
} catch {}
let stream = null,
  watch = null,
  position = null,
  imu = null,
  cameraFacing = null,
  active = false,
  generation = 0,
  noticeTimer;
let angleSamples = [],
  frames = 0,
  videoCallback = null,
  capturing = false,
  latestDiagnostics = {};
const sessionId = crypto.randomUUID();
function readConsent() {
  try {
    return JSON.parse(localStorage.getItem("pc-collection-consent") || "null");
  } catch {
    return null;
  }
}
const collector = createCollector({
  store: { list: listRecords, save: saveRecord, delete: deleteRecord },
  cloud: { prepareUpload, uploadRecord, removeCloudRecord },
  consent: {
    get: () => readConsent(),
    set: (value) =>
      localStorage.setItem("pc-collection-consent", JSON.stringify(value)),
  },
  lock: (callback) =>
    navigator.locks
      ? navigator.locks.request("parkcaddy-ground-collection", callback)
      : callback(),
  onChange: () => updatePrivacy(),
});
for (let i = 1; i <= 36; i++)
  $("#hole").add(new Option(i + "번 홀", String(i)));
try {
  const c = JSON.parse(localStorage.getItem("pc-context") || "null");
  if (c) {
    $("#course").value = c.course || "";
    $("#hole").value = c.hole || "";
  }
} catch {}
const bridge = connectScorecard((context) => {
  $("#course").value = context.course;
  $("#hole").value = context.hole || "";
  updateContext();
});
function updateContext() {
  const course = $("#course").value.trim(),
    hole = $("#hole").value;
  $("#context-label").textContent =
    (course || "구장 미지정") +
    (hole ? " · " + hole + "번 홀" : " · 홀 미지정");
}
function notice(message) {
  (document.querySelector("dialog[open]") || document.body).append(
    $("#notice"),
  );
  $("#notice").textContent = message;
  $("#notice").classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => $("#notice").classList.remove("visible"),
    4500,
  );
  if (settings.voice && "speechSynthesis" in window) {
    speechSynthesis.cancel();
    const s = new SpeechSynthesisUtterance(message);
    s.lang = "ko-KR";
    s.rate = 0.9;
    speechSynthesis.speak(s);
  }
}
window.addEventListener("deviceorientation", (e) => {
  if (!active || !Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return;
  const down =
    Math.cos((e.beta * Math.PI) / 180) * Math.cos((e.gamma * Math.PI) / 180);
  imu = {
    beta: e.beta,
    gamma: e.gamma,
    alpha: Number.isFinite(e.alpha) ? e.alpha : null,
    angleDeg: (Math.asin(Math.max(-1, Math.min(1, down))) * 180) / Math.PI,
    timestamp: Date.now(),
  };
  angleSamples.push({ angleDeg: imu.angleDeg, timestamp: imu.timestamp });
  angleSamples = angleSamples
    .filter((s) => imu.timestamp - s.timestamp <= 5000)
    .slice(-1200);
  telemetry();
});
function trackFrames(current) {
  const video = $("#video");
  if (!video.requestVideoFrameCallback) return;
  videoCallback = video.requestVideoFrameCallback(() => {
    if (current !== generation) return;
    frames++;
    trackFrames(current);
  });
}
async function start() {
  if (active) return;
  active = true;
  const current = ++generation;
  position = null;
  imu = null;
  angleSamples = [];
  frames = 0;
  $("#placeholder").hidden = false;
  $("#placeholder").textContent = "카메라를 준비하고 있어요";
  $("#cam-status").textContent = "준비 중";
  $("#start").disabled = true;
  let permission = Promise.resolve("unavailable");
  try {
    if (typeof DeviceOrientationEvent !== "undefined")
      permission =
        typeof DeviceOrientationEvent.requestPermission === "function"
          ? DeviceOrientationEvent.requestPermission()
          : Promise.resolve("granted");
  } catch {}
  permission
    .then((result) => {
      if (current === generation && result !== "granted")
        $("#imu-status").textContent = "사용 안 함";
    })
    .catch(() => {
      if (current === generation) $("#imu-status").textContent = "권한 없음";
    });
  if (navigator.geolocation)
    watch = navigator.geolocation.watchPosition(
      (p) => {
        if (current !== generation) return;
        position = {
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
          altitude: p.coords.altitude,
          altitudeAccuracy: p.coords.altitudeAccuracy,
          timestamp: p.timestamp,
        };
        telemetry();
      },
      () => {
        if (current !== generation) return;
        position = null;
        $("#gps-status").textContent = "사용 불가";
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Error("unavailable");
    const next = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
      audio: false,
    });
    if (current !== generation) {
      next.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = next;
    cameraFacing = stream.getVideoTracks()[0].getSettings().facingMode || null;
    $("#video").srcObject = stream;
    await $("#video").play();
    if (current !== generation) return;
    $("#placeholder").hidden = true;
    $("#cam-status").textContent = "연결됨";
    $("#start").hidden = true;
    $("#shoot").hidden = false;
    $("#shoot").disabled = false;
    trackFrames(current);
  } catch {
    if (current !== generation) return;
    stop();
    $("#placeholder").textContent =
      "카메라 권한을 확인해 주세요. 설정에서 기본 카메라를 이용할 수도 있어요.";
    $("#cam-status").textContent = "연결 안 됨";
  } finally {
    if (current === generation) $("#start").disabled = false;
    telemetry();
  }
}
function stop() {
  active = false;
  ++generation;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  cameraFacing = null;
  if (watch !== null) navigator.geolocation.clearWatch(watch);
  watch = null;
  if (videoCallback !== null)
    $("#video").cancelVideoFrameCallback?.(videoCallback);
  videoCallback = null;
  $("#video").srcObject = null;
  $("#shoot").hidden = true;
  $("#shoot").disabled = true;
  $("#start").hidden = false;
  $("#start").disabled = false;
  $("#placeholder").hidden = false;
  $("#placeholder").textContent = "바닥을 향해 카메라를 켜 주세요";
  $("#cam-status").textContent = "중지됨";
  telemetry();
}
$("#start").onclick = start;
$("#stop").onclick = () => {
  stop();
  if (!bridge.close()) notice("카메라를 종료했어요.");
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
  else collector.syncPending().catch(() => {});
});
window.addEventListener("pagehide", stop);
window.addEventListener("online", () =>
  collector.syncPending({ forceRetry: true }).catch(() => {}),
);
function estimate() {
  if (!settings.estimate)
    return {
      valid: false,
      reason: "설정에서 평지 가정 거리 표시를 켤 수 있습니다.",
    };
  if (cameraFacing !== "environment")
    return { valid: false, reason: "후면 카메라 광축이 확인되지 않았습니다." };
  if (!active || !imu || Date.now() - imu.timestamp > 1500)
    return { valid: false, reason: "동기화된 조준각이 없거나 오래되었습니다." };
  return estimateFlatDistance({
    heightM: settings.heightM,
    heightErrorM: settings.heightErrorM,
    angleDeg: imu.angleDeg + settings.angleOffset,
    angleErrorDeg: settings.angleErrorDeg,
    maxDistanceM: 15,
  });
}
function telemetry() {
  const result = estimate(),
    summary = summarizeAngles(angleSamples),
    now = Date.now();
  $("#distance").textContent = result.valid
    ? result.distanceM.toFixed(1) + " m"
    : "—";
  $("#distance-quality").textContent = result.valid
    ? "참고값"
    : settings.estimate
      ? "측정 조건 확인"
      : "설정에서 사용";
  $("#distance-note").textContent = result.valid
    ? result.minM.toFixed(2) +
      " ~ " +
      result.maxM.toFixed(2) +
      " m · 최대 편차 " +
      result.worstCaseM.toFixed(2) +
      " m (입력 가정 내)"
    : result.reason;
  $("#sensitivity-data").textContent = result.valid
    ? "상대 편차 " +
      (result.relativeError * 100).toFixed(1) +
      "% · 실제 기기의 정확도 보장 아님"
    : "거리와 높이차를 같은 기울기만으로 동시에 결정할 수 없습니다.";
  $("#gps-status").textContent = !active
    ? "수집 중지"
    : !position
      ? "수신 대기"
      : now - position.timestamp < 30000
        ? "수평 ±" +
          Math.round(position.accuracy) +
          " m · " +
          ((now - position.timestamp) / 1000).toFixed(1) +
          "초 전"
        : "오래된 값 · 사용 제외";
  $("#imu-status").textContent = !active
    ? "수집 중지"
    : imu && now - imu.timestamp <= 1500
      ? "수신 중 · " + (now - imu.timestamp) + " ms 전"
      : "각도 수신 대기";
  $("#angle-data").textContent =
    active && imu && now - imu.timestamp <= 1500
      ? (imu.angleDeg + settings.angleOffset).toFixed(2) + "°"
      : "—";
  $("#sample-data").textContent = summary.count + "개 / 5초";
  $("#spread-data").textContent = summary.count
    ? summary.medianDeg.toFixed(3) + "° / " + summary.madDeg.toFixed(3) + "°"
    : "—";
  $("#frame-data").textContent = $("#video").requestVideoFrameCallback
    ? frames + "개"
    : "브라우저 미지원";
  latestDiagnostics = {
    app: "2.1.0",
    sessionId,
    captureActive: active,
    cameraFacing,
    orientation: imu,
    position,
    gpsAgeMs: position ? now - position.timestamp : null,
    orientationAgeMs: imu ? now - imu.timestamp : null,
    angleSummary: summary,
    decodedVideoFrames: frames,
    settings: { ...settings },
    estimate: result,
    terrain: {
      measured: false,
      reason:
        "웹 카메라는 metric depth·pose 미제공. 화면 격자는 조준 안내이며 지형 격자가 아님.",
    },
    formula:
      "d=h*cot(alpha); min=(h-eh)*cot(alpha+ea), max=(h+eh)*cot(alpha-ea)",
    uncertainty: "모델·입력 가정 내 범위. 반복각도 MAD는 정확도 인증 아님.",
  };
  $("#debug-data").textContent = JSON.stringify(latestDiagnostics, null, 2);
}
setInterval(() => {
  if (active || $("#settings").open) telemetry();
}, 1000);
setInterval(() => {
  if (active) collector.syncPending().catch(() => {});
}, 30000);
async function compress(source) {
  const w = source.videoWidth || source.naturalWidth || source.width,
    h = source.videoHeight || source.naturalHeight || source.height;
  if (!w || !h) throw Error("사진을 읽을 수 없어요.");
  const scale = Math.min(1, 1280 / Math.max(w, h)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  let quality = 0.85,
    data = canvas.toDataURL("image/jpeg", quality);
  while (data.length > 650000 && quality > 0.35) {
    quality -= 0.1;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  if (data.length > 700000)
    throw Error("사진이 너무 커요. 다시 촬영해 주세요.");
  return { data, width: canvas.width, height: canvas.height };
}
async function capture(source, fromFile = false) {
  if (capturing) return;
  capturing = true;
  $("#shoot").disabled = true;
  try {
    const at = Date.now(),
      gps =
        !fromFile && position && at - position.timestamp < 30000
          ? structuredClone(position)
          : null,
      orientation =
        !fromFile && imu && at - imu.timestamp < 1500
          ? structuredClone(imu)
          : null,
      result = !fromFile
        ? estimate()
        : { valid: false, reason: "사진 촬영 시각과 동기화된 센서 없음" },
      image = await compress(source);
    const record = {
      id: crypto.randomUUID(),
      sessionId,
      createdAt: new Date(at).toISOString(),
      course: $("#course").value.trim(),
      hole: $("#hole").value ? Number($("#hole").value) : null,
      surface: $("#surface").value,
      image: image.data,
      imageWidth: image.width,
      imageHeight: image.height,
      source: fromFile ? "camera-file" : "live-camera",
      gps,
      orientation,
      estimate: result,
      settings: structuredClone(settings),
      terrainMeasured: false,
      cloudStatus: "local",
      device: navigator.userAgent.slice(0, 250),
      algorithmVersion: "flat-interval-v1",
      photoPurpose: "surface-history-not-metric-reconstruction",
    };
    await collector.queueRecord(record);
    if (settings.haptic) navigator.vibrate?.(70);
    notice("촬영했어요.");
    bridge.send("parkcaddy:captured");
  } catch (e) {
    notice(
      e.name === "QuotaExceededError"
        ? "저장 공간이 부족해요. 설정에서 저장 데이터를 정리해 주세요."
        : e.message,
    );
  } finally {
    capturing = false;
    $("#shoot").disabled = !stream;
  }
}
$("#shoot").onclick = () => capture($("#video"));
$("#photo-file").onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  let url;
  try {
    url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    await capture(img, true);
  } catch {
    notice("사진을 읽지 못했어요. JPEG 사진으로 다시 시도해 주세요.");
  } finally {
    if (url) URL.revokeObjectURL(url);
    e.target.value = "";
  }
};
function apply() {
  document.documentElement.classList.toggle("large-text", settings.largeText);
  $("#aim-grid").hidden = !settings.grid;
  $(".grid-label").hidden = !settings.grid;
  telemetry();
}
$("#settings-open").onclick = () => {
  for (const [name, value] of Object.entries(settings)) {
    const input = $("#settings-form").elements.namedItem(name);
    if (input)
      input.type === "checkbox"
        ? (input.checked = value)
        : (input.value = value);
  }
  updatePrivacy();
  telemetry();
  $("#settings").showModal();
};
$("#settings-close").onclick = () => $("#settings").close();
$("#settings-form").onsubmit = (e) => {
  e.preventDefault();
  try {
    const form = $("#settings-form"),
      next = {};
    for (const [name, base] of Object.entries(defaults)) {
      const input = form.elements.namedItem(name);
      next[name] =
        typeof base === "boolean" ? input.checked : Number(input.value);
    }
    if (!Number.isFinite(next.heightM) || next.heightErrorM >= next.heightM)
      throw Error("높이 오차는 카메라 높이보다 작아야 해요.");
    localStorage.setItem("pc-settings", JSON.stringify(next));
    settings = next;
    localStorage.setItem(
      "pc-context",
      JSON.stringify({
        course: $("#course").value.trim(),
        hole: $("#hole").value ? Number($("#hole").value) : null,
      }),
    );
    updateContext();
    apply();
    $("#settings").close();
    notice("설정을 저장했어요.");
  } catch (e) {
    notice(e.message);
  }
};
function updatePrivacy() {
  let state;
  try {
    const value = collector.getConsent();
    state = value?.version === COLLECTION_CONSENT_VERSION ? value.state : null;
  } catch {}
  $("#collection-state").textContent =
    state === "accepted"
      ? "데이터 제공에 동의한 상태입니다."
      : state === "revoked"
        ? "데이터 제공을 중지했습니다."
        : state === "declined"
          ? "데이터를 제공하지 않습니다."
          : "데이터 제공 여부를 선택하지 않았습니다.";
  $("#collection-revoke").disabled = state !== "accepted";
  $("#collection-detail").textContent = cloudConfigured
    ? "이 기기에서 동의한 이후 촬영분만 자동 전송합니다. 이전 촬영분은 소급 전송하지 않습니다."
    : "서버 연결을 준비 중입니다.";
}
$("#collection-enable").onclick = () => $("#consent").showModal();
$("#consent-accept").onclick = async () => {
  try {
    await collector.acceptConsent();
    $("#consent").close();
    updatePrivacy();
  } catch (e) {
    notice(e.message);
  }
};
$("#consent-decline").onclick = async () => {
  try {
    await collector.declineConsent();
    $("#consent").close();
    updatePrivacy();
  } catch (e) {
    notice(e.message);
  }
};
$("#consent").addEventListener("cancel", (e) => {
  e.preventDefault();
  $("#consent-decline").click();
});
$("#collection-revoke").onclick = async () => {
  await collector.revokeConsent();
  updatePrivacy();
  notice("앞으로 데이터를 제공하지 않아요.");
};
$("#collection-delete").onclick = async () => {
  if (
    !confirm(
      "데이터 제공을 중지하고 이 기기에서 제공한 서버 데이터를 삭제할까요? 기기 원본은 유지됩니다.",
    )
  )
    return;
  const button = $("#collection-delete");
  button.disabled = true;
  try {
    await collector.revokeConsent({ deleteExisting: true });
    updatePrivacy();
    const left = (await listRecords()).filter(
      (r) => r.ownerUid || r.cloudStatus === "delete-pending",
    );
    notice(
      left.length
        ? "삭제를 완료하지 못한 자료가 있어요. 연결 후 다시 삭제해 주세요."
        : "서버 데이터를 삭제했어요.",
    );
  } catch {
    notice("삭제 완료를 확인하지 못했어요. 연결 후 다시 시도해 주세요.");
  } finally {
    button.disabled = false;
  }
};
$("#export-diagnostics").onclick = () => {
  telemetry();
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(latestDiagnostics, null, 2)], {
        type: "application/json",
      }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "parkcaddy-diagnostics.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
updateContext();
apply();
updatePrivacy();
if (
  !collector.getConsent()?.state ||
  collector.getConsent()?.version !== COLLECTION_CONSENT_VERSION
)
  $("#consent").showModal();
window.addEventListener("storage", (e) => {
  if (e.key === "pc-collection-consent") updatePrivacy();
});
collector.syncPending().catch(() => {});
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
