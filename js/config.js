export const CONFIG = {
  manifestUrl: 'images/manifest.json',
  cardWidth: 240,
  cardHeight: 210,
  overscanRows: 6,        // 骨架行过扫描（结构渲染范围）
  attachOverscanRows: 2,  // 媒体真正加载的范围
  lruMax: 60,             // 解码缓存上限（项）
  lruMaxUnderPressure: 16,
  memoryPressureRatio: 0.7, // usedJSHeapSize / jsHeapSizeLimit 超过则收缩
  preloadRootMargin: '200% 0px',
  preloadConcurrency: 2,
  scrollVelocityPause: 1.2, // px/ms，超过则暂停预加载
  statsWindow: 120,
};
