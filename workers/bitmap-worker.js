// 在 Worker 线程中解码图片，主线程零解码阻塞。
self.onmessage = async (e) => {
  const { id, blob } = e.data;
  const t0 = performance.now();
  try {
    const bitmap = await createImageBitmap(blob);
    self.postMessage({ id, bitmap, decodeMs: performance.now() - t0 }, [bitmap]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
