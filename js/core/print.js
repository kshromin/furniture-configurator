import { scene, camera, renderer } from './scene.js';
import { fmt } from './pricing.js';
import { getPrintData } from './order.js';

// Печать сметы с предпросмотром (задание «печать 19,07»): кнопка «Печать» на вкладке
// «Прорисовки» открывает модал-предпросмотр — белый лист со сметой (шапка проекта/клиента,
// снимок текущего 3D-вида, таблица прорисовок, итого). «Печать» в модале зовёт window.print();
// @media print в style.css прячет всё, кроме листа (класс printing на body на время печати),
// плюс у браузерного диалога печати есть свой родной предпросмотр.

// Полноразмерный снимок текущего 3D-вида. Свежий рендер прямо перед снятием кадра — тот же
// приём, что captureThumbnail в order.js (WebGL-канвас без preserveDrawingBuffer не гарантирует
// валидный буфер к произвольному моменту).
function captureViewImage() {
  try {
    renderer.render(scene, camera);
    const src = renderer.domElement;
    if (!src.width || !src.height) return null;
    return src.toDataURL('image/jpeg', 0.92);
  } catch {
    return null; // смета печатается и без картинки
  }
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function openPrintPreview() {
  const d = getPrintData();
  const kindLabel = d.kind === 'order' ? 'Заказ' : 'Проект';
  const head = d.code || d.title
    ? `${kindLabel}${d.code ? ' № ' + esc(d.code) : ''}${d.title ? ' — ' + esc(d.title) : ''}`
    : 'Смета';
  const date = new Date().toLocaleDateString('ru-RU');
  const clientLine = d.client && (d.client.name || d.client.phone || d.client.address)
    ? [d.client.name, d.client.phone, d.client.address].filter(Boolean).map(esc).join(', ')
    : '';
  const img = captureViewImage();

  const rows = d.items.map((it, i) => `
    <tr>
      <td class="print-num">${i + 1}</td>
      <td>${esc(it.label)}</td>
      <td class="print-price">${fmt(it.total)}</td>
    </tr>`).join('');

  document.getElementById('printSheet').innerHTML = `
    <div class="print-head">${head}</div>
    <div class="print-meta">${clientLine ? clientLine + ' · ' : ''}${date}</div>
    ${img ? `<img class="print-img" src="${img}" alt="">` : ''}
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
