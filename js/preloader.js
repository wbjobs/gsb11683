import { CONFIG } from './config.js';

// 预加载调度器：空闲时低优先级提前解码，滚动过快时自动暂停，
// 保证预加载不拖慢当前可视区图片。
export class Preloader {
  constructor({ getLoader, getVelocity }) {
    this.getLoader = getLoader;
    this.getVelocity = getVelocity;
    this.queue = [];
    this.queued = new Set();
    this.active = 0;
    this.generation = 0;
    this.pumping = false;
  }

  enqueue(items) {
    for (const item of items) {
      if (this.queued.has(item.id)) continue;
      this.queued.add(item.id);
      this.queue.push(item);
    }
    this.pump();
  }

  pump() {
    if (this.pumping) return;
    this.pumping = true;
    const idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 16 }), 32));
    const step = async () => {
      const gen = this.generation;
      while (this.queue.length && this.active < CONFIG.preloadConcurrency) {
        if (gen !== this.generation) break;
        // 滚动过快 -> 让路给可视区加载
        if (this.getVelocity() > CONFIG.scrollVelocityPause) break;
        const item = this.queue.shift();
        this.queued.delete(item.id);
        this.active++;
        const loader = this.getLoader();
        loader.preload(item)
          .catch(() => {})
          .finally(() => { this.active--; this.pump(); });
      }
      this.pumping = false;
      if (this.queue.length && this.active < CONFIG.preloadConcurrency) {
        idle(() => this.pump());
      }
    };
    idle(step);
  }

  clear() {
    this.generation++;
    this.queue.length = 0;
    this.queued.clear();
  }

  get info() { return { queued: this.queue.length, active: this.active }; }
}
