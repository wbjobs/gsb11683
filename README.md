# 1000 张图片列表 · 加载/解码方案性能对比

零依赖、无框架的纯前端 Demo，对比三种图片加载解码方案在超长列表下的表现。

## 运行

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

需要支持模块 Worker / OffscreenCanvas 的现代浏览器（推荐 Chrome，内存指标仅 Chrome 提供）。

## 三种方案

| 方案 | 解码位置 | 说明 |
| --- | --- | --- |
| `<img>` 标签 | 主线程渲染管线 | 最简单，解码耗时无法直接测量，体现为长任务/掉帧 |
| `createImageBitmap` | Web Worker | 解码完全离主线程，结果绘制到 `<canvas>` |
| `img.decode()` | 主线程（异步） | 显式等待解码完成再插入 DOM，避免渲染期卡顿 |

## 设计要点

- **图片源**：Worker 内用 `OffscreenCanvas` 程序化生成 1000 张图（webp/jpeg/png 混合），写入 IndexedDB 缓存，离线可重复测试。
- **懒加载**：`IntersectionObserver`（rootMargin 600px）触发加载；第二个 Observer（1000px）在行滚出后释放 ImageBitmap / ObjectURL，内存不随滚动线性增长。
- **预加载**：`requestIdleCallback` 空闲时沿滚动方向预取 10 张进 LRU 缓存（上限 80，内存压力下收缩到 20）；可见区域加载并发 ≥3 时自动放弃本轮预加载，不拖慢当前图片。
- **降级链**：`createImageBitmap` 失败 → 主线程 `img.decode()` 重试 → 仍失败则渲染占位图。每 137 张有 1 张损坏图用于验证。
- **方案切换**：token 失效机制让所有在途请求作废并释放资源，清空缓存后重新 observe，不会崩溃或泄漏。
- **指标**：FPS（rAF）、掉帧、长任务（`PerformanceObserver` longtask）、JS Heap（`performance.memory`）、解码内存估算、加载/解码耗时 avg/p95。

## 文件结构

- `index.html` / `styles.css` — 页面与样式
- `js/worker.js` — 图片生成、IndexedDB 缓存、`createImageBitmap` 解码
- `js/strategies.js` — 三种加载策略与降级链
- `js/metrics.js` — FPS / 长任务 / 统计聚合
- `js/main.js` — 列表、Observer、预加载 LRU、方案切换
