// 方案①：原生 <img>。浏览器内部管线，加载/解码耗时无法拆分，
// 大图解码发生在浏览器渲染流程中，容易在滚动时掉帧。
export function createImgLoader({ metrics }) {
  async function load(item, { signal } = {}) {
    const t0 = performance.now();
    const img = new Image();
    img.decoding = 'async';
    img.alt = `img-${item.id}`;
    await new Promise((resolve, reject) => {
      const onAbort = () => { img.src = ''; reject(new DOMException('aborted', 'AbortError')); };
      img.onload = resolve;
      img.onerror = () => reject(new Error('img load error'));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      img.src = item.src;
    });
    metrics.record({ fetchMs: null, decodeMs: null, totalMs: performance.now() - t0 });
    return { node: img };
  }

  async function preload(item) {
    // 仅预热浏览器 HTTP 缓存
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = item.src;
    });
  }

  return { name: 'img', load, preload, dispose() {} };
}
