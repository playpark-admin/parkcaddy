import { firebaseConfig } from "./firebase-config.js";
import { recordRoute, buildUploadDocument } from "./upload-document.mjs";
let pending;
export const cloudConfigured = Boolean(firebaseConfig?.projectId);
async function connection() {
  if (!cloudConfigured)
    throw new Error("서버 준비 중이에요. 기록은 기기에 보관됩니다.");
  if (!pending)
    pending = (async () => {
      // Firestore Lite has no hidden offline queue. collection.mjs owns every retry.
      const [
        { initializeApp },
        { getAuth, signInAnonymously },
        { getFirestore, doc, setDoc, writeBatch, serverTimestamp },
      ] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"),
        import(
          "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-lite.js"
        ),
      ]);
      const app = initializeApp(firebaseConfig),
        auth = getAuth(app);
      return {
        auth,
        signInAnonymously,
        db: getFirestore(app),
        doc,
        setDoc,
        writeBatch,
        serverTimestamp,
      };
    })().catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}
async function ownedConnection(record, requireOwner = false) {
  if (
    !record ||
    typeof record.id !== "string" ||
    !/^[-_a-zA-Z0-9]{1,128}$/.test(record.id)
  )
    throw new Error("기록 번호가 올바르지 않아요.");
  const c = await connection();
  await c.auth.authStateReady();
  const user = c.auth.currentUser || (await c.signInAnonymously(c.auth)).user;
  if (
    (requireOwner && !record.ownerUid) ||
    (record.ownerUid && record.ownerUid !== user.uid)
  )
    throw new Error("처음 전송한 브라우저의 익명 계정으로 관리해 주세요.");
  return {
    ...c,
    user,
    ref: c.doc(
      c.db,
      "users",
      user.uid,
      recordRoute(record).collection,
      record.id,
    ),
  };
}
export async function prepareUpload(record) {
  if (record.cloudStatus === "delete-pending")
    throw new Error("진행 중인 서버 삭제를 먼저 완료해 주세요.");
  return (await ownedConnection(record)).user.uid;
}
export async function uploadRecord(record) {
  const c = await ownedConnection(record, true);
  if (record.cloudStatus !== "pending")
    throw new Error("전송 상태를 기기에 먼저 저장해 주세요.");
  await c.setDoc(
    c.ref,
    buildUploadDocument(record, c.user.uid, c.serverTimestamp()),
  );
  return c.user.uid;
}
// Raw observations are write/delete-only from client SDKs. Administrators use
// Firebase/Google Cloud IAM to inspect them; no client-side admin flag exists.
export async function removeCloudRecord(record) {
  const c = await ownedConnection(record, true);
  // A permanent content-free marker and raw deletion commit atomically.
  // Rules reject late writes, including requests from a process that exited.
  const marker = c.doc(
    c.db,
    "users",
    c.user.uid,
    recordRoute(record).deletions,
    record.id,
  );
  const batch = c.writeBatch(c.db);
  batch.set(marker, { deleted: true });
  batch.delete(c.ref);
  await batch.commit();
}
