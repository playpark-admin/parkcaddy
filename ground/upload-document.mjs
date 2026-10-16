import { COLLECTION_CONSENT_VERSION } from "./collection.mjs";
export function recordRoute(record) {
  return record.source === "webxr-depth"
    ? { collection: "measurements", deletions: "measurementDeletions" }
    : { collection: "observations", deletions: "observationDeletions" };
}
export function buildUploadDocument(record, uid, updatedAt) {
  if (
    record.collectionConsent?.version !== COLLECTION_CONSENT_VERSION ||
    typeof record.collectionConsent?.grantId !== "string"
  )
    throw Error("해당 관측 기록의 수집 동의가 필요합니다.");
  const {
    image,
    cloudStatus,
    ownerUid,
    collectionError,
    collectionRetryAt,
    collectionAttempts,
    collectionDeletedAt,
    ...metadata
  } = record;
  if (record.source === "webxr-depth") {
    if (
      record.terrainMeasured !== true ||
      record.accuracyValidated !== false ||
      !Number.isFinite(record.measurement?.distanceM) ||
      !Number.isFinite(record.measurement?.elevationM) ||
      !Array.isArray(record.points) ||
      record.points.length === 0 ||
      record.points.length > 24
    )
      throw Error("유효한 깊이 관측 자료가 필요합니다.");
    return {
      schemaVersion: 1,
      platform: "webxr",
      createdAt: record.createdAt,
      consentVersion: COLLECTION_CONSENT_VERSION,
      metadata,
    };
  }
  if (!image?.startsWith("data:image/jpeg;base64,") || image.length > 700000)
    throw Error("전송 사진 크기 제한을 초과했어요.");
  return {
    schemaVersion: 2,
    ownerUid: uid,
    metadata,
    image,
    status: "collected",
    consentVersion: COLLECTION_CONSENT_VERSION,
    updatedAt,
  };
}
