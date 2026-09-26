import { saveRecord, listRecords, deleteRecord } from "./storage.mjs";
import {
  cloudConfigured,
  prepareUpload,
  uploadRecord,
  removeCloudRecord,
} from "./cloud.mjs";
import { createCollector, COLLECTION_CONSENT_VERSION } from "./collection.mjs";
import { connectScorecard } from "./embed.mjs";
import { detectTerrainSupport, createTerrainScanner } from "./webxr-scan.mjs";
const $ = (s) => document.querySelector(s);
const defaults = {
  largeText: false,
  voice: false,
  haptic: true,
  grid: true,
  minCameraHeightM: 0.4,
  maxCameraHeightM: 2.3,
  maxRangeM: 3,
};
let settings = { ...defaults };
try {
  const stored = JSON.parse(localStorage.getItem("pc-settings") || "{}");
  for (const key of Object.keys(defaults))
    if (typeof stored[key] === typeof defaults[key])
      settings[key] = stored[key];
} catch {}
if (
  settings.minCameraHeightM < 0.3 ||
  settings.maxCameraHeightM > 2.5 ||
  settings.minCameraHeightM >= settings.maxCameraHeightM
)
  Object.assign(settings, { minCameraHeightM: 0.4, maxCameraHeightM: 2.3 });
if (![3, 5].includes(settings.maxRangeM)) settings.maxRangeM = 3;
let state = {
    phase: "checking",
    message: "지원 여부를 확인하고 있어요",
    progress: null,
  },
  measurement = null,
  renderFrame = null,
  position = null,
  watch = null,
  noticeTimer;
let lastStateRenderAt = -Infinity,
  lastDiagnosticsAt = -Infinity;
let lastCollectedAt = 0,
  lastCollectedSession = null,
  collecting = false,
  lastAnnouncedAt = 0,
  announcedReady = false,
  terminalFailure = null;
