'use strict';

const DB_NAME = 'image-demo-cache';
const STORE = 'images';
const WIDTH = 320;
const HEIGHT = 180;
const FORMATS = ['image/webp', 'image/jpeg', 'image/png'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet(id) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    return null;
  }
}

async function idbPut(id, blob) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) { /* 缓存失败不阻塞主流程 */ }
}

function isCorrupt(id) {
  return id % 137 === 13; // 约 7 张损坏图，用于验证降级链路
}

async function generate(id) {
  const type = FORMATS[id % FORMATS.length];
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const hue = (id * 47) % 360;
  const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  grad.addColorStop(0, `hsl(${hue}, 70%, 45%)`);
  grad.addColorStop(1, `hsl(${(hue + 80) % 360}, 70%, 30%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 6; i++) {
    const x = ((id * 31 + i * 97) % WIDTH);
    const y = ((id * 17 + i * 53) % HEIGHT);
    ctx.beginPath();
    ctx.arc(x, y, 14 + ((id + i * 7) % 26), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`#${id}`, WIDTH / 2, HEIGHT / 2);

  const blob = await canvas.convertToBlob({ type, quality: 0.82 });

  if (isCorrupt(id)) {
    const buf = await blob.arrayBuffer();
    return new Blob([buf.slice(0, Math.floor(buf.byteLength / 3))], { type });
  }
  return blob;
}

async function getBlob(id) {
  const cached = await idbGet(id);
  if (cached) return { blob: cached, fromCache: true };
  const blob = await generate(id);
  idbPut(id, blob);
  return { blob, fromCache: false };
}

self.onmessage = async (e) => {
  const { reqId, id, mode } = e.data;
  try {
    const { blob, fromCache } = await getBlob(id);
    if (mode === 'bitmap') {
      const t0 = performance.now();
      try {
        const bitmap = await createImageBitmap(blob);
        const decodeMs = performance.now() - t0;
        self.postMessage(
          { reqId, id, bitmap, decodeMs, fromCache, format: blob.type },
          [bitmap]
        );
      } catch (bitmapErr) {
        // 解码失败：把原始 blob 一并送回，主线程走降级链路
        self.postMessage({
          reqId, id, blob, bitmapFailed: String(bitmapErr),
          fromCache, format: blob.type,
        });
      }
    } else {
      self.postMessage({ reqId, id, blob, fromCache, format: blob.type });
    }
  } catch (err) {
    self.postMessage({ reqId, id, error: String(err) });
  }
};
