import test from "node:test";
import assert from "node:assert/strict";
import {
  TerrainAccumulator,
  invert4,
  transform4,
  unprojectDepth,
  projectWorld,
  horizontalNormal,
  dispersion,
} from "../terrain-core.mjs";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// 90-degree perspective with near .1m and far 10m, column-major.
const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -10.1 / 9.9, -1, 0, 0, -2 / 9.9, 0];
const close = (a, b, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) < tolerance, a + " != " + b);
const grid = (height = 0) =>
  [0, 1, 2].flatMap((x) =>
    [0, 1, 2].map((z) => ({ x: 0.5 + x * 0.25, y: height, z: -2 - z * 0.25 })),
  );
function make() {
  const a = new TerrainAccumulator();
  a.setReference({ x: 0, y: 0, z: 0 });
  return a;
}
function frames(a, count = 7, { move = true, step = 200, y = () => 0 } = {}) {
  for (let i = 0; i < count; i++)
    a.observe({
      timestamp: i * step,
      frameId: "depth-" + i,
      camera: { x: move ? i * 0.02 : 0, y: 1.2, z: 0 },
      points: grid(y(i)),
    });
  return a.snapshot((count - 1) * step, { x: 0.1, y: 1.2, z: 0 });
}
test("depth is axial camera-plane metres, not normalized ray length", () => {
  const p = unprojectDepth({
    u: 0.75,
    v: 0.25,
    depthM: 2,
    inverseProjection: invert4(P),
    worldFromView: I,
  });
  close(p.x, 1);
  close(p.y, 1);
  close(p.z, -2);
  assert.ok(Math.hypot(p.x, p.y, p.z) > 2);
  const screen = projectWorld(p, P, I);
  close(screen.screenX, 0.75);
  close(screen.screenY, 0.25);
});
test("inverse projection preserves asymmetric camera intrinsics and world transform", () => {
  const p = [...P];
  p[8] = 0.23;
  p[9] = -0.11;
  const world = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 3, 1.2, 4, 1];
  const out = unprojectDepth({
    u: 0.62,
    v: 0.78,
    depthM: 1.5,
    inverseProjection: invert4(p),
    worldFromView: world,
  });
  const screen = projectWorld(out, p, invert4(world));
  close(screen.screenX, 0.62);
  close(screen.screenY, 0.78);
  const sensor = transform4(invert4(world), [out.x, out.y, out.z, 1]);
  close(sensor[2], -1.5);
});
test("invalid depth and singular matrices cannot create metric points", () => {
  assert.equal(invert4(new Array(16).fill(0)), null);
  for (const depthM of [0, -1, NaN, Infinity]) {
    assert.equal(
      unprojectDepth({
        u: 0.5,
        v: 0.5,
        depthM,
        inverseProjection: invert4(P),
        worldFromView: I,
      }),
      null,
    );
  }
  assert.equal(projectWorld({ x: 0, y: 0, z: 2 }, P, I), null);
});
test("ground normals reject vertical walls", () => {
  close(
    horizontalNormal(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ),
    1,
  );
  close(
    horizontalNormal(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ),
    0,
  );
});
test("stable repeat observations produce connected measured grid and relative elevation", () => {
  const result = frames(make(), 7, { y: () => 0.06 });
  assert.equal(result.ready, true);
  assert.equal(result.points.length, 9);
  assert.equal(result.segments.length, 12);
  assert.equal(result.progress, 1);
  for (const p of result.points) {
    close(p.elevationM, 0.06);
    assert.equal(p.samples, 7);
    close(p.madM, 0);
  }
});
test("multiple pixels in one cell count as one observation per depth frame", () => {
  const a = make();
  a.observe({
    timestamp: 0,
    frameId: "frame",
    camera: { x: 0, y: 1.2, z: 0 },
    points: new Array(100).fill({ x: 0.5, y: 0, z: -2 }),
  });
  assert.equal(a.snapshot(0).observedSamples, 1);
  assert.equal(a.snapshot(0).ready, false);
});
test("render timestamps and repeated depth buffers cannot inflate progress", () => {
  const a = make();
  for (let i = 0; i < 20; i++)
    a.observe({
      timestamp: i * 200,
      frameId: "same-native-depth",
      camera: { x: i * 0.02, y: 1.2, z: 0 },
      points: grid(),
    });
  assert.equal(a.observedFrames, 1);
  assert.equal(a.snapshot(3800).ready, false);
  const b = make();
  for (let i = 0; i < 20; i++)
    b.observe({
      timestamp: 1,
      frameId: "new-" + i,
      camera: { x: i * 0.02, y: 1.2, z: 0 },
      points: grid(),
    });
  assert.equal(b.observedFrames, 1);
});
test("stationary phone and too-short observation span never pass calibration", () => {
  assert.equal(frames(make(), 10, { move: false }).ready, false);
  assert.equal(frames(make(), 10, { step: 50 }).ready, false);
  assert.ok(frames(make(), 10, { move: false }).progress < 1);
});
test("high repeated height dispersion withholds the surface", () => {
  const result = frames(make(), 10, { y: (i) => (i % 2 ? 0.09 : -0.09) });
  assert.equal(result.ready, false);
  assert.equal(result.points.length, 0);
  assert.ok(result.progress < 1);
});
test("MAD resists a gross outlier but does not claim an accuracy interval", () => {
  assert.deepEqual(dispersion([0, 0.001, -0.001, 0, 0.002, 0, 0.4]), {
    median: 0,
    mad: 0.001,
  });
  const result = frames(make(), 8, { y: (i) => (i === 3 ? 0.4 : 0.01) });
  assert.equal(result.ready, true);
  close(result.points[0].elevationM, 0.01);
  assert.equal(result.points[0].samples, 7);
  assert.equal(result.points[0].accuracyM, undefined);
});
test("stale surface is hidden and reset discards prior reference and samples", () => {
  const a = make();
  frames(a);
  assert.equal(a.snapshot(2401).points.length, 0);
  a.reset();
  assert.equal(a.reference, null);
  assert.equal(a.cells.size, 0);
  assert.equal(
    a.observe({
      timestamp: 5000,
      frameId: "fresh",
      camera: { x: 0, y: 1.2, z: 0 },
      points: grid(),
    }),
    false,
  );
  a.setReference({ x: 0, y: 0.05, z: 0 });
  assert.equal(a.observedFrames, 0);
});
test("missing grid cells are not invented or bridged", () => {
  const a = make();
  for (let i = 0; i < 7; i++)
    a.observe({
      timestamp: i * 200,
      frameId: "d" + i,
      camera: { x: i * 0.02, y: 1.2, z: 0 },
      points: [
        { x: 0.5, y: 0, z: -2 },
        { x: 1, y: 0, z: -2 },
      ],
    });
  const result = a.snapshot(1200);
  assert.equal(result.points.length, 2);
  assert.equal(result.segments.length, 0);
  assert.equal(result.ready, false);
});
test("out-of-range and above-camera geometry does not become ground", () => {
  const a = make();
  for (let i = 0; i < 7; i++)
    a.observe({
      timestamp: i * 200,
      frameId: "d" + i,
      camera: { x: i * 0.02, y: 1.2, z: 0 },
      points: [
        { x: 0, y: 0, z: -7 },
        { x: 0, y: 1.3, z: -2 },
        { x: NaN, y: 0, z: -2 },
      ],
    });
  assert.equal(a.snapshot(1200).points.length, 0);
});

