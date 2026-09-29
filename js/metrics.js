import { CONFIG } from './config.js';

// 指标采集：FPS(rAF)、长任务(PerformanceObserver)、内存、加载/解码耗时。
export class Metrics {
  constructor() {
    this.frameDeltas = [];
    this.lastFrameT = 0;
    this.longTaskCount = 0;
    this.longTaskTotal = 0;
    this.timings = { fetch: [], decode: [], total: [] };
    this.loadedCount = 0;
    this.failCount = 0;
    this.memoryMB = null;
    this.memoryLimitMB = null;
    this.cacheInfo = { size: 0, bytes: 0 };
    this.preloadInfo = { queued: 0, active: 0 };
    this.rafId = 0;
    this.els = Object.fromEntries(
      ['fps', 'longtask', 'fetch', 'decode', 'total', 'memory', 'cache', 'count', 'preload']
        .map((k) => [k, document.getElementById(`m-${k}`)])
    );
  }

  start() {
    const loop = (t) => {
      if (this.lastFrameT) {
        this.frameDeltas.push(t - this.lastFrameT);
        if (this.frameDeltas.length > 600) this.frameDeltas.shift();
      }
      this.lastFrameT = t;
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);

    if ('PerformanceObserver' in window) {
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            this.longTaskCount++;
            this.longTaskTotal += e.duration;
          }
        }).observe({ entryTypes: ['longtask'] });
      } catch { /* 不支持 longtask 时忽略 */ }
    }

    this.timer = setInterval(() => this.render(), 500);
  }

  record({ fetchMs, decodeMs, totalMs }) {
    const push = (arr, v) => {
      if (v == null) return;
      arr.push(v);
      if (arr.length > CONFIG.statsWindow) arr.shift();
    };
    push(this.timings.fetch, fetchMs);
    push(this.timings.decode, decodeMs);
    push(this.timings.total, totalMs);
    this.loadedCount++;
  }

  recordFail() { this.failCount++; }

  resetTimings() {
    this.timings = { fetch: [], decode: [], total: [] };
    this.loadedCount = 0;
    this.failCount = 0;
    this.longTaskCount = 0;
    this.longTaskTotal = 0;
  }

  sampleMemory() {
    if (performance.memory) {
      this.memoryMB = performance.memory.usedJSHeapSize / 1048576;
      this.memoryLimitMB = performance.memory.jsHeapSizeLimit / 1048576;
      return this.memoryMB / this.memoryLimitMB;
    }
    return null;
  }

  render() {
    this.sampleMemory();
    const recent = this.frameDeltas.filter((_, i, a) => i >= a.length - 120);
    const avg = recent.length ? recent.reduce((s, v) => s + v, 0) / recent.length : 0;
    const sorted = [...recent].sort((a, b) => b - a);
    const low1 = sorted.length ? sorted[Math.max(0, Math.floor(sorted.length * 0.01) - 1)] || sorted[0] : 0;
    this.els.fps.textContent = avg ? `${Math.round(1000 / avg)} / ${Math.round(1000 / Math.max(low1, 0.01))}` : '–';
    this.els.longtask.textContent = `${this.longTaskCount} 次 / ${this.longTaskTotal.toFixed(0)} ms`;

    const stat = (arr) => {
      if (!arr.length) return '–';
      const a = arr.reduce((s, v) => s + v, 0) / arr.length;
      const s = [...arr].sort((x, y) => x - y);
      const p = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
      return `${a.toFixed(1)} / ${p.toFixed(1)} ms`;
    };
    this.els.fetch.textContent = stat(this.timings.fetch);
    this.els.decode.textContent = stat(this.timings.decode);
    this.els.total.textContent = stat(this.timings.total);
    this.els.memory.textContent = this.memoryMB != null
      ? `${this.memoryMB.toFixed(0)} / ${this.memoryLimitMB.toFixed(0)} MB` : '不支持';
    this.els.cache.textContent = `${this.cacheInfo.size} 项 / ~${(this.cacheInfo.bytes / 1048576).toFixed(1)} MB`;
    this.els.count.textContent = `${this.loadedCount} / ${this.failCount}`;
    this.els.preload.textContent = `排队 ${this.preloadInfo.queued} / 进行 ${this.preloadInfo.active}`;
  }
}
