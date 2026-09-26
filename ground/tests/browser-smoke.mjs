import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = process.env.CHECK_OUTPUT || ".verification/autoscan-v2-2";
const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
const contexts = [];
async function newPage(init) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  contexts.push(context);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseURL);
  await page.locator("#consent-decline").click();
  return { page, context };
}
async function fullViewport(page) {
  const viewport = page.viewportSize();
  assert.deepEqual(await page.locator("#capture").boundingBox(), {
    x: 0,
    y: 0,
    ...viewport,
  });
  assert.deepEqual(await page.locator("#terrain-overlay").boundingBox(), {
    x: 0,
    y: 0,
    ...viewport,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
}
async function drawnPixels(page) {
  return page.locator("#terrain-overlay").evaluate((canvas) => {
    const pixels = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
    return count;
  });
}
async function noPhotoFlow(page) {
  assert.equal(
    await page.locator("#shoot,#photo-file,#video,#aim-grid").count(),
    0,
  );
  assert.equal(await page.getByRole("button", { name: /촬영/ }).count(), 0);
}
async function diagnostic(page) {
  await page.locator("#settings-open").click();
  const data = JSON.parse(await page.locator("#debug-data").textContent());
  await page.locator("#settings-close").click();
  return data;
}

/**
 * Test-only synthetic WebXR adapter. It passes depth images/poses through the
 * production engine and UI; it is not physical validation or a runtime fallback.
 */
function installSyntheticXR() {
  const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -10.1 / 9.9, -1, 0, 0, -2 / 9.9, 0];
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  let animation = null,
    index = 0,
    frameTime = -125,
    session = null;
  const c = Math.SQRT1_2,
    s = -Math.SQRT1_2;
  function makeSession() {
    const listeners = new Map(),
      referenceListeners = new Map();
    const space = {
      addEventListener(name, fn) {
        referenceListeners.set(name, fn);
      },
    };
    const created = {
      depthUsage: "cpu-optimized",
      depthDataFormat: "float32",
      depthType: "raw",
      domOverlayState: { type: "screen" },
      visibilityState: "visible",
      renderState: {},
      addEventListener(name, fn) {
        listeners.set(name, fn);
      },
      updateRenderState(next) {
        this.renderState = next;
      },
      async requestReferenceSpace() {
        return space;
      },
      async requestHitTestSource() {
        return { cancel() {} };
      },
      requestAnimationFrame(fn) {
        animation = fn;
      },
      async end() {
        listeners.get("end")?.();
        animation = null;
      },
    };
    session = created;
    index = 0;
    frameTime = -125;
    return created;
  }
  Object.defineProperty(navigator, "xr", {
    configurable: true,
    value: {
      async isSessionSupported(mode) {
        return mode === "immersive-ar";
      },
      requestSession(mode, options) {
        window.__syntheticXR.request = {
          mode,
          options: {
            requiredFeatures: options.requiredFeatures,
            depthSensing: options.depthSensing,
          },
        };
        return Promise.resolve(makeSession());
      },
    },
  });
  window.XRWebGLLayer = class {
    constructor() {
      this.framebuffer = null;
    }
  };
  WebGLRenderingContext.prototype.makeXRCompatible = async function () {};
  window.__syntheticXR = {
    request: null,
    async tick(count = 1, mode = "valid") {
      if (!animation || !session)
        throw new Error("Synthetic XR has not started");
      for (let n = 0; n < count; n++) {
        await new Promise((resolve) => setTimeout(resolve, 225));
        frameTime += 125;
        const frameIndex = index++,
          x = Math.sin(frameIndex / 12) * 0.14;
        const world = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, x, 1.2, 0, 1];
        const inverse = [
          1,
          0,
          0,
          0,
          0,
          c,
          -s,
          0,
          0,
          s,
          c,
          0,
          -x,
          -c * 1.2,
          s * 1.2,
          1,
        ];
        const view = {
          eye: "none",
          projectionMatrix: P,
          transform: {
            position: { x, y: 1.2, z: 0 },
            matrix: world,
            inverse: { matrix: inverse },
          },
        };
        const depth = {
          width: 160,
          height: 120,
          data: new Float32Array([frameIndex + 1]).buffer,
          getDepthInMeters(u, v) {
            const dy = c * (1 - 2 * v) + s;
            return dy < 0 ? (0.001 * Math.sin(frameIndex) - 1.2) / dy : 0;
          },
        };
        const frame = {
          session,
          getViewerPose() {
            return mode === "lost"
              ? null
              : { emulatedPosition: false, views: [view] };
          },
          getDepthInformation() {
            return mode === "no-depth" ? null : depth;
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
        animation(frameTime, frame);
      }
    },
  };
  document.addEventListener("DOMContentLoaded", () => {
    const label = document.createElement("div");
    label.id = "synthetic-test-label";
    label.textContent = "합성 센서 검증 화면 · 실제 측정 아님";
    Object.assign(label.style, {
      position: "fixed",
      left: "8px",
      right: "8px",
      bottom: "4px",
      padding: "4px",
      textAlign: "center",
      fontSize: "11px",
      color: "#fff",
      background: "#762200",
      zIndex: "100000",
      pointerEvents: "none",
    });
    document.body.append(label);
  });
}

try {
  const unsupported = await newPage(() =>
    Object.defineProperty(navigator, "xr", {
      value: undefined,
      configurable: true,
    }),
  );
  const { page, context } = unsupported;
  await page.locator("#support-panel").waitFor({ state: "visible" });
  await fullViewport(page);
  await noPhotoFlow(page);
  assert.equal(await page.locator("#readouts").isVisible(), false);
  assert.equal(await page.locator("#scan-progress").isVisible(), false);
  assert.equal(await page.locator("#start").isVisible(), false);
  assert.equal(
    await drawnPixels(page),
    0,
    "unsupported camera must have no invented grid",
  );
  assert.match(
    await page.locator("#support-message").textContent(),
    /지원|제공/,
  );
  await page.screenshot({ path: output + "/unsupported-mobile.png" });

  await page.locator("#settings-open").click();
  await page.locator("#display-settings summary").click();
  await page.locator("[name=largeText]").check();
  await page.locator("[name=maxRangeM]").selectOption("5");
  await page.locator("#settings-form button[type=submit]").click();
  await page.reload();
  await page.locator("#support-panel").waitFor({ state: "visible" });
  assert.equal(await page.locator("#consent").isVisible(), false);
  assert.ok(
    await page
      .locator("html")
      .evaluate((html) => html.classList.contains("large-text")),
  );
  await page.locator("#settings-open").click();
  assert.equal(await page.locator("[name=maxRangeM]").inputValue(), "5");
  await page.locator("#analysis>summary").click();
  await page.locator("#sample-data").scrollIntoViewIfNeeded();
  const none = JSON.parse(await page.locator("#debug-data").textContent());
  assert.equal(none.terrainMeasured, false);
  assert.equal(none.measurement, null);
  assert.equal(none.absoluteAccuracyValidated, false);
  await page.screenshot({ path: output + "/unsupported-analysis-mobile.png" });
  await page.locator("#settings-close").click();
  for (const [width, height, filename] of [
    [844, 390, "unsupported-landscape"],
    [1365, 900, "unsupported-desktop"],
  ]) {
    await page.setViewportSize({ width, height });
    await fullViewport(page);
    await page.screenshot({ path: output + "/" + filename + ".png" });
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await page.locator("#support-panel").waitFor({ state: "visible" });
  await fullViewport(page);
  await noPhotoFlow(page);
  assert.equal(await drawnPixels(page), 0);
  await context.setOffline(false);
  console.log(
    "PASS: unsupported device has no fake grid/numbers/capture button; full viewport, settings persistence and offline shell.",
  );

  const synthetic = await newPage(installSyntheticXR),
    ar = synthetic.page;
  await ar.locator("#start").waitFor({ state: "visible" });
  await ar.waitForFunction(() => !document.querySelector("#start").disabled);
  await noPhotoFlow(ar);
  await ar.locator("#start").click();
  await ar.waitForFunction(() => !!window.__syntheticXR?.request);
  await ar.waitForFunction(() =>
    document.querySelector("html").classList.contains("xr-running"),
  );
  await fullViewport(ar);
  assert.equal(await ar.locator("#scan-progress").isVisible(), true);
  assert.equal(await ar.locator("#readouts").isVisible(), false);
  const request = await ar.evaluate(() => window.__syntheticXR.request);
  assert.deepEqual(request.options.depthSensing.usagePreference, [
    "cpu-optimized",
  ]);
  for (const feature of ["depth-sensing", "hit-test", "dom-overlay"])
    assert.ok(request.options.requiredFeatures.includes(feature));
  await ar.evaluate(() => window.__syntheticXR.tick(4));
  assert.equal(await ar.locator("#readouts").isVisible(), false);
  assert.equal(await drawnPixels(ar), 0);
  assert.ok(
    await ar
      .locator("#scan-progress")
      .evaluate((p) => p.value > 0 && p.value < 1),
  );
  await ar.screenshot({ path: output + "/synthetic-scanning-mobile.png" });
  await ar.evaluate(() => window.__syntheticXR.tick(2));
  const partial = await diagnostic(ar);
  assert.equal(partial.scan.phase, "scanning");
  assert.ok(partial.scan.observedFrames > 0);
  assert.equal(partial.terrainMeasured, false);
  assert.equal(await ar.locator("#readouts").isVisible(), false);
  await ar.evaluate(() => window.__syntheticXR.tick(30));
  await ar.locator("#readouts").waitFor({ state: "visible" });
  assert.match(await ar.locator("#height-output").textContent(), /cm$/);
  assert.match(await ar.locator("#distance").textContent(), /m$/);
  assert.equal(await ar.locator("#scan-progress").isVisible(), false);
  assert.ok(
    (await drawnPixels(ar)) > 100,
    "real production rendering must draw accepted synthetic depth cells",
  );
  const ready = await diagnostic(ar);
  assert.equal(ready.scan.phase, "ready");
  assert.equal(ready.measurement.source, "webxr-depth");
  assert.equal(ready.terrainMeasured, true);
  assert.equal(ready.absoluteAccuracyValidated, false);
  assert.ok(ready.measurement.observationCount >= 7);
  assert.ok(ready.measurement.observationSpanMs >= 1200);
  assert.ok(ready.measurement.baselineM >= 0.08);
  assert.equal(ready.settings.maxRangeM, 3);
  assert.equal(
    await ar.evaluate(
      async () => (await (await import("./storage.mjs")).listRecords()).length,
    ),
    0,
    "declined collection must not store or upload automatic measurements",
  );
  await ar.screenshot({ path: output + "/synthetic-ready-mobile.png" });

  await ar.locator("#settings-open").click();
  await ar.locator("#display-settings summary").click();
  await ar.locator("[name=grid]").uncheck();
  await ar.locator("#settings-form button[type=submit]").click();
  assert.equal(await drawnPixels(ar), 0);
  assert.equal(await ar.locator("#readouts").isVisible(), true);
  await ar.locator("#settings-open").click();
  await ar.locator("[name=grid]").check();
  await ar.locator("#settings-form button[type=submit]").click();
  assert.ok((await drawnPixels(ar)) > 100);
  await ar.setViewportSize({ width: 844, height: 390 });
  await fullViewport(ar);
  await ar.screenshot({ path: output + "/synthetic-ready-landscape.png" });
  await ar.setViewportSize({ width: 1365, height: 900 });
  await fullViewport(ar);
  await ar.screenshot({ path: output + "/synthetic-ready-desktop.png" });
  await ar.setViewportSize({ width: 390, height: 844 });
  await ar.evaluate(() => window.__syntheticXR.tick(1, "no-depth"));
  assert.equal(await ar.locator("#readouts").isVisible(), false);
  assert.equal(await drawnPixels(ar), 0);
  assert.equal(await ar.locator("#scan-progress").isVisible(), true);
  await ar.evaluate(() => window.__syntheticXR.tick(1, "lost"));
  assert.equal(await ar.locator("#readouts").isVisible(), false);
  assert.equal(await drawnPixels(ar), 0);
  assert.match(await ar.locator("#scan-phase").textContent(), /다시/);
  await ar.screenshot({ path: output + "/synthetic-tracking-lost-mobile.png" });
  await ar.locator("#stop").click();
  await ar.locator("#start").waitFor({ state: "visible" });
  assert.equal(await ar.locator("#readouts").isVisible(), false);
  assert.equal(await drawnPixels(ar), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: TEST-ONLY synthetic WebXR depth/pose -> production scanner -> actual canvas/UI: partial progress, automatic stable grid/numbers, declined upload, grid setting, tracking/depth loss and stop.",
  );
  console.log(
    "This is software verification with synthetic sensor data. It does not validate physical field accuracy or actual device WebXR availability.",
  );
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
