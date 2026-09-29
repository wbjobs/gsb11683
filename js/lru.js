// 解码结果 LRU 缓存：限制内存随滚动线性增长。
// 逐出时通过 onEvict 释放资源（ImageBitmap.close / URL.revokeObjectURL）。
export class LRUCache {
  constructor(max, onEvict) {
    this.max = max;
    this.onEvict = onEvict;
    this.map = new Map();
    this.totalBytes = 0;
  }
  get size() { return this.map.size; }
  get(key) {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }
  set(key, value, bytes = 0) {
    if (this.map.has(key)) this.remove(key);
    this.map.set(key, { value, bytes });
    this.totalBytes += bytes;
    while (this.map.size > this.max) {
      this.remove(this.map.keys().next().value);
    }
  }
  remove(key) {
    const entry = this.map.get(key);
    if (entry === undefined) return;
    this.map.delete(key);
    this.totalBytes -= entry.bytes;
    this.onEvict?.(entry.value, key);
  }
  setMax(max) {
    this.max = max;
    while (this.map.size > this.max) {
      this.remove(this.map.keys().next().value);
    }
  }
  clear() {
    for (const key of [...this.map.keys()]) this.remove(key);
  }
}
