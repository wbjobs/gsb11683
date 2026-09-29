'use strict';

const TOTAL = 1000;
const CACHE_LIMIT = 80;          // 预加载 LRU 上限，防止内存随滚动线性增长
const CACHE_LIMIT_PRESSURE = 20; // 内存压力下收缩
const PRELOAD_AHEAD = 10;

let currentKey = 'img';
let current = Strategies.img;
let token = 0;                   // 方案切换时令所有在途请求失效
let preloadEnabled = true;
let activeVisibleLoads = 0;
let lastScrollTop = 0;
let scrollDir = 1;

// ---------- Worker RPC ----------
const worker = new Worker('js/worker.js');
let reqSeq = 0;
const pending = new Map();

worker.onmessage = (e) => {
  const msg = e.data;
  const entry = pending.get(msg.reqId);
  if (!entry) {
    releaseMsg(msg); // 已无人等待（如方案切换后），立即释放
    return;
  }
  pending.delete(msg.reqId);
  if (msg.error) entry.reject(new Error(msg.error));
  else entry.resolve(msg);
};

function requestImage(id, mode) {
  const reqId = ++reqSeq;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    worker.postMessage({ reqId, id, mode });
  });
}

function releaseMsg(msg) {
  if (msg.bitmap) msg.bitmap.close();
}

// ---------- 预加载 LRU 缓存 ----------
const cache = new Map(); // id -> msg（保留插入顺序即 LRU 顺序）
const preloadPending = new Set();

function cacheGet(id) {
  const msg = cache.get(id);
  if (msg) {
    cache.delete(id);
    cache.set(id, msg); // 触碰，移到最新
  }
  return msg || null;
}

function cacheSet(id, msg) {
  if (cache.has(id)) cache.delete(id);
  cache.set(id, msg);
  trimCache();
}

function trimCache() {
  const limit = Metrics.heapPressure() > 0.7 ? CACHE_LIMIT_PRESSURE : CACHE_LIMIT;
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    releaseMsg(cache.get(oldest));
    cache.delete(oldest);
  }
}

function clearCache() {
  for (const msg of cache.values()) releaseMsg(msg);
  cache.clear();
  preloadPending.clear();
}

// ---------- 列表 ----------
const list = document.getElementById('list');
const rows = [];

function buildList() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < TOTAL; i++) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = i;
    row.innerHTML =
      `<div class="thumb"><span>#${i}</span></div>` +
      `<div class="meta"><div class="title">图片 #${i}</div><div class="detail">等待加载…</div></div>`;
    row._state = 'idle';
    row._cleanup = null;
    frag.appendChild(row);
    rows.push(row);
  }
  list.appendChild(frag);
}

function resetRow(row) {
  if (row._cleanup) { row._cleanup(); row._cleanup = null; }
  row._state = 'idle';
  const id = row.dataset.id;
  row.querySelector('.thumb').innerHTML = `<span>#${id}</span>`;
  row.querySelector('.detail').textContent = '等待加载…';
}

// ---------- 加载 ----------
async function loadRow(row) {
  if (row._state !== 'idle') return;
  row._state = 'loading';
  const id = Number(row.dataset.id);
  const myToken = token;
  activeVisibleLoads++;
  const t0 = performance.now();
  try {
    let msg = cacheGet(id);
    if (!msg) msg = await requestImage(id, current.mode);
    const result = await current.load(msg, id);
    if (myToken !== token || row._state !== 'loading') {
      result.cleanup();
      return;
    }
    // 加载完成时已滚出保留区：立即释放，避免内存滞留
    const rect = row.getBoundingClientRect();
    if (rect.bottom < -1000 || rect.top > window.innerHeight + 1000) {
      result.cleanup();
      resetRow(row);
      return;
    }
    row._state = 'loaded';
    row._cleanup = result.cleanup;
    row.querySelector('.thumb').replaceChildren(result.node);
    const totalMs = performance.now() - t0;
    const loadMs = Math.max(0, totalMs - result.decodeMs);
    Metrics.record(currentKey, loadMs, result.decodeMs);
    row.querySelector('.detail').textContent =
      `${msg.format || '?'} · 加载 ${loadMs.toFixed(1)}ms · 解码 ${result.decodeMs.toFixed(1)}ms` +
      (result.degraded ? ' · 已降级' : '') +
      (msg.fromCache ? ' · IDB缓存' : '');
  } catch (err) {
    if (myToken !== token) return;
    row._state = 'error';
    Metrics.recordError();
    row.querySelector('.thumb').replaceChildren(makeFallbackNode(id));
    row.querySelector('.detail').textContent = '解码失败，已降级为占位图';
  } finally {
    activeVisibleLoads--;
    schedulePreload();
  }
}

