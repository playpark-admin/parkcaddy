import { estimateFlatDistance } from "./physics.mjs";
import { saveRecord, listRecords, deleteRecord } from "./storage.mjs";
import {
  cloudConfigured,
  prepareUpload,
  uploadRecord,
  readCloudRecord,
  removeCloudRecord,
} from "./cloud.mjs";
const $ = (s) => document.querySelector(s),
  defaults = {
    largeText: false,
    voice: false,
    haptic: true,
    estimate: false,
    heightM: 1.2,
    heightErrorM: 0.05,
    angleErrorDeg: 1,
    angleOffset: 0,
    debug: false,
  };
let settings = { ...defaults };
try {
  settings = {
    ...defaults,
    ...JSON.parse(localStorage.getItem("pc-settings") || "{}"),
  };
} catch {}
let records = [],
  stream = null,
  watch = null,
  position = null,
  imu = null,
  cameraFacing = null,
  active = false,
  generation = 0,
  uploadId = null,
  cloudBusyId = null,
  noticeTimer;
const sessionId = crypto.randomUUID();
function notice(message) {
  $("#notice").textContent = message;
  $("#notice").classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => $("#notice").classList.remove("visible"),
    5500,
  );
  if (settings.voice && "speechSynthesis" in window) {
    speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(message);
    speech.lang = "ko-KR";
    speech.rate = 0.9;
    speechSynthesis.speak(speech);
  }
}
function view(name) {
  if (name === "debug" && !settings.debug) {
    notice("설정에서 디버그 화면을 켜 주세요.");
    return;
  }
  document
    .querySelectorAll(".view")
    .forEach((el) => (el.hidden = el.id !== name));
  document
    .querySelectorAll("[data-view]")
    .forEach((el) => el.classList.toggle("active", el.dataset.view === name));
  if (name !== "capture" && name !== "debug") stop();
  window.scrollTo(0, 0);
  if (name === "records") renderRecords();
  telemetry();
}
document
  .querySelectorAll("[data-view]")
  .forEach(
    (b) =>
      (b.onclick = () =>
        b.dataset.view === "capture" ? start() : view(b.dataset.view)),
  );
$(".brand").onclick = (e) => {
  e.preventDefault();
  view("home");
};
$("#start").onclick = start;
$("#stop").onclick = () => {
  stop();
  view("records");
};
$("#debug-capture").onclick = async () => {
  await start();
  view("debug");
};
for (let i = 1; i <= 36; i++)
  $("#hole").add(new Option(i + "번 홀", String(i)));
