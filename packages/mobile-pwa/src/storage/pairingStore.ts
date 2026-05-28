import { PairedProfile } from "@/remote/client";

const DB_NAME = "crew44-mobile-pwa";
const DB_VERSION = 1;
const STORE_NAME = "pairing";
const PROFILE_KEY = "profile";
const PRIVATE_KEY = "devicePrivateKey";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open pairing storage"));
  });
}

async function readValue<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error || new Error("Could not read pairing storage"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function writeValues(values: Array<[string, unknown]>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const [key, value] of values) store.put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("Could not write pairing storage"));
    };
  });
}

async function deleteValues(keys: string[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("Could not clear pairing storage"));
    };
  });
}

export async function loadPairing(): Promise<{ profile: PairedProfile; privateKey: string } | null> {
  const [profile, privateKey] = await Promise.all([
    readValue<PairedProfile>(PROFILE_KEY),
    readValue<string>(PRIVATE_KEY)
  ]);
  if (!profile || !privateKey) return null;
  return { profile, privateKey };
}

export async function savePairing(profile: PairedProfile, privateKey: string): Promise<void> {
  await writeValues([
    [PROFILE_KEY, profile],
    [PRIVATE_KEY, privateKey]
  ]);
}

export async function clearPairing(): Promise<void> {
  await deleteValues([PROFILE_KEY, PRIVATE_KEY]);
}