function unloadRow(row) {
  if (row._state === 'loaded' || row._state === 'error') resetRow(row);
  // loading 中的行由 loadRow 完成时的状态检查负责释放
}

// ---------- IntersectionObserver ----------
const loadIO = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) loadRow(entry.target);
  }
}, { rootMargin: '600px 0px' });

const unloadIO = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) unloadRow(entry.target);
  }
}, { rootMargin: '1000px 0px' });

function observeAll() {
  for (const row of rows) {
    loadIO.observe(row);
    unloadIO.observe(row);
  }
}

// ---------- 空闲预加载 ----------
let preloadScheduled = false;

function schedulePreload() {
  if (!preloadEnabled || preloadScheduled) return;
  preloadScheduled = true;
  const cb = () => {
    preloadScheduled = false;
    // 可见区域加载优先：可见加载较多时放弃本轮预加载
    if (activeVisibleLoads >= 3) return;
    const firstVisible = Math.max(0, Math.floor(window.scrollY / 220) - 1);
    const start = scrollDir >= 0
      ? firstVisible + 6
      : Math.max(0, firstVisible - PRELOAD_AHEAD);
    const count = scrollDir >= 0 ? PRELOAD_AHEAD : Math.min(PRELOAD_AHEAD, firstVisible);
    for (let i = 0; i < count; i++) {
      const id = start + i;
      if (id < 0 || id >= TOTAL) continue;
      if (cache.has(id) || preloadPending.has(id)) continue;
      const row = rows[id];
      if (row._state !== 'idle') continue;
      preloadPending.add(id);
      const myToken = token;
      requestImage(id, current.mode)
        .then((msg) => {
          if (myToken === token) cacheSet(id, msg);
          else releaseMsg(msg);
        })
        .catch(() => {})
        .finally(() => preloadPending.delete(id));
    }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(cb, { timeout: 300 });
  else setTimeout(cb, 100);
}

window.addEventListener('scroll', () => {
  const y = window.scrollY;
  scrollDir = y >= lastScrollTop ? 1 : -1;
  lastScrollTop = y;
  schedulePreload();
}, { passive: true });

// ---------- 方案切换 ----------
function switchStrategy(key) {
  if (!Strategies[key] || key === currentKey) return;
  token++; // 使所有在途请求失效
  currentKey = key;
  current = Strategies[key];
  clearCache();
  loadIO.disconnect();
  unloadIO.disconnect();
  for (const row of rows) resetRow(row);
  observeAll(); // observe 会立即回调当前可见行，触发重新加载
  document.querySelectorAll('.strategy-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.strategy === key);
  });
}

// ---------- 内存压力 ----------
setInterval(() => {
  if (Metrics.heapPressure() > 0.7) {
    // 收缩缓存，并卸载视口外的行
    trimCache();
    const firstVisible = Math.floor(window.scrollY / 220);
    for (let i = 0; i < TOTAL; i++) {
      if (Math.abs(i - firstVisible) > 30 && rows[i]._state === 'loaded') resetRow(rows[i]);
    }
  }
}, 2000);

// ---------- 指标刷新 ----------
setInterval(() => {
  let loadedRows = 0;
  for (const row of rows) if (row._state === 'loaded') loadedRows++;
  Metrics.render(currentKey, {
    loadedRows,
    cacheSize: cache.size,
    imgMemMB: (loadedRows + cache.size) * 320 * 180 * 4 / 1048576,
  });
}, 500);

// ---------- UI 绑定 ----------
document.querySelectorAll('.strategy-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchStrategy(btn.dataset.strategy));
});
document.getElementById('preloadToggle').addEventListener('change', (e) => {
  preloadEnabled = e.target.checked;
  if (!preloadEnabled) clearCache();
});
document.getElementById('resetStats').addEventListener('click', () => Metrics.reset());
document.getElementById('clearCache').addEventListener('click', () => {
  indexedDB.deleteDatabase('image-demo-cache');
});

// ---------- 启动 ----------
buildList();
observeAll();
