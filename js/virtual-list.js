import { CONFIG } from './config.js';

// 虚拟列表：只渲染可视区 ± overscan 的行，DOM 节点数恒定，
// 媒体仅在更小的 attach 范围内加载，保证滚动不掉帧、内存不线性增长。
export class VirtualList {
  constructor({ container, items, onAttach, onDetach, onRowNear }) {
    this.container = container;
    this.items = items;
    this.onAttach = onAttach;
    this.onDetach = onDetach;
    this.onRowNear = onRowNear;
    this.rows = new Map(); // rowIndex -> { el, attached }
    this.columns = 1;
    this.rafPending = false;
    this.lastScrollTop = 0;
    this.lastScrollT = performance.now();
    this.velocity = 0;

    this.spacer = document.createElement('div');
    this.spacer.className = 'vl-spacer';
    container.appendChild(this.spacer);

    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) this.onRowNear(Number(e.target.dataset.row));
      }
    }, { root: container, rootMargin: CONFIG.preloadRootMargin });

    this.ro = new ResizeObserver(() => this.relayout());
    this.ro.observe(container);

    container.addEventListener('scroll', () => {
      const now = performance.now();
      const dt = now - this.lastScrollT;
      if (dt > 0) {
        const v = Math.abs(container.scrollTop - this.lastScrollTop) / dt;
        this.velocity = this.velocity * 0.7 + v * 0.3; // 平滑
      }
      this.lastScrollTop = container.scrollTop;
      this.lastScrollT = now;
      this.scheduleUpdate();
    }, { passive: true });

    this.relayout();
  }

  get rowHeight() { return CONFIG.cardHeight; }
  get rowCount() { return Math.ceil(this.items.length / this.columns); }

  relayout() {
    this.columns = Math.max(1, Math.floor(this.container.clientWidth / CONFIG.cardWidth));
    this.spacer.style.height = `${this.rowCount * this.rowHeight}px`;
    this.destroyAllRows();
    this.scheduleUpdate();
  }

  scheduleUpdate() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => { this.rafPending = false; this.update(); });
  }

  update() {
    const st = this.container.scrollTop;
    const vh = this.container.clientHeight;
    const firstVisible = Math.floor(st / this.rowHeight);
    const lastVisible = Math.ceil((st + vh) / this.rowHeight);
    const start = Math.max(0, firstVisible - CONFIG.overscanRows);
    const end = Math.min(this.rowCount - 1, lastVisible + CONFIG.overscanRows);
    const attachStart = Math.max(0, firstVisible - CONFIG.attachOverscanRows);
    const attachEnd = Math.min(this.rowCount - 1, lastVisible + CONFIG.attachOverscanRows);

    for (const [rowIndex, row] of [...this.rows]) {
      if (rowIndex < start || rowIndex > end) this.destroyRow(rowIndex, row);
    }
    for (let r = start; r <= end; r++) {
      if (!this.rows.has(r)) this.createRow(r);
      const row = this.rows.get(r);
      const shouldAttach = r >= attachStart && r <= attachEnd;
      if (shouldAttach && !row.attached) {
        row.attached = true;
        this.eachItem(r, (item, media) => this.onAttach(item, media));
      } else if (!shouldAttach && row.attached) {
        row.attached = false;
        this.eachItem(r, (item) => this.onDetach(item));
        this.resetRowMedia(r);
      }
    }
  }

  eachItem(rowIndex, fn) {
    const row = this.rows.get(rowIndex);
    if (!row) return;
    const base = rowIndex * this.columns;
    for (let c = 0; c < this.columns; c++) {
      const idx = base + c;
      if (idx >= this.items.length) break;
      fn(this.items[idx], row.mediaEls[c]);
    }
  }

  createRow(rowIndex) {
    const el = document.createElement('div');
    el.className = 'vl-row';
    el.dataset.row = rowIndex;
    el.style.top = `${rowIndex * this.rowHeight}px`;
    el.style.height = `${this.rowHeight}px`;
    const mediaEls = [];
    const base = rowIndex * this.columns;
    for (let c = 0; c < this.columns; c++) {
      const idx = base + c;
      if (idx >= this.items.length) break;
      const item = this.items[idx];
      const card = document.createElement('div');
      card.className = 'card';
      const media = document.createElement('div');
      media.className = 'media';
      media.appendChild(this.makeSkeleton());
      const label = document.createElement('div');
      label.className = 'label';
      const name = document.createElement('span');
      name.textContent = `#${item.id}`;
      const dim = document.createElement('span');
      dim.textContent = `${item.width}×${item.height}`;
      label.append(name, dim);
      card.append(media, label);
      el.appendChild(card);
      mediaEls.push(media);
    }
    this.rows.set(rowIndex, { el, mediaEls, attached: false });
    this.spacer.appendChild(el);
    this.io.observe(el);
  }

  destroyRow(rowIndex, row) {
    if (row.attached) this.eachItem(rowIndex, (item) => this.onDetach(item));
    this.io.unobserve(row.el);
    row.el.remove();
    this.rows.delete(rowIndex);
  }

  destroyAllRows() {
    for (const [rowIndex, row] of [...this.rows]) this.destroyRow(rowIndex, row);
  }

  resetRowMedia(rowIndex) {
    const row = this.rows.get(rowIndex);
    if (!row) return;
    for (const media of row.mediaEls) media.replaceChildren(this.makeSkeleton());
  }

  makeSkeleton() {
    const s = document.createElement('div');
    s.className = 'skeleton';
    return s;
  }

  getVelocity() { return this.velocity; }

  reset() {
    this.destroyAllRows();
    this.scheduleUpdate();
  }
}
