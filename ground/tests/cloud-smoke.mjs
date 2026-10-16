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
      nativeRef,
      xrCleanupRecord;
    const restNativeIds = new Set();
    const documentPrefix =
      "projects/" + firebaseConfig.projectId + "/databases/(default)/documents";
    const restBase = "https://firestore.googleapis.com/v1/" + documentPrefix;
    const nativeDocument = (recordId) =>
      documentPrefix + "/users/" + owner.uid + "/measurements/" + recordId;
    const nativeMarkerDocument = (recordId) =>
      documentPrefix +
      "/users/" +
      owner.uid +
      "/measurementDeletions/" +
      recordId;
    const restPost = async (url, body) => {
      // Token stays only in browser memory / Authorization header, never URLs or logs.
      const token = await owner.getIdToken();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      await response.text();
      return response.status;
    };
    const restFields = (platform) => ({
      schemaVersion: { integerValue: "1" },
      platform: { stringValue: platform },
      createdAt: { stringValue: new Date().toISOString() },
      consentVersion: { stringValue: "2026-09-27-native-v1" },
      metadata: {
        mapValue: {
          fields: {
            accuracyValidated: { booleanValue: false },
            measurementKind: { stringValue: "synthetic-rest-test" },
            points: { arrayValue: { values: [] } },
          },
        },
      },
    });
    const removeRestNative = async (recordId) => {
      const status = await restPost(restBase + ":commit", {
        writes: [
          {
            update: {
              name: nativeMarkerDocument(recordId),
              fields: { deleted: { booleanValue: true } },
            },
          },
          { delete: nativeDocument(recordId) },
        ],
      });
      if (status !== 200)
        throw new Error("Synthetic REST atomic cleanup failed: HTTP " + status);
      return status;
    };
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
      // Exercise the real WebXR record route through the same durable collector.
      const xrBase = {
        id: "synthetic-webxr-" + crypto.randomUUID(),
        source: "webxr-depth",
        terrainMeasured: true,
        accuracyValidated: false,
        measurementKind: "synthetic-webxr-test",
        measurement: { distanceM: 1.5, elevationM: 0.03 },
        points: [
          { worldX: 1.5, worldY: 0.03, worldZ: 0 },
          { worldX: 1.25, worldY: 0.02, worldZ: 0.25 },
        ],
        course: "",
        hole: null,
        createdAt: new Date().toISOString(),
        cloudStatus: "local",
      };
      // Retain source + owner before the request, including lost acknowledgements.
      xrCleanupRecord = { ...xrBase, ownerUid: owner.uid };
      await collector.queueRecord(xrBase);
      await collector.syncPending({ forceRetry: true });
      const xrRecord = (await storage.listRecords()).find(
        (entry) => entry.id === xrBase.id,
      );
      const xrUploadAcknowledged =
        xrRecord?.cloudStatus === "uploaded" &&
        xrRecord.ownerUid === owner.uid &&
        xrRecord.collectionConsent?.version === "2026-09-27-v2";
      if (!xrUploadAcknowledged)
        throw new Error(
          xrRecord?.collectionError ||
            "WebXR collection upload not acknowledged",
        );
      xrCleanupRecord = xrRecord;
      const xrRef = doc(db, "users", owner.uid, "measurements", xrRecord.id);
      const xrOwnerReadDenied = await denied(() => getDoc(xrRef));
      await collector.deleteCollected(xrRecord.id);
      const xrDeleted = (await storage.listRecords()).find(
        (entry) => entry.id === xrRecord.id,
      );
      const xrDeleteAcknowledged =
        xrDeleted?.cloudStatus === "local" &&
        !xrDeleted.ownerUid &&
        Boolean(xrDeleted.collectionDeletedAt);
      const xrLateUploadDenied = await denied(() =>
        cloud.uploadRecord({ ...xrRecord, cloudStatus: "pending" }),
      );
      const xrMarker = doc(
        db,
        "users",
        owner.uid,
        "measurementDeletions",
        xrRecord.id,
      );
      const xrMarkerReadDenied = await denied(() => getDoc(xrMarker));
      const xrMarkerDeleteDenied = await denied(() => deleteDoc(xrMarker));
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

      // Exercise the actual native transport contracts, independently of SDK setDoc.
      const androidId = id + "-android-rest";
      const iosId = id + "-ios-rest";
      const androidBody = {
        writes: [
          {
            update: {
              name: nativeDocument(androidId),
              fields: restFields("android"),
            },
          },
        ],
      };
      const iosBody = { fields: restFields("ios") };
      const iosUrl =
        restBase +
        "/users/" +
        encodeURIComponent(owner.uid) +
        "/measurements?documentId=" +
        encodeURIComponent(iosId);
      restNativeIds.add(androidId); // Retain cleanup ownership before a request can leave.
      const androidStatus = await restPost(restBase + ":commit", androidBody);
      if (androidStatus !== 200)
        throw new Error("Android REST commit failed: HTTP " + androidStatus);
      restNativeIds.add(iosId);
      const iosStatus = await restPost(iosUrl, iosBody);
      if (iosStatus !== 200)
        throw new Error("iOS REST createDocument failed: HTTP " + iosStatus);
      const restAndroidCreated = androidStatus === 200;
      const restIosCreated = iosStatus === 200;
      await removeRestNative(androidId);
      await removeRestNative(iosId);
      const lateAndroidRestDenied =
        (await restPost(restBase + ":commit", androidBody)) === 403;
      const lateIosRestDenied = (await restPost(iosUrl, iosBody)) === 403;
      return {
        beforeConsentLocalOnly: !before.ownerUid,
        ownerReadDenied,
        malformedDenied,
        crossUserReadDenied,
        crossUserWriteDenied,
        crossUserDeleteDenied,
        nativeOwnerReadDenied,
        nativeVerifiedDenied,
        xrUploadAcknowledged,
        xrOwnerReadDenied,
        xrDeleteAcknowledged,
        xrLateUploadDenied,
        xrMarkerReadDenied,
        xrMarkerDeleteDenied,
        deleteAcknowledged,
        remainsRevoked: collector.getConsent().state === "revoked",
        latePhotoWriteDenied,
        lateNativeWriteDenied,
        markerReadDenied,
        markerDeleteDenied,
        markerPayloadDenied,
        nativeMarkerDeleteDenied,
        crossUserMarkerWriteDenied,
        restAndroidCreated,
        restIosCreated,
        lateAndroidRestDenied,
        lateIosRestDenied,
      };
    } finally {
      // Every created item is synthetic. Cleanup must succeed before dropping its auth handle.
      await collector.revokeConsent({ deleteExisting: true });
      // Retry WebXR cleanup even if a late write was unexpectedly accepted.
      if (xrCleanupRecord) await cloud.removeCloudRecord(xrCleanupRecord);
      if (nativeRef) {
        const batch = writeBatch(db);
        batch.set(doc(db, "users", owner.uid, "measurementDeletions", id), {
          deleted: true,
        });
        batch.delete(nativeRef);
        await batch.commit();
      }
      // Retry cleanup for every REST ID, even after a lost acknowledgement or
      // an unexpectedly accepted late write. Drop auth only after all succeed.
      for (const recordId of restNativeIds) await removeRestNative(recordId);
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
    xrUploadAcknowledged: true,
    xrOwnerReadDenied: true,
    xrDeleteAcknowledged: true,
    xrLateUploadDenied: true,
    xrMarkerReadDenied: true,
    xrMarkerDeleteDenied: true,
    deleteAcknowledged: true,
    remainsRevoked: true,
    latePhotoWriteDenied: true,
    lateNativeWriteDenied: true,
    markerReadDenied: true,
    markerDeleteDenied: true,
    markerPayloadDenied: true,
    nativeMarkerDeleteDenied: true,
    crossUserMarkerWriteDenied: true,
    restAndroidCreated: true,
    restIosCreated: true,
    lateAndroidRestDenied: true,
    lateIosRestDenied: true,
  });
  console.log(
    "PASS live Firebase: first consent, automatic private collection, owner/cross-user raw reads denied, cross-user mutations denied, native SDK and Android REST commit/iOS REST createDocument accepted, WebXR collector upload/private read/atomic delete/late-write denial verified, false verified claims denied, atomic deletion receipts, late writes denied, revoke/delete and synthetic account cleanup (content-free receipts retained)",
  );
} finally {
  await context.close();
  await browser.close();
}
