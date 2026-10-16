import test from "node:test";
import assert from "node:assert/strict";
import { createCollector, COLLECTION_CONSENT_VERSION } from "../collection.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function setup(overrides = {}) {
  const records = new Map(),
    calls = [];
  let value = null,
    time = Date.parse("2026-09-27T00:00:00Z"),
    sequence = 0;
  const store = {
    list: async () => structuredClone([...records.values()]),
    save: async (record) => {
      records.set(record.id, structuredClone(record));
      calls.push(["save", record.id, record.cloudStatus]);
    },
    delete: async (id) => records.delete(id),
  };
  const cloud = {
    prepareUpload: async (record) => {
      calls.push(["prepare", record.id]);
      return "owner-a";
    },
    uploadRecord: async (record) => {
      assert.equal(
        records.get(record.id).ownerUid,
        "owner-a",
        "owner must be durable before sending",
      );
      assert.equal(records.get(record.id).cloudStatus, "pending");
      calls.push(["upload", record.id]);
    },
    removeCloudRecord: async (record) => {
      calls.push(["remove", record.id]);
    },
    ...overrides,
  };
  const consent = {
    get: () => value,
    set: (next) => {
      value = structuredClone(next);
    },
  };
  const restart = (extra = {}) =>
    createCollector({
      store,
      cloud,
      consent,
      now: () => time,
      newId: () => "grant-" + ++sequence,
      ...extra,
    });
  const collector = restart();
  const record = (id) => ({
    id,
    createdAt: new Date(time).toISOString(),
    course: "",
    hole: null,
    image: "data:image/jpeg;base64,AA==",
    terrainMeasured: false,
    cloudStatus: "local",
  });
  return {
    collector,
    restart,
    store,
    records,
    calls,
    consent,
    record,
    tick: (ms) => {
      time += ms;
    },
  };
}

test("no collection before consent; initial acceptance does not sweep previous photos", async () => {
  const s = setup();
  await s.collector.queueRecord(s.record("before"));
  await s.collector.syncPending();
  assert.equal(
    s.calls.some(([kind]) => kind === "prepare"),
    false,
  );
  const grant = s.collector.acceptConsent();
  assert.equal(grant.version, COLLECTION_CONSENT_VERSION);
  assert.deepEqual(s.collector.acceptConsent(), grant, "accept is idempotent");
  await s.collector.syncPending();
  assert.equal(
    s.calls.some(([kind]) => kind === "upload"),
    false,
  );
  await s.collector.queueRecord(s.record("after"));
  await s.collector.syncPending();
  assert.equal(s.records.get("after").cloudStatus, "uploaded");
  assert.equal(s.records.get("before").cloudStatus, "local");
  assert.equal(s.calls.filter(([kind]) => kind === "upload").length, 1);
});

test("declined consent and wrong consent versions never start networking", async () => {
  const s = setup();
  s.collector.declineConsent();
  await s.collector.queueRecord(s.record("declined"));
  s.consent.set({ state: "accepted", version: "obsolete", grantId: "old" });
  await s.collector.queueRecord(s.record("obsolete"));
  await s.collector.syncPending();
  assert.equal(
    s.calls.some(([kind]) => ["prepare", "upload"].includes(kind)),
    false,
  );
});

test("lost acknowledgement retains owner path and retries idempotently after backoff", async () => {
  let attempts = 0;
  const s = setup({
    uploadRecord: async () => {
      if (++attempts === 1) throw new Error("response lost");
    },
  });
  s.collector.acceptConsent();
  await s.collector.queueRecord(s.record("retry"));
  await s.collector.syncPending();
  assert.equal(s.records.get("retry").cloudStatus, "uncertain");
  assert.equal(s.records.get("retry").ownerUid, "owner-a");
  assert.equal(attempts, 1, "immediate sync must respect backoff");
  s.tick(600000);
  await s.collector.syncPending();
  assert.equal(attempts, 2);
  assert.equal(s.records.get("retry").cloudStatus, "uploaded");
  assert.equal(s.calls.filter(([kind]) => kind === "prepare").length, 1);
});

test("withdrawal during authentication prevents the network write", async () => {
  const ready = deferred(),
    started = deferred();
  const s = setup({
    prepareUpload: async () => {
      started.resolve();
      return ready.promise;
    },
  });
  s.collector.acceptConsent();
  await s.collector.queueRecord(s.record("preparing"));
  await started.promise;
  await s.collector.revokeConsent();
  ready.resolve("owner-a");
  await s.collector.syncPending();
  assert.equal(s.records.get("preparing").ownerUid, undefined);
  assert.equal(
    s.calls.some(([kind]) => kind === "upload"),
    false,
  );
});

