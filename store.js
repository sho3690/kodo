// Keeps the imported numbers in this browser's own storage (IndexedDB). Nothing is sent anywhere.
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open('kodo', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => {
  const db = await open();
  try {
    return await new Promise((res, rej) => {
      const t = db.transaction('kv', mode);
      const q = fn(t.objectStore('kv'));
      t.oncomplete = () => res(q.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  } finally { db.close(); }
};
export const loadData = () => tx('readonly', s => s.get('data')).catch(() => null);
export const saveData = data => tx('readwrite', s => s.put(data, 'data'));
export const clearData = () => tx('readwrite', s => s.delete('data'));
