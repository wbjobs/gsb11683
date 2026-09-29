// 解码失败降级占位图
export function makePlaceholder(item, reason) {
  const el = document.createElement('div');
  el.className = 'placeholder';
  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.textContent = '⚠';
  const text = document.createElement('div');
  text.textContent = `解码失败 #${item.id}`;
  const detail = document.createElement('div');
  detail.style.cssText = 'font-size:10px;color:#a06';
  detail.textContent = String(reason).slice(0, 40);
  el.append(icon, text, detail);
  return el;
}
