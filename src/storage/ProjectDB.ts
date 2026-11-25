import { audioEngine } from '../audio/AudioEngine';
import { ProjectMeta } from '../state/types';

const DB_NAME = 'padbox-db-v1';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_SAMPLES = 'samples';

interface StoredSample {
  id: string;
  sampleRate: number;
  numberOfChannels: number;
  channels: ArrayBuffer[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SAMPLES)) {
        db.createObjectStore(STORE_SAMPLES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProjectMeta(meta: ProjectMeta): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      tx.objectStore(STORE_PROJECTS).put({ ...meta, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB saveProjectMeta failed:', err);
  }
}

export async function loadProjectMeta(id = 'default-project'): Promise<ProjectMeta | null> {
  try {
    const db = await openDB();
    return await new Promise<ProjectMeta | null>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).get(id);
      req.onsuccess = () => resolve((req.result as ProjectMeta | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB loadProjectMeta failed:', err);
    return null;
  }
}

export async function saveSampleBuffer(sampleId: string, buffer: AudioBuffer): Promise<void> {
  try {
    const channels: ArrayBuffer[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const copy = new Float32Array(buffer.getChannelData(ch));
      channels.push(copy.buffer);
    }
    const record: StoredSample = {
      id: sampleId,
      sampleRate: buffer.sampleRate,
      numberOfChannels: buffer.numberOfChannels,
      channels,
    };

    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SAMPLES, 'readwrite');
      tx.objectStore(STORE_SAMPLES).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB saveSampleBuffer failed:', err);
  }
}

export async function deleteSampleBuffer(sampleId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SAMPLES, 'readwrite');
      tx.objectStore(STORE_SAMPLES).delete(sampleId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB deleteSampleBuffer failed:', err);
  }
}

export async function loadSamplesForProject(sampleIds: string[]): Promise<number> {
  if (sampleIds.length === 0) return 0;
  try {
    const db = await openDB();
    const ctx = audioEngine.context;
    let loadedCount = 0;

    await Promise.all(
      sampleIds.map(
        (id) =>
          new Promise<void>((resolve) => {
            const tx = db.transaction(STORE_SAMPLES, 'readonly');
            const req = tx.objectStore(STORE_SAMPLES).get(id);
            req.onsuccess = () => {
              const rec = req.result as StoredSample | undefined;
              if (rec && rec.channels.length > 0) {
                const length = rec.channels[0].byteLength / 4;
                if (length > 0) {
                  const buf = ctx.createBuffer(rec.numberOfChannels, length, rec.sampleRate);
                  for (let ch = 0; ch < rec.numberOfChannels; ch++) {
                    buf.getChannelData(ch).set(new Float32Array(rec.channels[ch]));
                  }
                  audioEngine.setSample(id, buf);
                  loadedCount++;
                }
              }
              resolve();
            };
            req.onerror = () => resolve();
          })
      )
    );

    return loadedCount;
  } catch (err) {
    console.warn('IndexedDB loadSamplesForProject failed:', err);
    return 0;
  }
}

export async function clearAllStoredSamples(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SAMPLES, 'readwrite');
      tx.objectStore(STORE_SAMPLES).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB clearAllStoredSamples failed:', err);
  }
}
