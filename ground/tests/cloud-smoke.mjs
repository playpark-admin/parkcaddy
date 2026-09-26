import { createRequire } from "node:module";
import assert from "node:assert/strict";
if (process.env.RUN_LIVE_CLOUD_TEST !== "1")
  throw new Error(
    "Explicit RUN_LIVE_CLOUD_TEST=1 is required; creates then removes synthetic cloud records.",
  );
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const context = await browser.newContext({
  permissions: ["camera", "geolocation"],
  geolocation: { latitude: 0, longitude: 0, accuracy: 100 },
});
const page = await context.newPage();
page.on("dialog", (d) => d.accept());
try {
  await page.goto(process.env.BASE_URL || "http://127.0.0.1:4173");
  await page.locator("#start").click();
  await page.locator("#course").fill("AUTOMATED TEST - SYNTHETIC");
  await page.waitForFunction(() => !document.querySelector("#shoot").disabled);
  await page.locator("#shoot").click();
  await page.waitForFunction(() => document.querySelector("#recent .record"));
  await page.locator("#stop").click();
  await page
    .locator("#records-list")
    .getByRole("button", { name: "서버에 전송", exact: true })
    .click();
  await page.locator("#upload").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#records-list")
        ?.textContent.includes("서버 수집됨"),
    {},
    { timeout: 45000 },
  );
  const results = await page.evaluate(async () => {
    const { firebaseConfig } = await import("./firebase-config.js");
    const { initializeApp, getApp } = await import(
      "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"
    );
    const { getAuth, signInAnonymously, deleteUser } = await import(
      "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"
    );
    const { getFirestore, doc, getDoc, setDoc, serverTimestamp } = await import(
      "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-lite.js"
    );
    const record = (await (await import("./storage.mjs")).listRecords())[0],
      app = getApp(),
      db = getFirestore(app),
      ref = doc(db, "users", record.ownerUid, "observations", record.id);
    const own = await getDoc(ref);
    if (!own.exists()) throw new Error("Own record absent");
    let malformedDenied = false;
    try {
      await setDoc(ref, {
        ...own.data(),
        status: "verified",
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      malformedDenied = e.code === "permission-denied";
    }
    const other = initializeApp(firebaseConfig, "other-test"),
      otherAuth = getAuth(other);
    const otherUser = (await signInAnonymously(otherAuth)).user;
    let crossUserDenied = false;
    try {
      await getDoc(
        doc(
          getFirestore(other),
          "users",
          record.ownerUid,
          "observations",
          record.id,
        ),
      );
    } catch (e) {
      crossUserDenied = e.code === "permission-denied";
    }
    await deleteUser(otherUser);
    return { ownRead: own.exists(), malformedDenied, crossUserDenied };
  });
  assert.deepEqual(results, {
    ownRead: true,
    malformedDenied: true,
    crossUserDenied: true,
  });
  await page
    .locator("#records-list")
    .getByRole("button", { name: "서버 기록 삭제", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#records-list")
      .textContent.includes("이 기기에 저장됨"),
  );
  await page.evaluate(async () => {
    const { getAuth, deleteUser } = await import(
      "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"
    );
    await deleteUser(getAuth().currentUser);
  });
  console.log(
    "PASS live Firebase: anonymous auth, consent upload, owner read, cross-user denied, verified injection denied, server delete, synthetic account cleanup",
  );
} catch (e) {
  console.error(await page.locator("#notice").textContent());
  throw e;
} finally {
  await context.close();
  await browser.close();
}
