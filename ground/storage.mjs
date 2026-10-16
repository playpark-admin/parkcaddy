const DB = "parkcaddy-ground-v2";
export function database() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("records", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function transaction(mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", mode),
      req = operation(tx.objectStore("records"));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("저장 취소"));
    };
  });
}
export const saveRecord = (record) =>
  transaction("readwrite", (s) => s.put(record));
export const listRecords = async () =>
  (await transaction("readonly", (s) => s.getAll())).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
export const deleteRecord = (id) =>
  transaction("readwrite", (s) => s.delete(id));
