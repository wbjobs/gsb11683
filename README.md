# 1000 张图片加载方案性能对比

纯原生 Web 技术（无框架）实现的图片列表性能实验台，对比三种加载/解码方案：

| 方案 | 管线 | 解码位置 | 特点 |
|------|------|----------|------|
| ① `img` 标签 | 浏览器内部 | 浏览器渲染流程 | 基线；加载/解码耗时不可拆分，大图易掉帧 |
| ② `img.decode()` | fetch → decode → 上屏 | 主线程 | 解码完成再上屏，耗时精确可测 |
| ③ `createImageBitmap` | fetch → Worker 解码 → Canvas | **Web Worker** | 主线程零解码阻塞，滚动最稳 |

## 运行

```bash
# 1. 生成 1000 张测试图（已生成可跳过，约 465MB）
node tools/gen-images.mjs

# 2. 启动静态服务器（必须通过 HTTP 访问，file:// 无法使用 Worker/模块）
python3 -m http.server 8000
# 或 npx serve .

# 3. 打开 http://localhost:8000 （推荐 Chrome，内存指标依赖 performance.memory）
```

## 功能

- **虚拟列表**：只渲染可视区 ± 6 行骨架，媒体仅在 ± 2 行内加载，DOM 节点数恒定
- **懒加载**：按行进入 attach 范围才发起加载，离屏即 AbortController 取消
- **预加载**：IntersectionObserver（rootMargin 200%）+ requestIdleCallback 空闲调度；
  滚动速度超过阈值自动暂停，不拖慢当前可视区
- **内存控制**：解码结果 LRU 缓存（默认 60 项），逐出即 `ImageBitmap.close()` /
  `URL.revokeObjectURL()`；JS 堆超阈值自动收缩，也可手动"模拟内存压力"
- **失败降级**：解码失败 → 占位图（#13 / #377 / #888 为内置损坏样本）；
  Worker 解码失败 → 主线程 `createImageBitmap` 兜底 → 再失败才降级占位
- **方案切换**：代际令牌 + 全量 abort + 缓存清理，快速连切不崩
- **IndexedDB**：图片 Blob 持久缓存，二次加载网络耗时≈0（可一键清空）

## 指标面板

FPS（当前 / 1% 低）、长任务次数与总阻塞（PerformanceObserver longtask）、
加载/解码/端到端耗时 avg/p95、JS 堆内存、解码缓存占用、已加载/失败数、预加载队列。

## 目录结构

```
index.html            入口
css/style.css         样式
js/main.js            启动、方案切换、内存压力监控
js/virtual-list.js    虚拟列表（窗口化渲染 + IntersectionObserver）
js/preloader.js       空闲预加载调度器
js/metrics.js         FPS / 长任务 / 内存 / 耗时统计
js/lru.js             解码结果 LRU 缓存
js/db.js              IndexedDB Blob 缓存
js/fetch-cache.js     带缓存与计时的 fetch
js/loaders/           三种加载方案
workers/bitmap-worker.js  Worker 内 createImageBitmap 解码
tools/gen-images.mjs  测试图生成器（Node 内置 zlib，无依赖）
```