const readConsent = () => {
  try {
    return JSON.parse(localStorage.getItem("pc-collection-consent") || "null");
  } catch {
    return null;
  }
};
const collector = createCollector({
  store: { list: listRecords, save: saveRecord, delete: deleteRecord },
  cloud: { prepareUpload, uploadRecord, removeCloudRecord },
  consent: {
    get: readConsent,
    set: (v) =>
      localStorage.setItem("pc-collection-consent", JSON.stringify(v)),
  },
  lock: (work) =>
    navigator.locks
      ? navigator.locks.request("parkcaddy-ground-collection", work)
      : work(),
  onChange: () => updatePrivacy(),
});
const scanner = createTerrainScanner({
  overlayRoot: document.body,
  getLimits: () => ({
    minCameraHeightM: settings.minCameraHeightM,
    maxCameraHeightM: settings.maxCameraHeightM,
    maxRangeM: settings.maxRangeM,
  }),
  onState: (next) => updateScan(next),
  onMeasurement: (value) => {
    measurement = value;
    renderReadouts();
    renderDiagnostics();
    if (value) {
      if (!announcedReady) {
        announcedReady = true;
        if (settings.haptic) navigator.vibrate?.(60);
      }
      void collectMeasurement(value);
    }
  },
  onRender: (frame) => {
    renderFrame = frame;
    drawTerrain();
    renderDiagnostics();
  },
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
const bridge = connectScorecard((c) => {
  $("#course").value = c.course;
  $("#hole").value = c.hole || "";
  updateContext();
});
function updateContext() {
  $("#context-label").textContent =
    ($("#course").value.trim() || "구장 미지정") +
    ($("#hole").value ? " · " + $("#hole").value + "번 홀" : " · 홀 미지정");
}
function notice(text) {
  (document.querySelector("dialog[open]") || document.body).append(
    $("#notice"),
  );
  $("#notice").textContent = text;
  $("#notice").classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => $("#notice").classList.remove("visible"),
    5000,
  );
}
const livePhases = new Set([
  "starting",
  "reference",
  "scanning",
  "ready",
  "tracking-lost",
]);
function updateScan(next) {
  if (next.phase === "unsupported" || next.phase === "error")
    terminalFailure = next;
  if (next.phase === "stopped" && terminalFailure) next = terminalFailure;
  const changed = state.phase !== next.phase;
  state = { ...next };
  const now = performance.now();
  if (!changed && now - lastStateRenderAt < 200) return;
  lastStateRenderAt = now;
  const running = livePhases.has(state.phase),
    unsupported = state.phase === "unsupported";
  document.documentElement.classList.toggle(
    "xr-running",
    running && state.phase !== "starting",
  );
  $("#placeholder").hidden = running || unsupported;
  $("#support-panel").hidden = !unsupported;
  if (unsupported)
    $("#support-message").textContent =
      state.message ||
      "이 브라우저에서 지면 깊이 데이터를 제공하지 않습니다. 지원되는 Android에서 측정 앱을 사용해 주세요.";
  $("#scan-phase").textContent =
    state.message ||
    {
      ready: "관측한 지면을 표시하고 있어요",
      reference: "기준 지면을 찾고 있어요",
      scanning: "지면을 반복 관측하고 있어요",
      "tracking-lost": "카메라 위치를 다시 확인하고 있어요",
      starting: "AR 카메라를 준비하고 있어요",
      stopped: "스캔이 종료되었습니다",
    }[state.phase] ||
    "스캔을 시작해 주세요";
  $("#start").hidden = running || unsupported;
  $("#start").disabled = state.phase === "checking";
  $("#start").textContent =
    state.phase === "error" ? "스캔 다시 시작" : "스캔 시작";
  const progress = $("#scan-progress");
  progress.hidden =
    !running ||
    state.phase === "ready" ||
    state.phase === "tracking-lost" ||
    state.waitingForAction === true;
  if (Number.isFinite(state.progress)) {
    progress.value = Math.max(0, Math.min(1, state.progress));
  } else progress.removeAttribute("value");
  const cells = state.acceptedCells || 0;
  $("#scan-detail").textContent =
    state.phase === "ready"
      ? cells + "개 관측 격자 · 움직이는 시야를 계속 확인합니다"
      : state.phase === "scanning"
        ? "깊이 관측 " +
          (state.observedFrames || 0) +
          "회 · 통과 " +
          cells +
          "개 · 이동 " +
          ((state.baselineM || 0) * 100).toFixed(0) +
          " / " +
          ((state.requiredBaselineM || 0.08) * 100).toFixed(0) +
          " cm"
        : unsupported
          ? "측정되지 않은 높이와 그리드는 표시하지 않습니다."
          : state.phase === "reference"
            ? "지면이 보이도록 휴대폰을 천천히 조금 움직여 주세요."
            : "";
  $(".reticle").hidden = !running || state.phase === "starting";
  if (!running || state.phase === "tracking-lost") {
    measurement = null;
    renderFrame = null;
    drawTerrain();
    renderReadouts();
    if (!running) stopGPS();
  }
  if (
    changed &&
    running &&
    settings.voice &&
    Date.now() - lastAnnouncedAt > 8000 &&
    "speechSynthesis" in window
  ) {
    lastAnnouncedAt = Date.now();
    const speech = new SpeechSynthesisUtterance($("#scan-phase").textContent);
    speech.lang = "ko-KR";
    speech.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(speech);
  }
  renderDiagnostics();
}
function renderReadouts() {
  const usable =
    measurement &&
    Number.isFinite(measurement.distanceM) &&
    Number.isFinite(measurement.elevationM) &&
    livePhases.has(state.phase) &&
    state.phase !== "tracking-lost";
  $("#readouts").hidden = !usable;
  $("#height-output").textContent = usable
    ? (measurement.elevationM >= 0 ? "+" : "−") +
      Math.abs(measurement.elevationM * 100).toFixed(1) +
      " cm"
    : "—";
  $("#distance").textContent = usable
    ? measurement.distanceM.toFixed(2) + " m"
    : "—";
  $("#distance-quality").textContent = usable ? "반복 관측 통과" : "관측 대기";
}
function drawTerrain() {
  const canvas = $("#terrain-overlay"),
    rect = canvas.getBoundingClientRect(),
    dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr)),
    height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!settings.grid || !renderFrame?.tracking) return;
  const points = renderFrame.points.filter(
    (p) =>
      Number.isFinite(p.screenX) &&
      Number.isFinite(p.screenY) &&
      p.screenX >= 0 &&
      p.screenX <= 1 &&
      p.screenY >= 0 &&
      p.screenY <= 1,
  );
  const byId = new Map(points.map((p) => [p.id, p]));
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(183,248,199,.85)";
  for (const line of renderFrame.segments || []) {
    const a = byId.get(line.from),
      b = byId.get(line.to);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.screenX * rect.width, a.screenY * rect.height);
    ctx.lineTo(b.screenX * rect.width, b.screenY * rect.height);
    ctx.stroke();
  }
  for (const point of points) {
    ctx.fillStyle =
      point.elevationM > 0.02
        ? "#ffa69d"
        : point.elevationM < -0.02
          ? "#9fe4ff"
          : "#c1f4c5";
    ctx.beginPath();
    ctx.arc(
      point.screenX * rect.width,
      point.screenY * rect.height,
      3.4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  const occupied = [];
  ctx.font = (settings.largeText ? 15 : 13) + "px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let count = 0;
  for (const p of [...points].sort(
    (a, b) =>
      Math.hypot(a.screenX - 0.5, a.screenY - 0.5) -
      Math.hypot(b.screenX - 0.5, b.screenY - 0.5),
  )) {
    if (count >= 12 || p.screenY < 0.24 || p.screenY > 0.75) continue;
    const x = p.screenX * rect.width,
      y = p.screenY * rect.height - 26;
    if (
      x < 46 ||
      x > rect.width - 46 ||
      occupied.some((q) => Math.abs(q.x - x) < 88 && Math.abs(q.y - y) < 44)
    )
      continue;
    occupied.push({ x, y });
    count++;
    ctx.fillStyle = "rgba(7,27,18,.9)";
    ctx.fillRect(x - 41, y - 17, 82, 36);
    ctx.fillStyle =
      p.elevationM > 0.02
        ? "#ffbab1"
        : p.elevationM < -0.02
          ? "#b6edff"
          : "#dcf5d7";
    ctx.fillText(
      (p.elevationM >= 0 ? "+" : "") + (p.elevationM * 100).toFixed(1) + " cm",
      x,
      y - 6,
    );
    ctx.fillStyle = "#f3faf2";
    ctx.fillText(p.rangeM.toFixed(2) + " m", x, y + 10);
  }
}
function diagnostics() {
  return {
    app: "2.2.0",
    scan: state,
    measurement,
    reference: renderFrame?.reference || null,
    frameTimestamp: renderFrame?.frameTimestamp || null,
    sessionId: renderFrame?.sessionId || null,
    position,
    settings,
    terrainMeasured: Boolean(measurement),
    absoluteAccuracyValidated: false,
    source: "webxr-cpu-depth",
    gridSpacingM: 0.25,
    formula:
      "world = cameraPose * inverseProjection(depth); relativeHeight = world.y - reference.y; horizontalDistance = hypot(dx,dz)",
    note: "반복 관측의 안정성과 절대 정확도는 다릅니다. 진행률은 정확도 확률이 아닙니다.",
  };
}
function renderDiagnostics(force = false) {
  const now = performance.now();
  if (!force && now - lastDiagnosticsAt < 250) return;
  lastDiagnosticsAt = now;
  $("#scan-state-data").textContent = state.phase;
  $("#frame-data").textContent = (state.observedFrames || 0) + "개";
  $("#sample-data").textContent =
    "지점당 " +
    (measurement?.observationCount || 0) +
    " / " +
    (state.requiredFrames || 7) +
    "회";
  $("#baseline-data").textContent =
    ((state.baselineM || 0) * 100).toFixed(1) +
    " / " +
    ((state.requiredBaselineM || 0.08) * 100).toFixed(0) +
    " cm";
  $("#cell-data").textContent = (state.acceptedCells || 0) + "개";
  $("#spread-data").textContent = Number.isFinite(measurement?.medianMadM)
    ? (measurement.medianMadM * 100).toFixed(2) + " cm"
    : "—";
  $("#camera-height-data").textContent = Number.isFinite(
    measurement?.cameraHeightM,
  )
    ? measurement.cameraHeightM.toFixed(2) + " m"
    : "—";
  $("#gps-status").textContent =
    position &&
    Date.now() - position.timestamp >= 0 &&
    Date.now() - position.timestamp < 30000
      ? "수평 ±" + Math.round(position.accuracy) + " m"
      : watch !== null
        ? "수신 대기"
        : "미수집";
  if ($("#settings").open)
    $("#debug-data").textContent = JSON.stringify(diagnostics(), null, 2);
}
function allowCollection() {
  const c = collector.getConsent();
  return c?.state === "accepted" && c.version === COLLECTION_CONSENT_VERSION;
}
function startGPS() {
  if (!allowCollection() || watch !== null || !navigator.geolocation) return;
  watch = navigator.geolocation.watchPosition(
    (p) => {
      position = {
        latitude: p.coords.latitude,
        longitude: p.coords.longitude,
        accuracy: p.coords.accuracy,
        altitude: p.coords.altitude,
        altitudeAccuracy: p.coords.altitudeAccuracy,
        timestamp: p.timestamp,
      };
      renderDiagnostics();
    },
    () => {
      position = null;
      renderDiagnostics();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
}
function stopGPS() {
  if (watch !== null) navigator.geolocation?.clearWatch(watch);
  watch = null;
  position = null;
}
async function collectMeasurement(value) {
  const now = Date.now();
  if (
    !allowCollection() ||
    collecting ||
    now - lastCollectedAt < 30000 ||
    !renderFrame?.tracking ||
    !renderFrame.points.length
  )
    return;
  if (
    value.sessionId &&
    renderFrame.sessionId &&
    value.sessionId !== renderFrame.sessionId
  )
    return;
  collecting = true;
  lastCollectedAt = now;
  lastCollectedSession = value.sessionId || renderFrame.sessionId;
  try {
    const record = {
      id: crypto.randomUUID(),
      createdAt: new Date(now).toISOString(),
      sessionId: lastCollectedSession,
      source: "webxr-depth",
      course: $("#course").value.trim(),
      hole: $("#hole").value ? Number($("#hole").value) : null,
      cloudStatus: "local",
      terrainMeasured: true,
      accuracyValidated: false,
      device: navigator.userAgent.slice(0, 250),
      measurement: structuredClone(value),
      reference: structuredClone(renderFrame.reference || null),
      points: renderFrame.points
        .slice(0, 24)
        .map((p) => ({
          worldX: p.worldX,
          worldY: p.worldY,
          worldZ: p.worldZ,
          elevationM: p.elevationM,
          rangeM: p.rangeM,
          madM: p.madM,
          samples: p.samples,
          gridX: p.gridX,
          gridZ: p.gridZ,
        })),
      gps:
        position &&
        now - position.timestamp >= 0 &&
        now - position.timestamp < 30000
          ? structuredClone(position)
          : null,
      settings: structuredClone(settings),
    };
    await collector.queueRecord(record);
    bridge.send("parkcaddy:measured");
  } catch {
    /* A collection failure must not block the camera or claim success. */
  } finally {
    collecting = false;
  }
}
$("#start").onclick = async () => {
  terminalFailure = null;
  announcedReady = false;
  try {
    const opening = scanner.start();
    startGPS();
    await opening;
  } catch (e) {
    updateScan({
      phase: e.name === "NotSupportedError" ? "unsupported" : "error",
      message:
        e.name === "NotAllowedError"
          ? "카메라·AR 사용을 허용한 뒤 다시 시작해 주세요."
          : "이 환경에서 깊이 스캔을 시작하지 못했습니다. " + (e.message || ""),
    });
  }
};
$("#stop").onclick = () => {
  terminalFailure = null;
  void scanner.end();
  stopGPS();
  if (!bridge.close())
    updateScan({ phase: "stopped", message: "스캔이 종료되었습니다" });
};
$("#reset-scan").onclick = () => {
  measurement = null;
  renderFrame = null;
  announcedReady = false;
  scanner.reset();
  drawTerrain();
  renderReadouts();
  $("#settings").close();
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    void scanner.end();
    stopGPS();
  } else collector.syncPending().catch(() => {});
});
window.addEventListener("pagehide", () => {
  void scanner.end();
  stopGPS();
});
window.addEventListener("resize", drawTerrain);
window.addEventListener("online", () =>
  collector.syncPending({ forceRetry: true }).catch(() => {}),
);
setInterval(() => {
  if (scanner.active) collector.syncPending().catch(() => {});
}, 30000);
function apply() {
  document.documentElement.classList.toggle("large-text", settings.largeText);
  drawTerrain();
  renderDiagnostics();
}
$("#settings-open").onclick = () => {
  for (const name of Object.keys(defaults)) {
    const input = $("#settings-form").elements.namedItem(name);
    input.type === "checkbox"
      ? (input.checked = settings[name])
      : (input.value = settings[name]);
  }
  updatePrivacy();
  $("#settings").showModal();
  renderDiagnostics(true);
};
$("#settings-close").onclick = () => $("#settings").close();
$("#settings-form").onsubmit = (e) => {
  e.preventDefault();
  try {
    const next = {};
    for (const [name, value] of Object.entries(defaults)) {
      const input = $("#settings-form").elements.namedItem(name);
      next[name] =
        typeof value === "boolean" ? input.checked : Number(input.value);
    }
    if (next.minCameraHeightM >= next.maxCameraHeightM)
      throw Error("최소 높이는 최대 높이보다 작아야 해요.");
    const reset =
      next.minCameraHeightM !== settings.minCameraHeightM ||
      next.maxCameraHeightM !== settings.maxCameraHeightM ||
      next.maxRangeM !== settings.maxRangeM;
    localStorage.setItem("pc-settings", JSON.stringify(next));
    settings = next;
    localStorage.setItem(
      "pc-context",
      JSON.stringify({
        course: $("#course").value.trim(),
        hole: $("#hole").value ? Number($("#hole").value) : null,
      }),
    );
    if (reset) {
      measurement = null;
      renderFrame = null;
      announcedReady = false;
      scanner.reset();
      renderReadouts();
    }
    updateContext();
    apply();
    $("#settings").close();
    notice("설정을 저장했어요.");
  } catch (e) {
    notice(e.message);
  }
};
function updatePrivacy() {
  let c;
  try {
    c = collector.getConsent();
  } catch {}
  const s = c?.version === COLLECTION_CONSENT_VERSION ? c.state : null;
  $("#collection-state").textContent =
    s === "accepted"
      ? "데이터 제공에 동의한 상태입니다."
      : s === "revoked"
        ? "데이터 제공을 중지했습니다."
        : s === "declined"
          ? "데이터를 제공하지 않습니다."
          : "데이터 제공 여부를 선택하지 않았습니다.";
  $("#collection-revoke").disabled = s !== "accepted";
  $("#collection-detail").textContent = cloudConfigured
    ? "앱을 닫으면 전송이 멈출 수 있습니다. 다음 실행 시 동의를 확인한 뒤 대기 자료를 처리합니다."
    : "서버 연결을 준비 중입니다.";
  if (s !== "accepted") stopGPS();
  else if (scanner.active) startGPS();
}
$("#collection-enable").onclick = () => $("#consent").showModal();
$("#consent-accept").onclick = () => {
  try {
    collector.acceptConsent();
    $("#consent").close();
    updatePrivacy();
  } catch (e) {
    notice(e.message);
  }
};
$("#consent-decline").onclick = () => {
  try {
    collector.declineConsent();
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
  try {
    await collector.revokeConsent();
    updatePrivacy();
    notice("앞으로 데이터를 제공하지 않아요.");
  } catch {
    notice("설정을 저장하지 못했어요.");
  }
};
$("#collection-delete").onclick = async () => {
  if (
    !confirm(
      "데이터 제공을 중지하고 이 기기에서 제공한 서버 데이터를 삭제할까요?",
    )
  )
    return;
  const b = $("#collection-delete");
  b.disabled = true;
  try {
    await collector.revokeConsent({ deleteExisting: true });
    updatePrivacy();
    const left = (await listRecords()).filter(
      (r) => r.ownerUid || r.cloudStatus === "delete-pending",
    );
    notice(
      left.length
        ? "삭제 완료를 확인하지 못했어요. 연결 후 다시 삭제해 주세요."
        : "서버 데이터를 삭제했어요.",
    );
  } catch {
    notice("삭제 완료를 확인하지 못했어요. 연결 후 다시 시도해 주세요.");
  } finally {
    b.disabled = false;
  }
};
$("#export-diagnostics").onclick = () => {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(diagnostics(), null, 2)], {
        type: "application/json",
      }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "parkcaddy-scan-diagnostics.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener("storage", (e) => {
  if (e.key === "pc-collection-consent") updatePrivacy();
});
updateContext();
apply();
updatePrivacy();
if (
  !collector.getConsent()?.state ||
  collector.getConsent()?.version !== COLLECTION_CONSENT_VERSION
)
  $("#consent").showModal();
collector.syncPending().catch(() => {});
detectTerrainSupport()
  .then((support) => {
    if (!scanner.active && state.phase === "checking")
      updateScan(
        support.supported
          ? { phase: "stopped", message: "지면을 향해 스캔을 시작해 주세요" }
          : { phase: "unsupported", message: support.reason },
      );
  })
  .catch(() =>
    updateScan({
      phase: "unsupported",
      message: "이 브라우저에서 깊이 측정 지원을 확인하지 못했습니다.",
    }),
  );
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