try {
  $("#course").value = localStorage.getItem("pc-course") || "";
} catch {}
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
  telemetry();
});
async function start() {
  view("capture");
  if (active) return;
  active = true;
  const current = ++generation;
  position = null;
  imu = null;
  $("#placeholder").hidden = false;
  $("#placeholder").textContent = "카메라를 준비하고 있어요";
  $("#cam-status").textContent = "카메라 준비 중";
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
        $("#imu-status").textContent = "기울기 사용 안 함";
    })
    .catch(() => {
      $("#imu-status").textContent = "기울기 권한 없음";
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
        $("#gps-status").textContent = "GPS 없음 · 사진 기록 가능";
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("unavailable");
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
    $("#cam-status").textContent = "카메라 연결됨";
    $("#shoot").disabled = false;
    notice("바닥이 잘 보이도록 멈춰서 찍어 주세요.");
  } catch {
    if (current !== generation) return;
    $("#placeholder").textContent =
      "카메라 권한을 확인하거나 아래 기본 카메라를 이용해 주세요.";
    $("#cam-status").textContent = "카메라 연결 안 됨";
  }
  telemetry();
}
function stop() {
  active = false;
  ++generation;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (watch !== null) navigator.geolocation.clearWatch(watch);
  watch = null;
  $("#shoot").disabled = true;
  $("#video").srcObject = null;
  $("#cam-status").textContent = "카메라 중지됨";
  $("#placeholder").hidden = false;
  $("#placeholder").textContent =
    "촬영 메뉴를 다시 눌러 카메라를 시작해 주세요.";
  $("#gps-status").textContent = "GPS 중지됨";
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});
window.addEventListener("pagehide", stop);
function estimate() {
  if (!settings.estimate)
    return { valid: false, reason: "설정에서 평지 거리 추정을 켤 수 있어요." };
  if (cameraFacing !== "environment")
    return {
      valid: false,
      reason: "후면 카메라가 확인되지 않아 거리를 표시하지 않아요.",
    };
  if (!active || !imu || Date.now() - imu.timestamp > 1500)
    return { valid: false, reason: "기울기 값이 없거나 오래됐어요." };
  return estimateFlatDistance({
    heightM: settings.heightM,
    heightErrorM: settings.heightErrorM,
    angleDeg: imu.angleDeg + settings.angleOffset,
    angleErrorDeg: settings.angleErrorDeg,
    maxDistanceM: 15,
  });
}
function telemetry() {
  const result = estimate();
  $("#distance").textContent = result.valid
    ? result.distanceM.toFixed(1) + " m"
    : "—";
  $("#distance-note").textContent = result.valid
    ? "가정 범위 " +
      result.minM.toFixed(1) +
      "–" +
      result.maxM.toFixed(1) +
      " m · 실제 정확도 보장 아님"
    : result.reason;
  if (position)
    $("#gps-status").textContent =
      Date.now() - position.timestamp < 30000
        ? "GPS 오차 약 " + Math.round(position.accuracy) + "m"
        : "GPS 오래됨";
  if (imu)
    $("#imu-status").textContent =
      active && Date.now() - imu.timestamp < 1500
        ? "기울기 연결됨"
        : "기울기 오래됨";
  $("#debug-data").textContent = JSON.stringify(
    {
      app: "2.0.0",
      sessionId,
      captureActive: active,
      cameraFacing,
      orientation: imu,
      position,
      gpsAgeMs: position ? Date.now() - position.timestamp : null,
      settings,
      estimate: result,
      terrain: {
        measured: false,
        reason: "웹 사진에는 metric depth·pose·공통 기준점이 없습니다.",
      },
      cloud: {
        configured: cloudConfigured,
        pending: records.filter((r) => r.cloudStatus !== "uploaded").length,
      },
      formula:
        "d=h*cot(alpha); min=(h-eh)*cot(alpha+ea), max=(h+eh)*cot(alpha-ea)",
      guarantee: "평지 모델 및 가정 입력 상한 내 범위. 실제 정확도 인증 아님.",
    },
    null,
    2,
  );
}
setInterval(() => {
  if (active || !$("#debug").hidden) telemetry();
}, 1000);
async function compress(source) {
  const w = source.videoWidth || source.naturalWidth || source.width,
    h = source.videoHeight || source.naturalHeight || source.height;
  if (!w || !h) throw new Error("사진을 읽을 수 없어요.");
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
    throw new Error("사진이 너무 커요. 다시 촬영해 주세요.");
  return { data, width: canvas.width, height: canvas.height };
}
async function capture(source, fromFile = false) {
  const course = $("#course").value.trim();
  if (!course) {
    notice("구장 이름을 먼저 적어 주세요.");
    $("#course").focus();
    return;
  }
  $("#shoot").disabled = true;
  try {
    const at = Date.now(),
      gps =
        position && at - position.timestamp < 30000
          ? structuredClone(position)
          : null,
      orientation =
        !fromFile && imu && at - imu.timestamp < 1500
          ? structuredClone(imu)
          : null,
      result = !fromFile
        ? estimate()
        : {
            valid: false,
            reason: "사진 촬영 시각에 동기화된 센서가 없습니다.",
          },
      image = await compress(source);
    const record = {
      id: crypto.randomUUID(),
      sessionId,
      createdAt: new Date(at).toISOString(),
      course,
      hole: Number($("#hole").value),
      surface: $("#surface").value,
      image: image.data,
      imageWidth: image.width,
      imageHeight: image.height,
      source: fromFile ? "camera-file" : "live-camera",
      gps: fromFile ? null : gps,
      orientation,
      estimate: result,
      settings: structuredClone(settings),
      terrainMeasured: false,
      cloudStatus: "local",
      device: navigator.userAgent.slice(0, 250),
      algorithmVersion: "flat-interval-v1",
      photoPurpose: "surface-history-not-metric-reconstruction",
    };
    await saveRecord(record);
    await refresh();
    try {
      localStorage.setItem("pc-course", course);
    } catch {}
    if (settings.haptic) navigator.vibrate?.(70);
    notice("휴대폰에 저장했어요. 내 기록에서 전송할 수 있어요.");
  } catch (e) {
    notice(
      e.name === "QuotaExceededError"
        ? "저장 공간이 부족해요. 기록을 내보낸 후 정리해 주세요."
        : e.message,
    );
  } finally {
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
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function cloudOwned(r) {
  return (
    Boolean(r.ownerUid) ||
    ["pending", "uncertain", "uploaded", "delete-pending"].includes(
      r.cloudStatus,
    )
  );
}
async function latestRecord(id) {
  const r = (await listRecords()).find((item) => item.id === id);
  if (!r) throw new Error("이 기기에서 기록을 찾을 수 없어요.");
  return r;
}
async function withRecordLock(id, action) {
  if (navigator.locks?.request)
    return navigator.locks.request(
      "parkcaddy-record-" + id,
      { ifAvailable: true },
      (lock) => {
        if (!lock)
          throw new Error(
            "다른 창에서 이 기록을 처리 중이에요. 잠시 후 다시 해 주세요.",
          );
        return action();
      },
    );
  return action();
}
async function runCloud(id, action) {
  if (cloudBusyId)
    throw new Error("다른 서버 작업이 진행 중이에요. 완료 후 다시 해 주세요.");
  cloudBusyId = id;
  renderHome();
  renderRecords();
  try {
    return await withRecordLock(id, async () => action(await latestRecord(id)));
  } finally {
    cloudBusyId = null;
    await refresh();
    telemetry();
  }
}
async function checkRemote(id) {
  try {
    await runCloud(id, async (r) => {
      const exists = await readCloudRecord(r);
      // Keep the deletion handle even after an absent lookup of an uncertain write.
      await saveRecord({
        ...r,
        cloudStatus:
          r.cloudStatus === "delete-pending"
            ? "delete-pending"
            : exists
              ? "uploaded"
              : "uncertain",
      });
      notice(
        exists
          ? "서버에 기록이 있어요."
          : "현재 서버에 기록이 없어요. 다시 전송하거나 서버 삭제로 정리할 수 있어요.",
      );
    });
  } catch (e) {
    notice("서버 상태를 확인하지 못했어요. " + (e.code || e.message));
  }
}
async function deleteRemote(id) {
  if (!confirm("서버 사진과 위치 정보를 삭제할까요? 기기 기록은 유지됩니다."))
    return;
  try {
    await runCloud(id, async (r) => {
      const deleting = { ...r, cloudStatus: "delete-pending" };
      await saveRecord(deleting);
      await refresh();
      await removeCloudRecord(deleting);
      const local = { ...deleting, cloudStatus: "local" };
      delete local.ownerUid;
      await saveRecord(local);
      notice("서버 기록을 삭제했어요.");
    });
  } catch (e) {
    notice(
      "서버 삭제 완료를 확인하지 못했어요. 다시 서버 삭제를 눌러 주세요. " +
        (e.code || e.message),
    );
  }
}
function card(r) {
  const article = el("article", undefined, "record"),
    img = el("img");
  img.src = r.image;
  img.alt = r.course + " " + r.hole + "번 홀 지면 사진";
  img.loading = "lazy";
  article.append(img);
  const body = el("div", undefined, "record-body");
  const label =
    cloudBusyId === r.id
      ? "서버 작업 중 · 상태 보존"
      : r.cloudStatus === "uploaded"
        ? "서버 수집됨 · 미검수"
        : r.cloudStatus === "delete-pending"
          ? "서버 삭제 확인 필요"
          : cloudOwned(r)
            ? "서버 전송 확인 필요"
            : "이 기기에 저장됨";
  body.append(
    el("span", label, "badge"),
    el("h3", r.course + " · " + r.hole + "번 홀"),
    el("p", new Date(r.createdAt).toLocaleString("ko-KR")),
    el(
      "p",
      r.gps
        ? "위치 오차 약 " + Math.round(r.gps.accuracy) + "m · 높낮이 미측정"
        : "위치 없음 · 높낮이 미측정",
    ),
  );
  const actions = el("div", undefined, "record-actions");
  if (r.cloudStatus !== "uploaded" && r.cloudStatus !== "delete-pending") {
    const up = el(
      "button",
      cloudOwned(r) ? "같은 기록 다시 전송" : "서버에 전송",
      "secondary",
    );
    up.disabled = Boolean(cloudBusyId);
    up.onclick = () => {
      if (cloudBusyId) {
        notice("서버 작업을 마친 뒤 다시 해 주세요.");
        return;
      }
      uploadId = r.id;
      $("#consent").showModal();
    };
    actions.append(up);
  }
  if (cloudOwned(r)) {
    const check = el("button", "서버 상태 확인", "secondary");
    check.disabled = Boolean(cloudBusyId);
    check.onclick = () => checkRemote(r.id);
    const remove = el(
      "button",
      r.cloudStatus === "delete-pending"
        ? "서버 삭제 다시 시도"
        : "서버 기록 삭제",
      "secondary",
    );
    remove.disabled = Boolean(cloudBusyId);
    remove.onclick = () => deleteRemote(r.id);
    actions.append(check, remove);
  }
  const exp = el("button", "내보내기", "secondary");
  exp.onclick = () => download(r, "parkcaddy-" + r.id + ".json");
  const del = el("button", "기기 삭제", "text-button");
  del.disabled = cloudOwned(r) || cloudBusyId === r.id;
  if (cloudOwned(r))
    del.title = "서버 기록 삭제가 완료된 후 기기 기록을 삭제할 수 있어요.";
  del.onclick = async () => {
    if (cloudBusyId === r.id) {
      notice("서버 작업이 끝난 뒤 삭제해 주세요.");
      return;
    }
    if (!confirm("이 기기의 사진 기록을 삭제할까요?")) return;
    try {
      await withRecordLock(r.id, async () => {
        const current = await latestRecord(r.id);
        if (cloudOwned(current))
          throw new Error(
            "서버 기록을 먼저 삭제한 후 기기 기록을 지워 주세요.",
          );
        await deleteRecord(r.id);
      });
      await refresh();
      notice("기기 기록을 삭제했어요.");
    } catch (e) {
      notice(e.message);
    }
  };
  actions.append(exp, del);
  body.append(actions);
  article.append(body);
  return article;
}

function renderHome() {
  const list = $("#recent");
  list.replaceChildren();
  list.className = records.length ? "record-grid" : "empty";
  if (!records.length)
    list.textContent = "아직 기록이 없어요. 첫 그라운드를 남겨 보세요.";
  records.slice(0, 3).forEach((r) => list.append(card(r)));
}
function renderRecords() {
  const list = $("#records-list");
  list.replaceChildren();
  list.className = records.length ? "record-grid" : "empty";
  if (!records.length) list.textContent = "저장한 기록이 아직 없어요.";
  records.forEach((r) => list.append(card(r)));
  $("#cloud-state").textContent = cloudConfigured
    ? "서버 설정됨 · 동의 후 전송"
    : "서버 준비 중 · 기기 저장과 내보내기 가능";
}
async function refresh() {
  records = await listRecords();
  renderHome();
  renderRecords();
}
function download(data, name) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#export-all").onclick = () =>
  download(
    { schemaVersion: 2, exportedAt: new Date().toISOString(), records },
    "parkcaddy-ground-records.json",
  );
$("#consent-close").setAttribute("aria-label", "전송창 닫기");
$("#consent-close").onclick = () => {
  if (cloudBusyId)
    notice("서버 작업은 계속돼요. 내 기록에서 완료 여부를 확인해 주세요.");
  $("#consent").close();
};
$("#consent").addEventListener("cancel", () => {
  if (cloudBusyId)
    notice("서버 작업은 계속돼요. 내 기록에서 완료 여부를 확인해 주세요.");
});
$("#upload").onclick = async () => {
  const id = uploadId;
  if (!id || cloudBusyId) return;
  $("#upload").disabled = true;
  try {
    await runCloud(id, async (r) => {
      const uid = await prepareUpload(r);
      const queued = { ...r, ownerUid: uid, cloudStatus: "pending" };
      // Commit before any photo/location write can reach the server.
      await saveRecord(queued);
      await refresh();
      try {
        await uploadRecord(queued);
        await saveRecord({ ...queued, cloudStatus: "uploaded" });
      } catch (e) {
        // A missing acknowledgement is not evidence that the server has no data.
        await saveRecord({ ...queued, cloudStatus: "uncertain" }).catch(
          () => {},
        );
        throw new Error(
          "서버 저장 완료를 확인하지 못했어요. 내 기록에서 상태 확인·다시 전송·서버 삭제를 할 수 있어요. " +
            (e.code || e.message),
        );
      }
    });
    if (uploadId === id) $("#consent").close();
    notice("서버에 저장했어요. 지형 계산은 아직 수행되지 않았어요.");
  } catch (e) {
    notice(e.message);
  } finally {
    $("#upload").disabled = false;
  }
};

function apply() {
  document.documentElement.classList.toggle("large-text", settings.largeText);
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
  $("#settings").showModal();
};
$("#settings-close").onclick = () => $("#settings").close();
function readSettings() {
  const form = $("#settings-form"),
    next = {};
  for (const name of Object.keys(defaults)) {
    const input = form.elements.namedItem(name);
    next[name] =
      input.type === "checkbox" ? input.checked : Number(input.value);
  }
  if (next.heightErrorM >= next.heightM)
    throw new Error("높이 오차는 카메라 높이보다 작아야 해요.");
  return next;
}
$("#settings-form").onsubmit = (e) => {
  e.preventDefault();
  try {
    const next = readSettings();
    localStorage.setItem("pc-settings", JSON.stringify(next));
    settings = next;
    apply();
    $("#settings").close();
    notice("설정을 저장했어요.");
  } catch (e) {
    notice(e.message);
  }
};
$("#show-debug").onclick = () => {
  if (!$("#settings-form").elements.debug.checked) {
    notice("디버그 화면 사용을 먼저 켜 주세요.");
    return;
  }
  settings.debug = true;
  $("#settings").close();
  view("debug");
};
apply();
refresh().catch(() =>
  notice("기기 저장소를 사용할 수 없어요. 브라우저 저장 권한을 확인해 주세요."),
);
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
