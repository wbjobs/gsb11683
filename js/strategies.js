'use strict';

// 每个策略接收 worker 返回的消息，产出 { node, cleanup, decodeMs, format, degraded }
// decodeMs 只统计可显式测量的解码耗时；<img> 方案的解码发生在渲染管线中，记为 0，
// 其代价通过长任务 / FPS 指标体现。

function makeFallbackNode(id) {
  const div = document.createElement('div');
  div.className = 'fallback';
  div.innerHTML = `<span>⚠ 解码失败</span><span>#${id} · 已降级为占位图</span>`;
  return div;
}

async function loadViaImgDecode(msg, id) {
  const url = URL.createObjectURL(msg.blob);
  const img = new Image();
  img.decoding = 'async';
  img.width = 320;
  img.height = 180;
  const t0 = performance.now();
  img.src = url;
  try {
    await img.decode();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return {
    node: img,
    decodeMs: performance.now() - t0,
    cleanup: () => {
      img.src = '';
      URL.revokeObjectURL(url);
    },
  };
}

const Strategies = {
  img: {
    label: '<img> 标签',
    mode: 'blob',
    async load(msg, id) {
      const url = URL.createObjectURL(msg.blob);
      const img = new Image();
      img.width = 320;
      img.height = 180;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('img onerror'));
        img.src = url;
      });
      return {
        node: img,
        decodeMs: 0,
        cleanup: () => {
          img.src = '';
          URL.revokeObjectURL(url);
        },
      };
    },
  },

  bitmap: {
    label: 'createImageBitmap',
    mode: 'bitmap',
    async load(msg, id) {
      if (msg.bitmap) {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        canvas.getContext('2d').drawImage(msg.bitmap, 0, 0);
        return {
          node: canvas,
          decodeMs: msg.decodeMs || 0,
          cleanup: () => msg.bitmap.close(),
        };
      }
      if (msg.bitmapFailed && msg.blob) {
        // 降级链：Worker 解码失败 → 主线程 img.decode() 再试一次
        const result = await loadViaImgDecode(msg, id);
        result.degraded = true;
        return result;
      }
      throw new Error(msg.error || 'bitmap decode failed');
    },
  },

  decode: {
    label: 'img.decode()',
    mode: 'blob',
    async load(msg, id) {
      return loadViaImgDecode(msg, id);
    },
  },
};
