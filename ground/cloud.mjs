import { firebaseConfig } from "./firebase-config.js";
let pending;
export const cloudConfigured = Boolean(firebaseConfig?.projectId);
async function connection() {
  if (!cloudConfigured)
    throw new Error("서버 준비 중이에요. 기록은 기기에 보관됩니다.");
  if (!pending)
    pending = (async () => {
      // One-shot requests have no hidden offline write queue. Retry is user driven.
      const [
        { initializeApp },
        { getAuth, signInAnonymously },
        { getFirestore, doc, setDoc, deleteDoc, getDoc, serverTimestamp },
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
        deleteDoc,
        getDoc,
        serverTimestamp,
      };
    })().catch((e) => {
      pending = null;
      throw e;
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
    ref: c.doc(c.db, "users", user.uid, "observations", record.id),
  };
}
// The caller commits this identity and pending status before sending data.
export async function prepareUpload(record) {
  if (record.cloudStatus === "delete-pending")
    throw new Error("진행 중인 서버 삭제를 먼저 완료해 주세요.");
  return (await ownedConnection(record)).user.uid;
}
export async function uploadRecord(record) {
  const c = await ownedConnection(record, true);
  if (record.cloudStatus !== "pending")
    throw new Error("전송 상태를 기기에 먼저 저장해 주세요.");
  const { image, cloudStatus, ownerUid, ...metadata } = record;
  if (!image?.startsWith("data:image/jpeg;base64,") || image.length > 700000)
    throw new Error("전송 사진 크기 제한을 초과했어요.");
  await c.setDoc(c.ref, {
    schemaVersion: 2,
    ownerUid: c.user.uid,
    metadata,
    image,
    status: "collected",
    consentVersion: "2026-09-27-v1",
    updatedAt: c.serverTimestamp(),
  });
  return c.user.uid;
}
export async function readCloudRecord(record) {
  const c = await ownedConnection(record, true);
  return (await c.getDoc(c.ref)).exists();
}
export async function removeCloudRecord(record) {
  const c = await ownedConnection(record, true);
  await c.deleteDoc(c.ref);
}
