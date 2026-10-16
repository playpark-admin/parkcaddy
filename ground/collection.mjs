/**
 * Durable, consent-gated collection. SDK calls use Firestore Lite: only this queue
 * retries writes. A successful response never changes the user's consent.
 */
export const COLLECTION_CONSENT_VERSION = "2026-09-27-v2";
const retryable = new Set(["local", "pending", "uncertain"]);
const clone = (value) => (value == null ? value : structuredClone(value));

export function createCollector({
  store,
  cloud,
  consent,
  lock = (work) => work(),
  onChange = () => {},
  now = () => Date.now(),
  newId = () => crypto.randomUUID(),
}) {
  let tail = Promise.resolve();
  let stopped = false;
  const changed = () => {
    try {
      Promise.resolve(onChange()).catch(() => {});
    } catch {
      /* UI does not govern durability. */
    }
  };
  const getConsent = () => clone(consent.get());
  const grantSequence = (value) =>
    Number.isSafeInteger(value?.grantSequence) && value.grantSequence >= 0
      ? value.grantSequence
      : 0;
  const retainedIntent = () => {
    const value = consent.get() || {};
    const result = { grantSequence: grantSequence(value) };
    if (
      Number.isSafeInteger(value.deleteThroughGrantSequence) &&
      value.deleteThroughGrantSequence >= 0
    ) {
      result.deleteThroughGrantSequence = value.deleteThroughGrantSequence;
      result.deletionRequestedAt = value.deletionRequestedAt;
    }
    return result;
  };
  const deletionRequested = (record) => {
    const cutoff = consent.get()?.deleteThroughGrantSequence;
    return (
      Number.isSafeInteger(cutoff) &&
      cutoff >= 0 &&
      Boolean(record.ownerUid || record.collectionConsent) &&
      grantSequence(record.collectionConsent) <= cutoff
    );
  };
  const accepted = () => {
    const value = consent.get();
    return value?.state === "accepted" &&
      value.version === COLLECTION_CONSENT_VERSION &&
      typeof value.grantId === "string"
      ? value
      : null;
  };
  const permitted = (record) => {
    const value = accepted();
    return (
      !stopped &&
      !deletionRequested(record) &&
      value &&
      record.collectionConsent?.grantId === value.grantId &&
      record.collectionConsent?.version === value.version
    );
  };
  const serial = (work) => {
    const result = tail.then(() => lock(work));
    tail = result.catch(() => {});
    return result;
  };
  const latest = async (id) =>
    (await store.list()).find((record) => record.id === id);
  const save = async (record) => {
    await store.save(record);
    changed();
    return record;
  };
  const cleanAfterDelete = (record) => {
    const next = {
      ...record,
      cloudStatus: "local",
      collectionDeletedAt: new Date(now()).toISOString(),
    };
    delete next.ownerUid;
    delete next.collectionConsent; // A deleted item never rejoins a future upload.
    delete next.collectionRetryAt;
    delete next.collectionAttempts;
    delete next.collectionError;
    return next;
  };
  const remove = async (record) => {
    if (!record.ownerUid) return save(cleanAfterDelete(record));
    const pending = await save({ ...record, cloudStatus: "delete-pending" });
    try {
      await cloud.removeCloudRecord(pending);
      return save(cleanAfterDelete(pending));
    } catch (error) {
      await save({
        ...pending,
        collectionError: String(error?.message || error).slice(0, 300),
      });
      throw error;
    }
  };
  async function send(record) {
    if (!permitted(record)) return;
    let pending = record;
    try {
      // Preserve the server path locally BEFORE starting the network write.
      const uid = record.ownerUid || (await cloud.prepareUpload(record));
      if (!permitted(record)) return;
      pending = await save({
        ...record,
        ownerUid: uid,
        cloudStatus: "pending",
        collectionAttempts: (record.collectionAttempts || 0) + 1,
      });
      if (!permitted(pending)) return;
      await cloud.uploadRecord(pending);
      const complete = { ...pending, cloudStatus: "uploaded" };
      delete complete.collectionRetryAt;
      delete complete.collectionError;
      await save(complete);
    } catch (error) {
      const next = {
        ...pending,
        cloudStatus: pending.ownerUid ? "uncertain" : "local",
        collectionRetryAt:
          now() +
          Math.min(
            300000,
            5000 * 2 ** Math.min(6, pending.collectionAttempts || 0),
          ),
        collectionError: String(error?.message || error).slice(0, 300),
      };
      await save(next);
    }
  }
  function acceptConsent() {
    const current = accepted();
    if (current) return clone(current);
    const intent = retainedIntent();
    const nextSequence =
      Math.max(intent.grantSequence, intent.deleteThroughGrantSequence ?? 0) +
      1;
    if (!Number.isSafeInteger(nextSequence))
      throw new Error("동의 기록을 갱신할 수 없습니다.");
    const value = {
      ...intent,
      state: "accepted",
      version: COLLECTION_CONSENT_VERSION,
      grantSequence: nextSequence,
      grantId: newId(),
      grantedAt: new Date(now()).toISOString(),
    };
    consent.set(value);
    changed();
    return clone(value);
  }
  function declineConsent() {
    const value = {
      ...retainedIntent(),
      state: "declined",
      version: COLLECTION_CONSENT_VERSION,
      changedAt: new Date(now()).toISOString(),
    };
    consent.set(value);
    changed();
    return clone(value);
  }
  async function queueRecord(record) {
    if (!record || typeof record.id !== "string")
      throw new Error("기록 번호가 필요합니다.");
    const existing = await latest(record.id);
    // Repeated UI events cannot discard a durable owner/deletion handle.
    if (
      existing?.ownerUid ||
      existing?.collectionConsent ||
      existing?.collectionDeletedAt
    ) {
      void syncPending().catch(() => {});
      return existing;
    }
    const value = accepted();
    const next = { ...(existing || record) };
    if (value && !stopped)
      next.collectionConsent = {
        version: value.version,
        grantSequence: grantSequence(value),
        grantId: value.grantId,
        grantedAt: value.grantedAt,
        capturedAt: new Date(now()).toISOString(),
      };
    await save(next);
    if (permitted(next)) void syncPending().catch(() => {});
    return next;
  }
  function syncPending({ forceRetry = false } = {}) {
    return serial(async () => {
      const records = await store.list();
      for (const snapshot of records) {
        const record = await latest(snapshot.id);
        if (!record) continue;
        if (
          record.cloudStatus === "delete-pending" ||
          deletionRequested(record)
        ) {
          // Deletion was explicitly authorized and must finish after consent withdrawal.
          try {
            await remove(record);
          } catch {
            /* The durable deletion handle remains. */
          }
        } else if (
          retryable.has(record.cloudStatus || "local") &&
          permitted(record) &&
          (forceRetry ||
            !record.collectionRetryAt ||
            record.collectionRetryAt <= now())
        ) {
          await send(record);
        }
      }
      return store.list();
    });
  }
  function revokeConsent({ deleteExisting = false } = {}) {
    // Synchronous state change prevents queued work (including other tabs) from
    // gaining permission while this tab waits for an in-flight write to finish.
    const intent = retainedIntent();
    const changedAt = new Date(now()).toISOString();
    if (deleteExisting) {
      // Persist the deletion boundary before waiting for an in-flight upload.
      // Keep it permanently: late acknowledgements or pre-crash writes from an
      // old grant must still be deleted. New grants receive a higher sequence.
      intent.deleteThroughGrantSequence = Math.max(
        intent.deleteThroughGrantSequence ?? 0,
        intent.grantSequence,
      );
      intent.deletionRequestedAt = changedAt;
    }
    consent.set({
      ...intent,
      state: "revoked",
      version: COLLECTION_CONSENT_VERSION,
      changedAt,
    });
    changed();
    if (!deleteExisting) return Promise.resolve();
    return serial(async () => {
      const failures = [];
      for (const record of await store.list()) {
        if (
          !deletionRequested(record) &&
          record.cloudStatus !== "delete-pending"
        )
          continue;
        try {
          await remove(record);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw new Error(
          "서버 삭제를 완료하지 못했습니다. 연결되면 다시 삭제합니다.",
        );
    });
  }
  function deleteCollected(id) {
    return serial(async () => {
      const record = await latest(id);
      if (record) return remove(record);
    });
  }
  return {
    acceptConsent,
    declineConsent,
    revokeConsent,
    queueRecord,
    syncPending,
    deleteCollected,
    getConsent,
    stop: () => {
      stopped = true;
    },
  };
}
