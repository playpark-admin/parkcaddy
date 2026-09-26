import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
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
  viewport: { width: 1365, height: 1000 },
  permissions: ["camera", "geolocation"],
  geolocation: { latitude: 37.5, longitude: 127.0, accuracy: 8 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:4173");
  await page.locator("#start").waitFor();
  await page.screenshot({ path: output + "/home-desktop.png", fullPage: true });
  await page.locator("#settings-open").click();
  await page.locator("[name=largeText]").check();
  await page
    .locator(
      "#settings-form button[type=submit], #settings-form button.primary",
    )
    .click();
  assert.ok(
    await page
      .locator("html")
      .evaluate((e) => e.classList.contains("large-text")),
  );
  await page.reload();
  assert.ok(
    await page
      .locator("html")
      .evaluate((e) => e.classList.contains("large-text")),
  );
  await page.locator("#start").click();
  await page.locator("#course").fill("검증용 가상 구장");
  await page.waitForFunction(() => !document.querySelector("#shoot").disabled);
  await page.locator("#shoot").click();
  await page.waitForFunction(() => document.querySelector("#recent .record"));
  await page.locator("#stop").click();
  assert.equal(await page.locator("#records-list .record").count(), 1);
  assert.match(
    await page.locator("#records-list").innerText(),
    /높낮이 미측정/,
  );
  const record = await page.evaluate(
    async () => (await (await import("./storage.mjs")).listRecords())[0],
  );
  assert.equal(record.terrainMeasured, false);
  assert.equal(record.gps.latitude, 37.5);
  assert.equal(record.cloudStatus, "local");
  assert.ok(record.image.startsWith("data:image/jpeg;base64,"));
  assert.ok(record.image.length <= 700000);
  await page.locator("#records-list .secondary").first().click();
  await page.locator("#consent").waitFor({ state: "visible" });
  await page.locator("#consent-close").click();
  await page.screenshot({ path: output + "/records.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("nav [data-view=home]").click();
  await page.screenshot({ path: output + "/home-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator("#start").isVisible(), true);
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS browser smoke: responsive layout, settings persistence, camera/GPS capture, local record, consent, offline shell",
  );
} finally {
  await context.close();
  await browser.close();
}
