import { scene, camera, renderer } from './scene.js';
import { fmt } from './pricing.js';
import { getPrintData } from './order.js';

// Печать сметы с предпросмотром (задание «печать 19,07»): кнопка «Печать» на вкладке
// «Прорисовки» открывает модал-предпросмотр — белый лист со сметой (шапка проекта/клиента,
// снимок текущего 3D-вида, таблица прорисовок, итого). «Печать» в модале зовёт window.print();
// @media print в style.css прячет всё, кроме листа (класс printing на body на время печати),
// плюс у браузерного диалога печати есть свой родной предпросмотр.

// Полноразмерный снимок текущего 3D-вида, ровно как на экране (просьба 21.07): WebGL-канвас +
// размерный оверлей (#dimOverlay — стрелки в SVG и HTML-подписи, см. dimensions.js) вручную
// дорисовываются на общий канвас. html2canvas и прочие либы не тянем — элементов два вида и оба
// простые: сериализованный SVG со внесёнными в атрибуты стилями и прямоугольники с текстом.
// Свежий рендер прямо перед снятием кадра — тот же приём, что captureThumbnail в order.js.
async function captureViewImage() {
  try {
    renderer.render(scene, camera);
    const src = renderer.domElement;
    if (!src.width || !src.height) return null;
    const rect = src.getBoundingClientRect();
    const sx = src.width / rect.width, sy = src.height / rect.height; // device px / CSS px
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0);

    const overlay = document.getElementById('dimOverlay');
    if (overlay) {
      const oRect = overlay.getBoundingClientRect();
      // Стрелки: клон SVG с явными атрибутами вместо CSS-классов (сериализованный SVG внешние
      // стили не видит), в картинку через data-uri
      const svgEl = document.getElementById('dimArrowsSvg');
      if (svgEl && svgEl.childNodes.length) {
        const clone = svgEl.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', oRect.width);
        clone.setAttribute('height', oRect.height);
        clone.querySelectorAll('.dim-arrow-line').forEach(l => { l.setAttribute('stroke', '#8a92a6'); l.setAttribute('stroke-width', '1.2'); });
        clone.querySelectorAll('.dim-arrow-head').forEach(h => h.setAttribute('fill', '#8a92a6'));
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = res; img.onerror = rej;
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
        }).catch(() => {});
        if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, out.width, out.height);
      }
      // Подписи размеров: белые плашки с текстом, позиция/размер — по фактическим ректам
      overlay.querySelectorAll('.dim-label').forEach(label => {
        const r = label.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const x = (r.left - oRect.left) * sx, y = (r.top - oRect.top) * sy;
        const w = r.width * sx, h = r.height * sy;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeStyle = '#c8d0e0';
        ctx.lineWidth = sx;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 4 * sx);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#445';
        ctx.font = `600 ${Math.round(11 * sx)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label.textContent.trim(), x + w / 2, y + h / 2 + sx);
      });
    }
    return out.toDataURL('image/jpeg', 0.92);
  } catch {
    return null; // смета печатается и без картинки
  }
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function openPrintPreview() {
  const d = getPrintData();
  const kindLabel = d.kind === 'order' ? 'Заказ' : 'Проект';
  const head = d.code || d.title
    ? `${kindLabel}${d.code ? ' № ' + esc(d.code) : ''}${d.title ? ' — ' + esc(d.title) : ''}`
    : 'Смета';
  const date = new Date().toLocaleDateString('ru-RU');
  const clientLine = d.client && (d.client.name || d.client.phone || d.client.address)
    ? [d.client.name, d.client.phone, d.client.address].filter(Boolean).map(esc).join(', ')
    : '';
  const img = await captureViewImage();

  // Картинка соответствует одной позиции состава (просьба 21.07): подпись под изображением
  // + подсветка её строки в таблице. displayedIndex null — на экране несохранённая работа.
  const rows = d.items.map((it, i) => `
    <tr${d.displayedIndex === i + 1 ? ' class="print-row-shown"' : ''}>
      <td class="print-num">${i + 1}</td>
      <td>${esc(it.label)}</td>
      <td class="print-price">${fmt(it.total)}</td>
    </tr>`).join('');
  const caption = d.displayedIndex !== null
    ? `На изображении — позиция ${d.displayedIndex} (выделена в таблице)`
    : (d.items.length > 1 ? 'На изображении — текущий вид (не сохранён в состав)' : '');

  document.getElementById('printSheet').innerHTML = `
    <div class="print-head">${head}</div>
    <div class="print-meta">${clientLine ? clientLine + ' · ' : ''}${date}</div>
    ${img ? `<img class="print-img" src="${img}" alt="">` : ''}
    ${img && caption ? `<div class="print-caption">${caption}</div>` : ''}
    <table class="print-table">
      <thead><tr><th>№</th><th>Состав</th><th>Цена</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="print-total">Итого: ${fmt(d.grandTotal)}</div>
  `;
  document.getElementById('printOverlay').classList.add('visible');
}

export function closePrintPreview() {
  document.getElementById('printOverlay').classList.remove('visible');
}

export function bindPrint() {
  const overlay = document.getElementById('printOverlay');
  document.getElementById('printBtn').addEventListener('click', openPrintPreview);
  document.getElementById('printClose').addEventListener('click', closePrintPreview);
  overlay.addEventListener('click', e => { if (e.target === overlay) closePrintPreview(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) closePrintPreview();
  });
  document.getElementById('printDoPrint').addEventListener('click', () => {
    // Класс на body — печатается только лист (см. @media print в style.css). window.print()
    // блокирует до закрытия диалога печати, после — возвращаем приложение как было.
    document.body.classList.add('printing');
    try { window.print(); } finally { document.body.classList.remove('printing'); }
  });
}