test("outlier-only recent frames cannot keep old accepted elevations visible", () => {
  const a = make();
  frames(a, 16);
  for (let i = 16; i < 21; i++)
    a.observe({
      timestamp: i * 400,
      frameId: "outlier-" + i,
      camera: { x: i * 0.02, y: 1.2, z: 0 },
      points: grid(0.5),
    });
  assert.equal(a.snapshot(8000).points.length, 0);
});

test("WebXR session starts within gesture and real depth frames automatically emit terrain", async () => {
  const { createTerrainScanner } = await import("../webxr-scan.mjs");
  const names = [
    "navigator",
    "document",
    "XRWebGLLayer",
    "innerWidth",
    "innerHeight",
  ];
  const original = new Map(
    names.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const listeners = new Map();
  let callback = null,
    requested = false,
    requestOptions,
    frameNumber = 0,
    lastFrame = null;
  const space = { addEventListener() {} };
  const session = {
    depthUsage: "cpu-optimized",
    depthDataFormat: "float32",
    depthType: "raw",
    domOverlayState: { type: "screen" },
    visibilityState: "visible",
    renderState: {},
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    updateRenderState(s) {
      this.renderState = s;
    },
    async requestReferenceSpace() {
      return space;
    },
    async requestHitTestSource() {
      return { cancel() {} };
    },
    requestAnimationFrame(fn) {
      callback = fn;
    },
    async end() {
      listeners.get("end")?.();
    },
  };
  const gl = {
    FRAMEBUFFER: 1,
    COLOR_BUFFER_BIT: 2,
    async makeXRCompatible() {},
    bindFramebuffer() {},
    clearColor() {},
    clear() {},
  };
  const overlayRoot = { clientWidth: 390, clientHeight: 844 };
  const states = [],
    measurements = [],
    renders = [];
  try {
    for (const [key, value] of Object.entries({
      navigator: {
        xr: {
          requestSession(mode, options) {
            requested = true;
            requestOptions = options;
            assert.equal(mode, "immersive-ar");
            return Promise.resolve(session);
          },
        },
      },
      document: {
        createElement() {
          return {
            getContext() {
              return gl;
            },
            addEventListener() {},
            removeEventListener() {},
          };
        },
      },
      XRWebGLLayer: class {
        constructor() {
          this.framebuffer = {};
        }
      },
      innerWidth: 390,
      innerHeight: 844,
    }))
      Object.defineProperty(globalThis, key, { value, configurable: true });
    const scanner = createTerrainScanner({
      overlayRoot,
      onState: (s) => states.push(s),
      onMeasurement: (m) => measurements.push(m),
      onRender: (r) => renders.push(r),
    });
    const promise = scanner.start();
    assert.equal(
      requested,
      true,
      "requestSession must execute before an await loses the gesture",
    );
    assert.ok(requestOptions.requiredFeatures.includes("depth-sensing"));
    assert.ok(requestOptions.requiredFeatures.includes("dom-overlay"));
    assert.equal(await promise, true);
    const c = Math.SQRT1_2,
      s = -Math.SQRT1_2;
    for (frameNumber = 0; frameNumber < 36; frameNumber++) {
      const x = Math.sin(frameNumber / 12) * 0.14;
      const world = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, x, 1.2, 0, 1];
      const view = {
        eye: "none",
        projectionMatrix: P,
        transform: {
          position: { x, y: 1.2, z: 0 },
          matrix: world,
          inverse: { matrix: invert4(world) },
        },
      };
      const depth = {
        width: 160,
        height: 120,
        data: new Float32Array([frameNumber + 1]).buffer,
        getDepthInMeters(u, v) {
          const ray = unprojectDepth({
            u,
            v,
            depthM: 1,
            inverseProjection: invert4(P),
            worldFromView: world,
          });
          const dy = ray.y - 1.2;
          return dy < 0 ? (0.001 * Math.sin(frameNumber) - 1.2) / dy : 0;
        },
      };
      const frame = {
        session,
        getViewerPose() {
          return { emulatedPosition: false, views: [view] };
        },
        getDepthInformation() {
          return depth;
        },
        getHitTestResults() {
          return [
            {
              getPose() {
                return {
                  transform: { matrix: I, position: { x, y: 0, z: -1.2 } },
                };
              },
            },
          ];
        },
      };
      lastFrame = frame;
      callback(frameNumber * 125, frame);
    }
    assert.ok(states.some((s) => s.phase === "reference"));
    assert.ok(
      states.some((s) => s.phase === "ready"),
      JSON.stringify(states.at(-1)),
    );
    const measured = measurements.find((m) => m !== null);
    assert.ok(measured);
    assert.equal(measured.absoluteAccuracyValidated, false);
    assert.ok(measured.observationCount >= 7);
    assert.ok(measured.distanceM > 0.4 && measured.distanceM < 5);
    assert.ok(
      renders.some(
        (r) =>
          r.segments.length > 0 &&
          r.points.every((p) => Number.isFinite(p.worldY)),
      ),
    );
    // Missing depth clears the surface, including the following unsampled rAF.
    callback(4500, {
      ...lastFrame,
      getDepthInformation() {
        return null;
      },
    });
    assert.equal(measurements.at(-1), null);
    callback(4520, lastFrame);
    assert.deepEqual(renders.at(-1).points, []);
    // Lost pose must erase the prior grid and automatic number immediately.
    callback(5000, {
      session,
      getViewerPose() {
        return null;
      },
    });
    assert.equal(measurements.at(-1), null);
    assert.deepEqual(renders.at(-1).points, []);
    await scanner.end();
    assert.equal(scanner.active, false);
  } finally {
    for (const name of names) {
      const descriptor = original.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test("unsupported depth and denied permissions never report measured terrain", async () => {
  const { createTerrainScanner, detectTerrainSupport } = await import(
    "../webxr-scan.mjs"
  );
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalSecure = Object.getOwnPropertyDescriptor(
    globalThis,
    "isSecureContext",
  );
  try {
    Object.defineProperty(globalThis, "isSecureContext", {
      value: true,
      configurable: true,
    });
    for (const [name, phase] of [
      ["NotSupportedError", "unsupported"],
      ["NotAllowedError", "error"],
    ]) {
      Object.defineProperty(globalThis, "navigator", {
        value: {
          xr: {
            async isSessionSupported() {
              return true;
            },
            requestSession() {
              return Promise.reject(new DOMException("synthetic test", name));
            },
          },
        },
        configurable: true,
      });
      const support = await detectTerrainSupport();
      assert.equal(support.supported, true);
      assert.equal(support.depthConfirmed, false);
      const seen = [];
      const scanner = createTerrainScanner({
        overlayRoot: { clientWidth: 390, clientHeight: 844 },
        onMeasurement: (m) => seen.push(m),
      });
      assert.equal(await scanner.start(), false);
      assert.equal(scanner.active, false);
      assert.equal(scanner.state.phase, phase);
      assert.equal(scanner.state.progress, 0);
      assert.ok(seen.every((m) => m === null));
    }
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });
    assert.equal((await detectTerrainSupport()).supported, false);
  } finally {
    if (originalNavigator)
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    if (originalSecure)
      Object.defineProperty(globalThis, "isSecureContext", originalSecure);
    else delete globalThis.isSecureContext;
  }
});
