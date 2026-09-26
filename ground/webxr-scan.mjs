import {
  TerrainAccumulator,
  TERRAIN_DEFAULTS,
  median,
  dispersion,
  invert4,
  unprojectDepth,
  projectWorld,
  horizontalNormal,
} from "./terrain-core.mjs";

const SOURCE = "webxr-depth";
const DEPTH_INTERVAL_MS = 125;
const NO_DEPTH_WARNING_MS = 3500;
const clamp = (v, low, high, fallback) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(high, Math.max(low, v))
    : fallback;

/** This checks immersive AR only; required depth support is confirmed by start. */
export async function detectTerrainSupport() {
  if (!globalThis.isSecureContext)
    return {
      supported: false,
      reason: "HTTPS 연결에서 지면 측정을 열어주세요.",
    };
  if (!globalThis.navigator?.xr?.requestSession)
    return {
      supported: false,
      reason:
        "이 브라우저는 실제 지면 깊이 스캔을 제공하지 않습니다. 지원 Android의 Chrome 또는 네이티브 측정 앱을 사용해주세요.",
    };
  try {
    const supported = await navigator.xr.isSessionSupported("immersive-ar");
    return {
      supported,
      reason: supported
        ? "시작할 때 실제 깊이 센서 지원을 확인합니다."
        : "이 기기·브라우저는 AR 지면 스캔을 지원하지 않습니다.",
      depthConfirmed: false,
    };
  } catch {
    return {
      supported: false,
      reason:
        "브라우저에서 AR 접근이 차단되었습니다. 기기의 AR 지원과 권한을 확인해주세요.",
    };
  }
}

// A digest of the actual buffer rejects native depth re-used at a newer render
// timestamp. It is not a cryptographic ID or proof of independent sensor noise.
function depthFingerprint(info) {
  const bytes = new Uint8Array(info.data);
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 16777619);
    b = Math.imul(b, 33) ^ bytes[i];
  }
  return (
    info.width +
    ":" +
    info.height +
    ":" +
    bytes.length +
    ":" +
    (a >>> 0) +
    ":" +
    (b >>> 0)
  );
}
function xyz(position) {
  return { x: position.x, y: position.y, z: position.z };
}
function publicReference(reference) {
  return reference
    ? {
        worldX: reference.x,
        worldY: reference.y,
        worldZ: reference.z,
        observations: reference.observations,
        madM: reference.madM,
        method: "horizontal-hit-confirmed-repeated-depth",
      }
    : null;
}

/**
 * start MUST be called directly from a user gesture: requestSession is invoked
 * synchronously before any awaited operation. Required features reject instead
 * of presenting a fabricated photo-derived surface on an unsupported browser.
 *
 * onRender points contain normalized DOM screen positions and worldX/Y/Z.
 * segments connect IDs, never interpolated/missing cells. A transparent
 * XRWebGLLayer lets the runtime camera passthrough show behind the DOM overlay.
 */