test("withdrawal during upload does not revive consent; new acceptance does not retry old grants", async () => {
  const ready = deferred(),
    started = deferred();
  let attempts = 0;
  const s = setup({
    uploadRecord: async () => {
      ++attempts;
      started.resolve();
      await ready.promise;
      throw new Error("lost acknowledgement");
    },
  });
  s.collector.acceptConsent();
  await s.collector.queueRecord(s.record("inflight"));
  await started.promise;
  await s.collector.revokeConsent();
  ready.resolve();
  await s.collector.syncPending();
  assert.equal(s.collector.getConsent().state, "revoked");
  assert.equal(s.records.get("inflight").cloudStatus, "uncertain");
  s.collector.acceptConsent();
  s.tick(600000);
  await s.collector.syncPending();
  assert.equal(attempts, 1);
});

test("withdraw-and-delete waits for in-flight upload and prevents resurrection", async () => {
  const ready = deferred(),
    started = deferred(),
    network = [];
  const s = setup({
    uploadRecord: async () => {
      network.push("upload-start");
      started.resolve();
      await ready.promise;
      network.push("upload-finish");
    },
    removeCloudRecord: async () => {
      network.push("delete");
    },
  });
  s.collector.acceptConsent();
  await s.collector.queueRecord(s.record("race"));
  await started.promise;
  const cleanup = s.collector.revokeConsent({ deleteExisting: true });
  assert.equal(
    s.collector.getConsent().state,
    "revoked",
    "revocation is immediate",
  );
  assert.deepEqual(network, ["upload-start"]);
  ready.resolve();
  await cleanup;
  await s.collector.syncPending();
  assert.deepEqual(network, ["upload-start", "upload-finish", "delete"]);
  assert.equal(s.records.get("race").ownerUid, undefined);
  assert.equal(s.records.get("race").collectionConsent, undefined);
  s.collector.acceptConsent();
  await s.collector.queueRecord(s.record("race"));
  await s.collector.syncPending();
  assert.deepEqual(network, ["upload-start", "upload-finish", "delete"]);
});

test("failed deletion keeps the handle and retries even after consent withdrawal", async () => {
  let attempts = 0;
  const s = setup({
    removeCloudRecord: async () => {
      if (++attempts === 1) throw new Error("offline");
    },
  });
  s.collector.acceptConsent();
  await s.collector.queueRecord(s.record("delete"));
  await s.collector.syncPending();
  await assert.rejects(
    s.collector.revokeConsent({ deleteExisting: true }),
    /서버 삭제/,
  );
  assert.equal(s.records.get("delete").cloudStatus, "delete-pending");
  assert.equal(s.records.get("delete").ownerUid, "owner-a");
  await s.collector.syncPending();
  assert.equal(attempts, 2);
  assert.equal(s.records.get("delete").ownerUid, undefined);
  assert.equal(s.records.get("delete").cloudStatus, "local");
});

test("duplicate capture events cannot overwrite uploaded ownership or send twice", async () => {
  const s = setup();
  s.collector.acceptConsent();
  const original = s.record("duplicate");
  await s.collector.queueRecord(original);
  await s.collector.syncPending();
  await s.collector.queueRecord(original);
  await s.collector.syncPending();
  assert.equal(s.records.get("duplicate").ownerUid, "owner-a");
  assert.equal(s.calls.filter(([kind]) => kind === "upload").length, 1);
});

test("explicit deletion serializes with uploads and never permits automatic recollection", async () => {
  const s = setup();
  s.collector.acceptConsent();
  await s.collector.queueRecord(s.record("explicit"));
  await s.collector.syncPending();
  await s.collector.deleteCollected("explicit");
  await s.collector.syncPending();
  assert.equal(s.calls.filter(([kind]) => kind === "remove").length, 1);
  assert.equal(s.records.get("explicit").collectionConsent, undefined);
});

test("a failed durable save prevents any remote upload", async () => {
  let writes = 0,
    value = null,
    record;
  const collector = createCollector({
    store: {
      list: async () => (record ? [structuredClone(record)] : []),
      save: async (next) => {
        if (next.ownerUid) throw new Error("disk full");
        record = structuredClone(next);
      },
    },
    cloud: {
      prepareUpload: async () => "owner-a",
      uploadRecord: async () => {
        ++writes;
      },
    },
    consent: {
      get: () => value,
      set: (next) => {
        value = next;
      },
    },
    newId: () => "disk-grant",
  });
  collector.acceptConsent();
  await collector.queueRecord({ id: "disk", cloudStatus: "local" });
  await collector.syncPending();
  assert.equal(writes, 0);
  assert.equal(record.ownerUid, undefined);
});

