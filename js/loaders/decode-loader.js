import { fetchBlobCached } from '../fetch-cache.js';

// 方案②：fetch + img.decode()。解码完成后再上屏，避免解码引发布局卡顿；
// 解码耗时精确可测，但 decode() 仍在主线程执行。
export function createDecodeLoader({ metrics, cache }) {
  function throwIfAborted(signal) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  }

  async function ensureUrl(item, signal) {
    const cached = cache.get(item.id);
    if (cached) return { url: cached, fetchMs: null };
    const { blob, fetchMs } = await fetchBlobCached(item.src, signal);
    throwIfAborted(signal);
    const url = URL.createObjectURL(blob);
    cache.set(item.id, url, blob.size);
    return { url, fetchMs };
  }

  async function decodeUrl(url, signal) {
    const img = new Image();
    img.src = url;
    const t0 = performance.now();
    await img.decode(); // 解码失败会 reject -> 走降级
    throwIfAborted(signal);
    return { img, decodeMs: performance.now() - t0 };
  }

  async function load(item, { signal } = {}) {
    const t0 = performance.now();
    const { url, fetchMs } = await ensureUrl(item, signal);
    const { img, decodeMs } = await decodeUrl(url, signal);
    img.alt = `img-${item.id}`;
    metrics.record({ fetchMs, decodeMs, totalMs: performance.now() - t0 });
    return { node: img };
  }

  async function preload(item, { signal } = {}) {
    if (cache.get(item.id)) return;
    const { url } = await ensureUrl(item, signal);
    await decodeUrl(url, signal).catch(() => {}); // 预加载失败不打扰，正式加载时再降级
  }

  return { name: 'decode', load, preload, dispose() {} };
}
