import { createRequire } from "node:module";
import assert from "node:assert/strict";
if (process.env.RUN_LIVE_CLOUD_TEST !== "1")
  throw new Error(
    "Explicit RUN_LIVE_CLOUD_TEST=1 is required; creates then removes synthetic cloud records.",
  );
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext();
const page = await context.newPage();
try {
  await page.goto(process.env.BASE_URL || "http://127.0.0.1:4173");
  const results = await page.evaluate(async () => {
    const storage = await import("./storage.mjs");
    const cloud = await import("./cloud.mjs");
    const { createCollector } = await import("./collection.mjs");
    const { firebaseConfig } = await import("./firebase-config.js");
    const { initializeApp, getApp } = await import(
      "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"
    );
    const { getAuth, signInAnonymously, deleteUser } = await import(
      "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"
    );
    const {
      getFirestore,
      doc,
      getDoc,
      setDoc,
      deleteDoc,
      writeBatch,
      serverTimestamp,
    } = await import(
      "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-lite.js"
    );
    const denied = async (operation) => {
      try {
        await operation();
        return false;
      } catch (error) {
        if (error.code !== "permission-denied") throw error;
        return true;
      }
    };
    let consent = null,
      otherUser,
      owner,
      db,
      nativeRef;
    const collector = createCollector({
      store: {
        list: storage.listRecords,
        save: storage.saveRecord,
        delete: storage.deleteRecord,
      },
      cloud,
      consent: {
        get: () => consent,
        set: (value) => {
          consent = value;
        },
      },
    });
    const id = "synthetic-" + crypto.randomUUID();
    const base = {
      id,
      createdAt: new Date().toISOString(),
      sessionId: "synthetic-test",
      course: "",
      hole: null,
      surface: "unknown",
      image: "data:image/jpeg;base64,AA==",
      width: 1,
      height: 1,
      source: "synthetic-test",
      gps: null,
      orientation: null,
      estimate: { valid: false, reason: "synthetic" },
      terrainMeasured: false,
      cloudStatus: "local",
      photoPurpose: "surface-history-not-metric-reconstruction",
    };
    try {
      await collector.queueRecord({ ...base, id: id + "-no-consent" });
      await collector.syncPending();
      const before = (await storage.listRecords()).find(
        (record) => record.id === id + "-no-consent",
      );
      if (before.ownerUid)
        throw new Error("Network identity created before consent");
      collector.acceptConsent();
      await collector.queueRecord(base);
      await collector.syncPending({ forceRetry: true });
      const record = (await storage.listRecords()).find(
        (entry) => entry.id === id,
      );
      if (record.cloudStatus !== "uploaded")
        throw new Error(
          record.collectionError || "Synthetic upload not acknowledged",
        );
      const app = getApp();
      owner = getAuth(app).currentUser;
      db = getFirestore(app);
      const ref = doc(db, "users", record.ownerUid, "observations", record.id);
      const ownerReadDenied = await denied(() => getDoc(ref));
      const malformedDenied = await denied(() =>
        setDoc(ref, {
          schemaVersion: 2,
          ownerUid: owner.uid,
          metadata: record,
          image: record.image,
          status: "verified",
          consentVersion: "2026-09-27-v2",
          updatedAt: serverTimestamp(),
        }),
      );
      const other = initializeApp(firebaseConfig, "other-test");
      otherUser = (await signInAnonymously(getAuth(other))).user;
      const otherRef = doc(
        getFirestore(other),
        "users",
        owner.uid,
        "observations",
        id,
      );
      const crossUserReadDenied = await denied(() => getDoc(otherRef));
      const crossUserDeleteDenied = await denied(() => deleteDoc(otherRef));
      const crossUserWriteDenied = await denied(() =>
        setDoc(otherRef, {
          schemaVersion: 2,
          ownerUid: owner.uid,
          metadata: record,
          image: record.image,
          status: "collected",
          consentVersion: "2026-09-27-v2",
          updatedAt: serverTimestamp(),
        }),
      );
      nativeRef = doc(db, "users", owner.uid, "measurements", id);
      const native = {
        schemaVersion: 1,
        platform: "android",
        createdAt: new Date().toISOString(),
        consentVersion: "2026-09-27-native-v1",
        metadata: {
          accuracyValidated: false,
          measurementKind: "synthetic-test",
          points: [],
        },
      };
      await setDoc(nativeRef, native);
      await setDoc(nativeRef, { ...native, platform: "ios" }); // Idempotent replay/update.
      const nativeOwnerReadDenied = await denied(() => getDoc(nativeRef));
      const nativeVerifiedDenied = await denied(() =>
        setDoc(nativeRef, {
          ...native,
          metadata: { ...native.metadata, accuracyValidated: true },
        }),
      );
      await collector.revokeConsent({ deleteExisting: true });
      const deleted = (await storage.listRecords()).find(
        (entry) => entry.id === id,
      );
      const deleteAcknowledged =
        deleted.cloudStatus === "local" && !deleted.ownerUid;
      const observationMarker = doc(
        db,
        "users",
        owner.uid,
        "observationDeletions",
        id,
      );
      const latePhotoWriteDenied = await denied(() =>
        setDoc(ref, {
          schemaVersion: 2,
          ownerUid: owner.uid,
          metadata: record,
          image: record.image,
          status: "collected",
          consentVersion: "2026-09-27-v2",
          updatedAt: serverTimestamp(),
        }),
      );
      const markerReadDenied = await denied(() => getDoc(observationMarker));
      const markerDeleteDenied = await denied(() =>
        deleteDoc(observationMarker),
      );
      const markerPayloadDenied = await denied(() =>
        setDoc(observationMarker, { deleted: true, image: record.image }),
      );
      const nativeMarker = doc(
        db,
        "users",
        owner.uid,
        "measurementDeletions",
        id,
      );
      const nativeDeletion = writeBatch(db);
      nativeDeletion.set(nativeMarker, { deleted: true });
      nativeDeletion.delete(nativeRef);
      await nativeDeletion.commit();
      const lateNativeWriteDenied = await denied(() =>
        setDoc(nativeRef, native),
      );
      const nativeMarkerDeleteDenied = await denied(() =>
        deleteDoc(nativeMarker),
      );
      const crossUserMarkerWriteDenied = await denied(() =>
        setDoc(
          doc(
            getFirestore(other),
            "users",
            owner.uid,
            "observationDeletions",
            id,
          ),
          { deleted: true },
        ),
      );
      nativeRef = null;
      return {
        beforeConsentLocalOnly: !before.ownerUid,
        ownerReadDenied,
        malformedDenied,
        crossUserReadDenied,
        crossUserWriteDenied,
        crossUserDeleteDenied,
        nativeOwnerReadDenied,
        nativeVerifiedDenied,
        deleteAcknowledged,
        remainsRevoked: collector.getConsent().state === "revoked",
        latePhotoWriteDenied,
        lateNativeWriteDenied,
        markerReadDenied,
        markerDeleteDenied,
        markerPayloadDenied,
        nativeMarkerDeleteDenied,
        crossUserMarkerWriteDenied,
      };
    } finally {
      // Every created item is synthetic. Cleanup must succeed before dropping its auth handle.
      await collector.revokeConsent({ deleteExisting: true });
      if (nativeRef) {
        const batch = writeBatch(db);
        batch.set(doc(db, "users", owner.uid, "measurementDeletions", id), {
          deleted: true,
        });
        batch.delete(nativeRef);
        await batch.commit();
      }
      // Content-free { deleted: true } receipts intentionally remain under
      // synthetic account IDs; they prevent delayed writes from recreating data.
      for (const record of await storage.listRecords())
        await storage.deleteRecord(record.id);
      if (otherUser) await deleteUser(otherUser);
      if (owner) await deleteUser(owner);
    }
  });
  assert.deepEqual(results, {
    beforeConsentLocalOnly: true,
    ownerReadDenied: true,
    malformedDenied: true,
    crossUserReadDenied: true,
    crossUserWriteDenied: true,
    crossUserDeleteDenied: true,
    nativeOwnerReadDenied: true,
    nativeVerifiedDenied: true,
    deleteAcknowledged: true,
    remainsRevoked: true,
    latePhotoWriteDenied: true,
    lateNativeWriteDenied: true,
    markerReadDenied: true,
    markerDeleteDenied: true,
    markerPayloadDenied: true,
    nativeMarkerDeleteDenied: true,
    crossUserMarkerWriteDenied: true,
  });
  console.log(
    "PASS live Firebase: first consent, automatic private collection, owner/cross-user raw reads denied, cross-user mutations denied, native payload/replay accepted, false verified claims denied, atomic deletion receipts, late writes denied, revoke/delete and synthetic account cleanup (content-free receipts retained)",
  );
} finally {
  await context.close();
  await browser.close();
}
