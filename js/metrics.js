'use strict';

const Metrics = (() => {
  const MAX_SAMPLES = 600;

  const stats = {
    img:    { label: '<img> 标签',        load: [], decode: [] },
    bitmap: { label: 'createImageBitmap', load: [], decode: [] },
    decode: { label: 'img.decode()',      load: [], decode: [] },
  };

  let frames = 0;
  let jankFrames = 0;
  let longTasks = 0;
  let errors = 0;
  let lastFrameTs = 0;
  let fps = 0;
  let fpsWindowStart = performance.now();

  function frameLoop(ts) {
    if (lastFrameTs && ts - lastFrameTs > 50) jankFrames++;
    lastFrameTs = ts;
    frames++;
    if (ts - fpsWindowStart >= 1000) {
      fps = Math.round((frames * 1000) / (ts - fpsWindowStart));
      frames = 0;
      fpsWindowStart = ts;
    }
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);

  try {
    new PerformanceObserver((list) => {
      longTasks += list.getEntries().length;
    }).observe({ entryTypes: ['longtask'] });
  } catch (err) { /* 浏览器不支持 longtask */ }

  function push(arr, v) {
    arr.push(v);
    if (arr.length > MAX_SAMPLES) arr.shift();
  }

  function avg(arr) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  function p95(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }

  function record(strategy, loadMs, decodeMs) {
    push(stats[strategy].load, loadMs);
    push(stats[strategy].decode, decodeMs);
  }

  function recordError() { errors++; }

  function reset() {
    for (const key of Object.keys(stats)) {
      stats[key].load.length = 0;
      stats[key].decode.length = 0;
    }
    jankFrames = 0;
    longTasks = 0;
    errors = 0;
  }

  function heapMB() {
    if (performance.memory) return performance.memory.usedJSHeapSize / 1048576;
    return null;
  }

  function heapPressure() {
    if (!performance.memory) return 0;
    return performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit;
  }

  function render(currentKey, extra) {
    document.getElementById('mStrategy').textContent = stats[currentKey].label;
    document.getElementById('mFps').textContent = fps;
    document.getElementById('mJank').textContent = jankFrames;
    document.getElementById('mLongtask').textContent = longTasks;
    const heap = heapMB();
    document.getElementById('mHeap').textContent = heap === null ? 'N/A' : heap.toFixed(1) + ' MB';
    document.getElementById('mImgMem').textContent = extra.imgMemMB.toFixed(1) + ' MB';
    document.getElementById('mLoaded').textContent = extra.loadedRows;
    document.getElementById('mCache').textContent = extra.cacheSize;
    document.getElementById('mErrors').textContent = errors;

    const tbody = document.querySelector('#compareTable tbody');
    tbody.innerHTML = '';
    for (const [key, s] of Object.entries(stats)) {
      const tr = document.createElement('tr');
      if (key === currentKey) tr.className = 'current';
      tr.innerHTML =
        `<td>${s.label}</td><td>${s.load.length}</td>` +
        `<td>${avg(s.load).toFixed(1)}ms</td>` +
        `<td>${avg(s.decode).toFixed(1)}ms</td>` +
        `<td>${p95(s.decode).toFixed(1)}ms</td>`;
      tbody.appendChild(tr);
    }
  }

  return { record, recordError, reset, render, heapPressure };
})();
