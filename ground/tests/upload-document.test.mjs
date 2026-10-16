import test from "node:test";
import assert from "node:assert/strict";
import { recordRoute, buildUploadDocument } from "../upload-document.mjs";
const consent = { version: "2026-09-27-v2", grantId: "test-grant" };
const sample = {
  id: "one",
  source: "webxr-depth",
  createdAt: "2026-09-27T00:00:00Z",
  terrainMeasured: true,
  accuracyValidated: false,
  cloudStatus: "pending",
  ownerUid: "owner",
  measurement: { distanceM: 1.5, elevationM: 0.03 },
  points: [{ worldX: 1, worldY: 0.03, worldZ: 1 }],
  collectionConsent: consent,
};
test("actual WebXR observations route to metric collection without invented camera image", () => {
  const d = buildUploadDocument(sample, "owner", "timestamp");
  assert.deepEqual(recordRoute(sample), {
    collection: "measurements",
    deletions: "measurementDeletions",
  });
  assert.equal(d.platform, "webxr");
  assert.equal(d.metadata.accuracyValidated, false);
  assert.equal(d.metadata.measurement.elevationM, 0.03);
  assert.equal(d.metadata.image, undefined);
  assert.equal(d.metadata.ownerUid, undefined);
  assert.equal(d.metadata.cloudStatus, undefined);
});
test("missing real measurements and accuracy assertions cannot enter WebXR payload", () => {
  for (const altered of [
    { terrainMeasured: false },
    { accuracyValidated: true },
    { measurement: { distanceM: NaN, elevationM: 0 } },
    { points: [] },
    { points: Array(25).fill({}) },
    { collectionConsent: null },
  ])
    assert.throws(() =>
      buildUploadDocument({ ...sample, ...altered }, "owner", "at"),
    );
});
test("legacy photo records retain their original upload/deletion routes and limits", () => {
  const r = {
    id: "old",
    source: "live-camera",
    image: "data:image/jpeg;base64,AQ==",
    terrainMeasured: false,
    collectionConsent: consent,
  };
  assert.equal(recordRoute(r).collection, "observations");
  assert.equal(recordRoute(r).deletions, "observationDeletions");
  const d = buildUploadDocument(r, "owner", "at");
  assert.equal(d.schemaVersion, 2);
  assert.equal(d.updatedAt, "at");
  assert.equal(d.image, r.image);
});