export function createTerrainScanner({
  overlayRoot = globalThis.document?.body,
  getLimits = () => ({}),
  onState = () => {},
  onMeasurement = () => {},
  onRender = () => {},
} = {}) {
  let session = null,
    pending = null,
    referenceSpace = null,
    hitSource = null;
  let canvas = null,
    gl = null,
    reference = null,
    referenceSamples = [];
  let accumulator = new TerrainAccumulator(),
    lastSampleAt = -Infinity;
  let lastDepthAt = -Infinity,
    lastGoodPoseAt = -Infinity,
    referenceLastId = null;
  let sessionId = null,
    terminalPhase = null,
    generation = 0,
    latest = null;
  let referenceFrameIds = new Set();
  let cachedSnapshot = null,
    lastSnapshotAt = -Infinity,
    missingDepthSince = null;
  let limits = {},
    state = { phase: "stopped", progress: 0 };
  const output = (phase, message, details = {}) => {
    state = {
      phase,
      message,
      progress: 0,
      acceptedCells: 0,
      observedFrames: 0,
      requiredFrames: TERRAIN_DEFAULTS.minSamples,
      baselineM: 0,
      requiredBaselineM: TERRAIN_DEFAULTS.minBaselineM,
      requiredSpanMs: TERRAIN_DEFAULTS.minSpanMs,
      source: SOURCE,
      absoluteAccuracyValidated: false,
      ...details,
    };
    onState(state);
  };
  function clearRender(timestamp = 0) {
    latest = null;
    onMeasurement(null);
    onRender({
      points: [],
      segments: [],
      tracking: false,
      frameTimestamp: timestamp,
      sessionId,
      reference: publicReference(reference),
      gridSpacingM: TERRAIN_DEFAULTS.gridSpacingM,
      width: overlayRoot?.clientWidth || globalThis.innerWidth || 0,
      height: overlayRoot?.clientHeight || globalThis.innerHeight || 0,
    });
  }
  function readLimits() {
    const requested = getLimits() || {};
    const minimum = clamp(requested.minCameraHeightM, 0.3, 2.5, 0.4);
    limits = {
      minCameraHeightM: minimum,
      maxCameraHeightM: Math.max(
        minimum + 0.1,
        clamp(requested.maxCameraHeightM, 0.4, 3, 2.3),
      ),
      maxRangeM: clamp(requested.maxRangeM, 0.5, 5, 5),
    };
  }
  function reset() {
    readLimits();
    reference = null;
    referenceSamples = [];
    referenceLastId = null;
    referenceFrameIds.clear();
    accumulator = new TerrainAccumulator({ maxRangeM: limits.maxRangeM });
    lastSampleAt = -Infinity;
    lastDepthAt = -Infinity;
    lastGoodPoseAt = -Infinity;
    cachedSnapshot = null;
    lastSnapshotAt = -Infinity;
    missingDepthSince = null;
    clearRender();
    if (session)
      output("reference", "지면을 비추고 천천히 좌우로 움직여주세요.");
  }
  function cleanup(endedSession) {
    if (session !== endedSession) return;
    generation++;
    hitSource?.cancel();
    hitSource = null;
    referenceSpace = null;
    session = null;
    canvas?.removeEventListener("webglcontextlost", contextLost);
    canvas = null;
    gl = null;
    reference = null;
    referenceSamples = [];
    accumulator.reset();
    clearRender();
    if (!terminalPhase) output("stopped", "지면 스캔이 종료되었습니다.");
  }
  async function end() {
    generation++;
    const current = session;
    if (current) {
      try {
        await current.end();
      } finally {
        cleanup(current);
      }
    } else {
      clearRender();
      output("stopped", "지면 스캔이 종료되었습니다.");
    }
  }
  function contextLost(event) {
    event.preventDefault();
    terminalPhase = "error";
    output("error", "AR 화면 연결이 끊어졌습니다. 다시 시작해주세요.");
    clearRender();
    void end();
  }
  function start() {
    if (pending) return pending;
    if (session) return Promise.resolve(true);
    if (!globalThis.navigator?.xr?.requestSession || !overlayRoot) {
      output(
        "unsupported",
        "이 브라우저는 실제 지면 깊이 스캔을 지원하지 않습니다. 네이티브 측정 앱에서 이용해주세요.",
      );
      return Promise.resolve(false);
    }
    const token = ++generation;
    terminalPhase = null;
    output("starting", "카메라와 실제 깊이 스캔을 준비하고 있습니다.");
    let request;
    try {
      // Do not await a capability check or camera permission before this call.
      request = navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["local", "hit-test", "depth-sensing", "dom-overlay"],
        domOverlay: { root: overlayRoot },
        depthSensing: {
          usagePreference: ["cpu-optimized"],
          dataFormatPreference: ["float32", "luminance-alpha"],
          matchDepthView: true,
          depthTypeRequest: ["raw"],
        },
      });
    } catch (error) {
      request = Promise.reject(error);
    }
    pending = (async () => {
      try {
        const created = await request;
        if (token !== generation) {
          await created.end();
          return false;
        }
        session = created;
        created.addEventListener("end", () => cleanup(created), { once: true });
        if (
          created.depthUsage !== "cpu-optimized" ||
          !created.domOverlayState
        ) {
          throw new DOMException(
            "Depth/overlay features unavailable",
            "NotSupportedError",
          );
        }
        sessionId = crypto.randomUUID();
        canvas = document.createElement("canvas");
        gl = canvas.getContext("webgl", {
          alpha: true,
          antialias: false,
          preserveDrawingBuffer: false,
        });
        if (!gl || typeof globalThis.XRWebGLLayer !== "function")
          throw new DOMException(
            "XR rendering unavailable",
            "NotSupportedError",
          );
        canvas.addEventListener("webglcontextlost", contextLost);
        await gl.makeXRCompatible();
        if (token !== generation || session !== created) {
          await created.end();
          return false;
        }
        created.updateRenderState({
          baseLayer: new XRWebGLLayer(created, gl, {
            alpha: true,
            depth: false,
            stencil: false,
          }),
          depthNear: 0.05,
          depthFar: 8,
        });
        referenceSpace = await created.requestReferenceSpace("local");
        referenceSpace.addEventListener("reset", reset);
        const viewer = await created.requestReferenceSpace("viewer");
        hitSource = await created.requestHitTestSource({
          space: viewer,
          entityTypes: ["plane"],
        });
        if (token !== generation || session !== created) {
          await created.end();
          return false;
        }
        reset();
        created.addEventListener("visibilitychange", () => {
          if (created.visibilityState !== "visible") {
            reset();
            output(
              "tracking-lost",
              "카메라가 다시 보이면 지면 스캔을 새로 시작합니다.",
            );
          }
        });
        created.requestAnimationFrame(frameLoop);
        return true;
      } catch (error) {
        if (token !== generation) return false;
        const unsupported = error?.name === "NotSupportedError";
        terminalPhase = unsupported ? "unsupported" : "error";
        output(
          terminalPhase,
          unsupported
            ? "이 기기·브라우저는 실제 깊이 스캔을 지원하지 않습니다. AR 깊이 지원 기기에서 측정 앱을 사용해주세요."
            : error?.name === "NotAllowedError" ||
                error?.name === "SecurityError"
              ? "카메라·AR 사용 권한이 필요합니다. 권한을 허용한 뒤 다시 시작해주세요."
              : "AR 지면 스캔을 시작하지 못했습니다. 기기의 AR 서비스를 확인하고 다시 시작해주세요.",
          { errorName: error?.name || "Error" },
        );
        clearRender();
        const current = session;
        if (current) {
          try {
            await current.end();
          } catch {}
          cleanup(current);
        }
        return false;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  function validReference(
    frame,
    depth,
    inverseProjection,
    view,
    camera,
    timestamp,
    fingerprint,
  ) {
    if (fingerprint === referenceLastId || referenceFrameIds.has(fingerprint))
      return;
    referenceFrameIds.add(fingerprint);
    if (referenceFrameIds.size > 64)
      referenceFrameIds.delete(referenceFrameIds.values().next().value);
    referenceLastId = fingerprint;
    const centre = sampleDepth(
      depth,
      0.5,
      0.5,
      inverseProjection,
      view.transform.matrix,
    );
    if (!centre) return;
    const cameraHeight = camera.y - centre.y;
    const range = Math.hypot(
      centre.x - camera.x,
      centre.y - camera.y,
      centre.z - camera.z,
    );
    if (
      cameraHeight < limits.minCameraHeightM ||
      cameraHeight > limits.maxCameraHeightM ||
      range > limits.maxRangeM
    )
      return;
    const hit = frame.getHitTestResults(hitSource).find((result) => {
      const p = result.getPose(referenceSpace);
      // Hit-test Y axis is the hit surface normal. Reject walls/steep surfaces.
      return (
        p &&
        p.transform.matrix[5] > 0.82 &&
        Math.abs(p.transform.position.y - centre.y) < 0.12
      );
    });
    if (!hit) return;
    const right = sampleDepth(
      depth,
      0.525,
      0.5,
      inverseProjection,
      view.transform.matrix,
    );
    const down = sampleDepth(
      depth,
      0.5,
      0.525,
      inverseProjection,
      view.transform.matrix,
    );
    if (horizontalNormal(centre, right, down) < 0.8) return;
    referenceSamples = referenceSamples.filter(
      (s) =>
        timestamp - s.timestamp <= 2000 &&
        Math.abs(s.y - centre.y) < 0.045 &&
        Math.hypot(s.x - centre.x, s.z - centre.z) < 0.35,
    );
    referenceSamples.push({ ...centre, timestamp });
    if (referenceSamples.length > 9) referenceSamples.shift();
    if (
      referenceSamples.length < 5 ||
      timestamp - referenceSamples[0].timestamp < 400
    )
      return;
    const ys = dispersion(referenceSamples.map((p) => p.y));
    if (ys.mad > 0.015) return;
    reference = {
      x: median(referenceSamples.map((p) => p.x)),
      y: ys.median,
      z: median(referenceSamples.map((p) => p.z)),
      observations: referenceSamples.length,
      madM: ys.mad,
    };
    accumulator.setReference(reference);
  }
  function sampleDepth(depth, u, v, inverseProjection, worldFromView) {
    // getDepthInMeters maps normalized view coordinates to the depth image.
    // Applying normDepthBufferFromNormView again would double-transform it.
    const distance = depth.getDepthInMeters(u, v);
    if (
      !Number.isFinite(distance) ||
      distance < 0.2 ||
      distance > limits.maxRangeM
    )
      return null;
    return unprojectDepth({
      u,
      v,
      depthM: distance,
      inverseProjection,
      worldFromView,
    });
  }
  function collect(depth, inverseProjection, worldFromView) {
    const points = [];
    for (let row = 0; row < 12; row++) {
      const v = 0.12 + row * 0.065;
      for (let col = 0; col < 15; col++) {
        const u = 0.08 + col * 0.06;
        const centre = sampleDepth(
          depth,
          u,
          v,
          inverseProjection,
          worldFromView,
        );
        if (!centre) continue;
        const right = sampleDepth(
          depth,
          u + 0.025,
          v,
          inverseProjection,
          worldFromView,
        );
        const down = sampleDepth(
          depth,
          u,
          v + 0.025,
          inverseProjection,
          worldFromView,
        );
        if (horizontalNormal(centre, right, down) < 0.8) continue;
        if (
          Math.hypot(
            right.x - centre.x,
            right.y - centre.y,
            right.z - centre.z,
          ) > 0.5 ||
          Math.hypot(down.x - centre.x, down.y - centre.y, down.z - centre.z) >
            0.5
        )
          continue;
        points.push(centre);
      }
    }
    return points;
  }
  function frameLoop(timestamp, frame) {
    const current = session;
    if (!current || frame.session !== current) return;
    current.requestAnimationFrame(frameLoop);
    try {
      const layer = current.renderState.baseLayer;
      if (layer && gl) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      const pose = frame.getViewerPose(referenceSpace);
      if (
        !pose ||
        pose.emulatedPosition ||
        current.visibilityState !== "visible"
      ) {
        clearRender(timestamp);
        if (timestamp - lastGoodPoseAt > 1500 && reference) reset();
        output(
          "tracking-lost",
          "지면 위치를 다시 찾고 있습니다. 밝은 지면을 천천히 비춰주세요.",
        );
        return;
      }
      lastGoodPoseAt = timestamp;
      // The DOM screen projection is monoscopic. Headsets require per-eye
      // rendering, so do not misleadingly use one eye as a phone viewport.
      const view = pose.views.find((v) => v.eye === "none");
      if (!view) {
        clearRender(timestamp);
        terminalPhase = "unsupported";
        output(
          "unsupported",
          "스마트폰의 단일 카메라 AR 화면에서 이용해주세요.",
        );
        void end();
        return;
      }
      const camera = xyz(view.transform.position);
      if (timestamp - lastSampleAt >= DEPTH_INTERVAL_MS) {
        lastSampleAt = timestamp;
        if (typeof frame.getDepthInformation !== "function")
          throw new DOMException("CPU depth unavailable", "NotSupportedError");
        const depth = frame.getDepthInformation(view);
        if (depth && depth.width > 0 && depth.height > 0) {
          const inverseProjection = invert4(view.projectionMatrix);
          if (!inverseProjection) throw new Error("Invalid projection matrix");
          const fingerprint = depthFingerprint(depth);
          lastDepthAt = timestamp;
          missingDepthSince = null;
          cachedSnapshot = null;
          if (!reference)
            validReference(
              frame,
              depth,
              inverseProjection,
              view,
              camera,
              timestamp,
              fingerprint,
            );
          if (reference)
            accumulator.observe({
              timestamp,
              frameId: fingerprint,
              camera,
              points: collect(depth, inverseProjection, view.transform.matrix),
            });
        } else {
          clearRender(timestamp);
          missingDepthSince ??= timestamp;
          lastDepthAt = -Infinity;
          const slow = timestamp - missingDepthSince > NO_DEPTH_WARNING_MS;
          output(
            "scanning",
            slow
              ? "깊이 정보가 부족합니다. 가까운 잔디를 비추며 천천히 움직여주세요."
              : "지면의 깊이 정보를 받고 있습니다.",
          );
          return;
        }
      }
      if (!reference) {
        clearRender(timestamp);
        output(
          "reference",
          "지면 기준을 찾고 있습니다. 잔디를 비추고 천천히 움직여주세요.",
          {
            progress: Math.min(referenceSamples.length / 5, 1) * 0.2,
            referenceObservations: referenceSamples.length,
          },
        );
        return;
      }
      if (timestamp - lastDepthAt > 500) {
        clearRender(timestamp);
        output(
          "tracking-lost",
          "깊이 정보가 끊겼습니다. 지면을 다시 비춰주세요.",
        );
        return;
      }
      if (!cachedSnapshot || timestamp - lastSnapshotAt >= DEPTH_INTERVAL_MS) {
        cachedSnapshot = accumulator.snapshot(timestamp, camera);
        lastSnapshotAt = timestamp;
      }
      const snapshot = cachedSnapshot;
      const points = snapshot.points
        .map((p) => {
          const screen = projectWorld(
            p,
            view.projectionMatrix,
            view.transform.inverse.matrix,
          );
          return screen &&
            timestamp - p.frameTimestamp <= TERRAIN_DEFAULTS.maxAgeMs
            ? {
                ...p,
                ...screen,
                rangeM: Math.hypot(p.x - camera.x, p.z - camera.z),
              }
            : null;
        })
        .filter(
          (p) =>
            p &&
            p.screenX >= 0 &&
            p.screenX <= 1 &&
            p.screenY >= 0 &&
            p.screenY <= 1,
        );
      const visible = new Set(points.map((p) => p.id));
      const segments = snapshot.segments.filter(
        (s) => visible.has(s.from) && visible.has(s.to),
      );
      onRender({
        points,
        segments,
        tracking: true,
        sessionId,
        reference: publicReference(reference),
        frameTimestamp: timestamp,
        gridSpacingM: snapshot.gridSpacingM,
        width: overlayRoot.clientWidth || innerWidth,
        height: overlayRoot.clientHeight || innerHeight,
      });
      const target = points
        .filter((p) => Math.hypot(p.screenX - 0.5, p.screenY - 0.5) < 0.16)
        .sort(
          (a, b) =>
            Math.hypot(a.screenX - 0.5, a.screenY - 0.5) -
            Math.hypot(b.screenX - 0.5, b.screenY - 0.5),
        )[0];
      const ready =
        snapshot.ready &&
        !!target &&
        points.length >= TERRAIN_DEFAULTS.minCells;
      const details = {
        ...snapshot,
        points: undefined,
        segments: undefined,
        reference: publicReference(reference),
        cameraHeightM: camera.y - reference.y,
        limits,
      };
      output(
        ready ? "ready" : "scanning",
        ready
          ? "지면 측정 중 · 숫자가 자동 갱신됩니다."
          : snapshot.baselineM < TERRAIN_DEFAULTS.minBaselineM
            ? "휴대폰을 좌우로 8cm 이상 천천히 움직여주세요."
            : !target && snapshot.ready
              ? "측정된 격자로 중앙 조준점을 옮겨주세요."
              : "같은 지면을 여러 번 비교하고 있습니다.",
        {
          ...details,
          progress: ready ? 1 : Math.min(0.98, 0.2 + snapshot.progress * 0.8),
        },
      );
      if (ready) {
        latest = {
          source: SOURCE,
          algorithmVersion: "webxr-world-grid-median-v1",
          sessionId,
          acceptedAt: new Date().toISOString(),
          frameTimestamp: timestamp,
          distanceM: target.rangeM,
          elevationM: target.elevationM,
          cameraHeightM: camera.y - reference.y,
          targetWorld: { x: target.worldX, y: target.worldY, z: target.worldZ },
          medianMadM: median(points.map((p) => p.madM)),
          targetMadM: target.madM,
          stableCells: points.length,
          observationCount: target.samples,
          observedFrames: snapshot.observedFrames,
          baselineM: target.baselineM,
          observationSpanMs: target.spanMs,
          gridSpacingM: snapshot.gridSpacingM,
          reference: publicReference(reference),
          absoluteAccuracyValidated: false,
          independenceAssumed: false,
          depthType: current.depthType || "unspecified",
          depthDataFormat: current.depthDataFormat,
          limits,
        };
        onMeasurement(latest);
      } else {
        latest = null;
        onMeasurement(null);
      }
    } catch (error) {
      clearRender(timestamp);
      terminalPhase =
        error?.name === "NotSupportedError" ? "unsupported" : "error";
      output(
        terminalPhase,
        terminalPhase === "unsupported"
          ? "이 기기·브라우저는 실제 깊이 스캔 데이터를 제공하지 않습니다."
          : "지면 깊이 연결이 끊겼습니다. 다시 시작해주세요.",
        { errorName: error?.name || "Error" },
      );
      void end();
    }
  }
  return {
    start,
    end,
    reset,
    get active() {
      return !!session;
    },
    get state() {
      return state;
    },
    get measurement() {
      return latest;
    },
  };
}
