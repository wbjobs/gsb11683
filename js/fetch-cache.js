import { getBlob, putBlob } from './db.js';

// 带 IndexedDB 缓存与计时的 fetch。加载耗时可量化对比。
export async function fetchBlobCached(url, signal) {
  const t0 = performance.now();
  let blob = null;
  let fromCache = false;
  try {
    blob = await getBlob(url);
    fromCache = !!blob;
  } catch { /* IDB 不可用则直接走网络 */ }
  if (!blob) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
    putBlob(url, blob).catch(() => {});
  }
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  return { blob, fetchMs: performance.now() - t0, fromCache };
}
