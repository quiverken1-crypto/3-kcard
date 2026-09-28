/**
 * preloader.js — 进入游戏前预加载卡图、音效、背景音乐，显示进度；
 * 加载完成后对局中不再临时下载。可随时“先进入”，剩余资源在后台继续加载。
 */
import { CARD_IMAGES } from '../data/assetManifest.js';

export async function preloadAssets({ audio, onProgress } = {}) {
  const tasks = [];
  const add = (weight, label, run) => tasks.push({ weight, label, run });

  for (const src of CARD_IMAGES) {
    add(1, '卡图', () => new Promise(res => {
      const img = new Image();
      img.onload = img.onerror = () => res();
      img.src = src;
    }));
  }
  for (const t of audio?.preloadTasks?.() || []) add(t.weight, t.label, t.run);

  const total = tasks.reduce((s, t) => s + t.weight, 0) || 1;
  let done = 0;
  const report = (label) => onProgress?.({ ratio: Math.min(1, done / total), label });
  report(tasks[0]?.label || '');

  // 并发 6 个，先小后大（卡图、音效先完成，背景音乐最后）
  const queue = [...tasks].sort((a, b) => a.weight - b.weight);
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift();
      try { await t.run(); } catch { /* 单个失败不影响整体 */ }
      done += t.weight;
      report(queue[0]?.label || t.label);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  onProgress?.({ ratio: 1, label: '完成' });
}
