import { CONFIG } from './config.js';
import { Metrics } from './metrics.js';
import { LRUCache } from './lru.js';
import { VirtualList } from './virtual-list.js';
import { Preloader } from './preloader.js';
import { makePlaceholder } from './placeholder.js';
import { clearBlobs } from './db.js';
import { createImgLoader } from './loaders/img-loader.js';
import { createDecodeLoader } from './loaders/decode-loader.js';
import { createBitmapLoader } from './loaders/bitmap-loader.js';

const STRATEGY_DESC = {
  img: '原生 <img>：浏览器内部管线，加载/解码耗时不可拆分，大图解码易在滚动时掉帧。',
  decode: 'fetch + img.decode()：解码完成后再上屏，耗时精确可测，但解码仍在主线程。',
  bitmap: 'Worker 内 createImageBitmap：解码完全离开主线程，Canvas 上屏，滚动最稳。',
};

const metrics = new Metrics();
const viewport = document.getElementById('viewport');
const descEl = document.getElementById('strategy-desc');
const pressureHint = document.getElementById('memory-warning');

// 解码缓存（decode 方案存 objectURL，bitmap 方案存 ImageBitmap），
// 逐出即释放，内存不随滚动线性增长。
const cache = new LRUCache(CONFIG.lruMax, (value) => {
  if (typeof value === 'string') URL.revokeObjectURL(value);
  else value?.close?.();
});

const loaderFactories = {
  img: () => createImgLoader({ metrics }),
  decode: () => createDecodeLoader({ metrics, cache }),
  bitmap: () => createBitmapLoader({ metrics, cache }),
};

let currentName = null;
let currentLoader = null;
let generation = 0; // 方案切换时令牌失效，防止旧加载结果写入新列表
const itemStates = new Map(); // item.id -> { controller }

const preloader = new Preloader({
  getLoader: () => currentLoader,
  getVelocity: () => list.getVelocity(),
});

function attach(item, mediaEl) {
  const gen = generation;
  const controller = new AbortController();
  itemStates.set(item.id, { controller });
  currentLoader.load(item, { signal: controller.signal })
    .then(({ node }) => {
      if (gen !== generation || !mediaEl.isConnected) return;
      mediaEl.replaceChildren(node);
    })
    .catch((err) => {
      if (err?.name === 'AbortError') return;
      if (gen !== generation || !mediaEl.isConnected) return;
      metrics.recordFail();
      mediaEl.replaceChildren(makePlaceholder(item, err?.message || err));
    })
    .finally(() => {
      const s = itemStates.get(item.id);
      if (s?.controller === controller) itemStates.delete(item.id);
    });
}

function detach(item) {
  const s = itemStates.get(item.id);
  if (s) { s.controller.abort(); itemStates.delete(item.id); }
}

const list = new VirtualList({
  container: viewport,
  items: [],
  onAttach: attach,
  onDetach: detach,
  onRowNear: (rowIndex) => {
    const base = rowIndex * list.columns;
    preloader.enqueue(list.items.slice(base, base + list.columns));
  },
});

function switchStrategy(name) {
  if (name === currentName) return;
  generation++;
  preloader.clear();
  for (const [, s] of itemStates) s.controller.abort();
  itemStates.clear();
  currentLoader?.dispose();
  cache.clear();
  metrics.resetTimings();
  currentName = name;
  currentLoader = loaderFactories[name]();
  descEl.textContent = STRATEGY_DESC[name];
  document.querySelectorAll('#strategies button').forEach((b) =>
    b.classList.toggle('active', b.dataset.strategy === name));
  list.reset();
  pressureHint.hidden = true;
}

// 内存压力监控：超过阈值自动收缩解码缓存
setInterval(() => {
  const ratio = metrics.sampleMemory();
  if (ratio != null && ratio > CONFIG.memoryPressureRatio && cache.max !== CONFIG.lruMaxUnderPressure) {
    cache.setMax(CONFIG.lruMaxUnderPressure);
    pressureHint.hidden = false;
  }
  metrics.cacheInfo = { size: cache.size, bytes: cache.totalBytes };
  metrics.preloadInfo = preloader.info;
}, 500);

document.getElementById('btn-pressure').addEventListener('click', () => {
  cache.setMax(CONFIG.lruMaxUnderPressure);
  pressureHint.hidden = false;
});

document.getElementById('btn-clear-cache').addEventListener('click', async () => {
  await clearBlobs().catch(() => {});
  const name = currentName;
  currentName = null; // 强制重新走一遍切换流程，重新加载
  switchStrategy(name);
});

document.getElementById('strategies').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-strategy]');
  if (btn) switchStrategy(btn.dataset.strategy);
});

async function boot() {
  const res = await fetch(CONFIG.manifestUrl);
  list.items = await res.json();
  list.relayout();
  metrics.start();
  switchStrategy('img');
}

boot();
