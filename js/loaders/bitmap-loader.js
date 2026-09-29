import { fetchBlobCached } from '../fetch-cache.js';

// 方案③：Web Worker 内 createImageBitmap 解码，ImageBitmap 转移回主线程画到 Canvas。
// 主线程零解码阻塞；Worker 失败时降级到主线程 createImageBitmap，再失败降级占位图。
export function createBitmapLoader({ metrics, cache }) {
  let worker = null;
  let seq = 0;
  const pending = new Map();

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('workers/bitmap-worker.js');
    worker.onmessage = (e) => {
      const { id, bitmap, decodeMs, error } = e.data;
      const p = pending.get(id);
      if (!p) { bitmap?.close(); return; }
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve({ bitmap, decodeMs });
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('worker error'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  }

  function decodeInWorker(blob, signal) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const onAbort = () => { pending.delete(id); reject(new DOMException('aborted', 'AbortError')); };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(id, { resolve, reject });
      ensureWorker().postMessage({ id, blob }); // 不 transfer：保留主线程兜底解码能力
    });
  }

  async function ensureBitmap(item, signal) {
    const cached = cache.get(item.id);
    if (cached) return { bitmap: cached, fetchMs: null, decodeMs: null };
    const { blob, fetchMs } = await fetchBlobCached(item.src, signal);
    let bitmap, decodeMs;
    try {
      ({ bitmap, decodeMs } = await decodeInWorker(blob, signal));
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // Worker 解码失败 -> 主线程兜底（损坏文件会在这里抛错，向上走占位图降级）
      const t = performance.now();
      bitmap = await createImageBitmap(blob);
      decodeMs = performance.now() - t;
    }
    cache.set(item.id, bitmap, bitmap.width * bitmap.height * 4);
    return { bitmap, fetchMs, decodeMs };
  }

  function drawToCanvas(bitmap) {
    const canvas = document.createElement('canvas');
    const boxW = 224, boxH = 160;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = boxW * dpr;
    canvas.height = boxH * dpr;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const ctx = canvas.getContext('2d');
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const w = bitmap.width * scale, h = bitmap.height * scale;
    ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    return canvas;
  }

  async function load(item, { signal } = {}) {
    const t0 = performance.now();
    const { bitmap, fetchMs, decodeMs } = await ensureBitmap(item, signal);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    metrics.record({ fetchMs, decodeMs, totalMs: performance.now() - t0 });
    return { node: drawToCanvas(bitmap) };
  }

  async function preload(item, { signal } = {}) {
    if (cache.get(item.id)) return;
    await ensureBitmap(item, signal).catch(() => {});
  }

  function dispose() {
    worker?.terminate();
    worker = null;
    pending.clear();
  }

  return { name: 'bitmap', load, preload, dispose };
}
