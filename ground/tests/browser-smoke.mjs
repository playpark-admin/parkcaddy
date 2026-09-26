import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = process.env.CHECK_OUTPUT || ".verification";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ["camera", "geolocation"],
  geolocation: { latitude: 37.5, longitude: 127, accuracy: 8 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const assertFullCamera = async () => {
  const bounds = await page.locator("#video").boundingBox(),
    vp = page.viewportSize();
  assert.deepEqual(bounds, { x: 0, y: 0, width: vp.width, height: vp.height });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
};
try {
  await page.goto(process.env.BASE_URL || "http://127.0.0.1:4173");
  await page.locator("#consent-decline").click();
  await assertFullCamera();
  assert.equal(await page.locator("nav").count(), 0);
  assert.equal(await page.locator("#records-list").count(), 0);
  await page.locator("#settings-open").click();
  await page.locator("#display-settings summary").click();
  await page.locator("[name=largeText]").check();
  await page.locator("#settings-form button[type=submit]").click();
  await page.reload();
  assert.equal(await page.locator("#consent").isVisible(), false);
  assert.ok(
    await page
      .locator("html")
      .evaluate((e) => e.classList.contains("large-text")),
  );
  await page.locator("#start").click();
  await page.waitForFunction(() => !document.querySelector("#shoot").disabled);
  await page.waitForFunction(() =>
    document.querySelector("#gps-status").textContent.includes("±"),
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new DeviceOrientationEvent("deviceorientation", {
        beta: 50,
        gamma: 0,
        alpha: 5,
      }),
    ),
  );
  await page.locator("#shoot").click();
  await page.waitForFunction(
    async () =>
      (await (await import("./storage.mjs")).listRecords()).length === 1,
  );
  const record = await page.evaluate(
    async () => (await (await import("./storage.mjs")).listRecords())[0],
  );
  assert.equal(record.terrainMeasured, false);
  assert.equal(record.gps.latitude, 37.5);
  assert.equal(record.hole, null);
  assert.equal(record.course, "");
  assert.equal(record.cloudStatus, "local");
  assert.ok(!record.ownerUid);
  assert.ok(!record.collectionConsent);
  assert.ok(record.image.startsWith("data:image/jpeg;base64,"));
  assert.ok(record.image.length <= 700000);
  assertFullCamera();
  await page.screenshot({ path: output + "/camera-mobile.png" });
  await page.locator("#settings-open").click();
  await page.locator("#settings details").first().locator("summary").click();
  await page.locator("#display-settings summary").click();
  await page.locator("#analysis>summary").click();
  await page.locator("#sample-data").scrollIntoViewIfNeeded();
  assert.match(await page.locator("#debug-data").textContent(), /metric depth/);
  await page.screenshot({ path: output + "/analysis-mobile.png" });
  await page.locator("#settings-close").click();
  await page.setViewportSize({ width: 844, height: 390 });
  await assertFullCamera();
  await page.screenshot({ path: output + "/camera-landscape.png" });
  await page.setViewportSize({ width: 1365, height: 900 });
  await assertFullCamera();
  await page.screenshot({ path: output + "/camera-desktop.png" });
  await page.locator("#stop").click();
  assert.equal(await page.locator("#start").isVisible(), true);
  assert.equal(await page.locator("#video").evaluate((v) => v.srcObject), null);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await page.locator("#start").waitFor();
  await assertFullCamera();
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: full viewport portrait/landscape/desktop camera, grid, settings persistence, live diagnostics, private local capture, first consent, offline shell",
  );
} finally {
  await context.close();
  await browser.close();
}