test("withdrawal and server-data deletion preserve unshared local photographs", async () => {
  const s = setup();
  await s.collector.queueRecord(s.record("private-local"));
  await s.collector.revokeConsent();
  assert.equal(s.records.size, 1);
  await s.collector.revokeConsent({ deleteExisting: true });
  assert.equal(s.records.size, 1);
  assert.equal(
    s.calls.some(([kind]) => ["prepare", "upload", "remove"].includes(kind)),
    false,
  );
});

test("delete intent survives process loss while upload acknowledgement is pending", async () => {
  const started = deferred(),
    unreturned = deferred();
  const network = [];
  const s = setup({
    uploadRecord: async (record) => {
      network.push(["upload", record.id]);
      started.resolve();
      await unreturned.promise; // Simulates an acknowledgement lost with the old process.
    },
    removeCloudRecord: async (record) => network.push(["remove", record.id]),
  });
  const originalGrant = s.collector.acceptConsent();
  await s.collector.queueRecord(s.record("crash-pending"));
  await started.promise;
  void s.collector.revokeConsent({ deleteExisting: true });
  assert.equal(
    s.consent.get().deleteThroughGrantSequence,
    originalGrant.grantSequence,
  );
  assert.equal(
    s.records.get("crash-pending").cloudStatus,
    "pending",
    "journal must exist before the upload allows serial cleanup to run",
  );
  const resumed = s.restart();
  await resumed.syncPending();
  assert.deepEqual(network, [
    ["upload", "crash-pending"],
    ["remove", "crash-pending"],
  ]);
  assert.equal(s.records.get("crash-pending").ownerUid, undefined);
  assert.equal(
    s.records.get("crash-pending").image,
    "data:image/jpeg;base64,AA==",
  );
});

test("re-consent keeps old deletion intent and exempts new photos even at the same clock time", async () => {
  const started = deferred(),
    unreturned = deferred();
  const network = [];
  const s = setup({
    uploadRecord: async (record) => {
      network.push(["upload", record.id]);
      if (record.id === "old") {
        started.resolve();
        await unreturned.promise;
      }
    },
    removeCloudRecord: async (record) => network.push(["remove", record.id]),
  });
  const oldGrant = s.collector.acceptConsent();
  await s.collector.queueRecord(s.record("old"));
  await started.promise;
  void s.collector.revokeConsent({ deleteExisting: true });
  const resumed = s.restart();
  const newGrant = resumed.acceptConsent();
  assert.ok(newGrant.grantSequence > oldGrant.grantSequence);
  assert.equal(newGrant.deleteThroughGrantSequence, oldGrant.grantSequence);
  await resumed.queueRecord(s.record("new"));
  await resumed.syncPending();
  assert.equal(s.records.get("old").ownerUid, undefined);
  assert.equal(s.records.get("new").cloudStatus, "uploaded");
  assert.deepEqual(
    network.filter(([kind]) => kind === "remove"),
    [["remove", "old"]],
  );
  // A later refusal must not drop the already persisted deletion boundary.
  resumed.declineConsent();
  assert.equal(
    resumed.getConsent().deleteThroughGrantSequence,
    oldGrant.grantSequence,
  );
});

test("legacy records without a grant sequence remain deletable after restart", async () => {
  const s = setup();
  s.consent.set({
    state: "accepted",
    version: COLLECTION_CONSENT_VERSION,
    grantId: "legacy",
  });
  await s.store.save({
    ...s.record("legacy"),
    ownerUid: "owner-a",
    cloudStatus: "uncertain",
    collectionConsent: {
      version: COLLECTION_CONSENT_VERSION,
      grantId: "legacy",
    },
  });
  // Hold the old instance before its serial work, then recreate it.
  const held = s.restart({ lock: () => new Promise(() => {}) });
  void held.revokeConsent({ deleteExisting: true });
  assert.equal(s.consent.get().deleteThroughGrantSequence, 0);
  const resumed = s.restart();
  const fresh = resumed.acceptConsent();
  assert.equal(fresh.grantSequence, 1);
  await resumed.syncPending();
  assert.equal(s.records.get("legacy").ownerUid, undefined);
});
