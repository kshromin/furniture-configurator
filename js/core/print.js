import { scene, camera, renderer } from './scene.js';
import { state, materials } from './state.js';
import { getColor } from './materials.js';
import { TYPES } from '../types/registry.js';
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

// Подпись под чертежом (правило 21.07): номер из сметы, тип, размер, цвет, профиль и цвет
// дверей — только то, что реально есть, ничего пустого/нулевого.
function drawingCaption(displayedIndex) {
  const parts = [];
  if (displayedIndex !== null) parts.push(`Позиция ${displayedIndex} из сметы`);
  const typeName = TYPES[state.type]?.name;
  if (typeName) parts.push(typeName);
  parts.push(`${state.width}×${state.height}×${state.depth} мм`);
  const k = getColor('korpus').name || '';
  const f = getColor('fasad').name || '';
  if (k && f && k !== f) parts.push(`корпус ${k}, фасад ${f}`);
  else if (k || f) parts.push(`цвет ${k || f}`);
  if (state.fasadDoorType === 'sliding') {
    const cat = materials.slidingDoor || {};
    const prof = (cat.profiles || []).find(p => p.id === state.profile)?.name;
    const pc = (cat.colors || []).find(c => c.id === state.profileColor)?.name;
    if (prof) parts.push(`профиль ${prof}${pc ? ', ' + pc.toLowerCase() : ''}`);
  }
  return parts.map(esc).join(' · ');
}

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

  // Картинка соответствует одной позиции состава (просьба 21.07): строка подсвечивается в
  // таблице, под чертежом — структурная подпись (номер/тип/размер/цвет/профиль, только что есть).
  const rows = d.items.map((it, i) => `
    <tr${d.displayedIndex === i + 1 ? ' class="print-row-shown"' : ''}>
      <td class="print-num">${i + 1}</td>
      <td>${esc(it.label)}</td>
      <td class="print-price">${fmt(it.total)}</td>
    </tr>`).join('');
  const caption = drawingCaption(d.displayedIndex);

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

  // «Сохранить в PDF» (задание «печать в файл 29,07») — сохранить смету файлом локально, а не
  // гонять через системный диалог печати. Лист сметы рендерит браузер (кириллица «из коробки»),
  // снимаем его html2canvas → кладём картинкой в jsPDF (у самого jsPDF без встроенного шрифта
  // кириллицы нет). Библиотеки грузим лениво по клику (в importmap, CDN).
  document.getElementById('printSavePdf').addEventListener('click', async e => {
    const btn = e.currentTarget;
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Готовим PDF…';
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const sheet = document.getElementById('printSheet');
      const canvas = await html2canvas(sheet, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);

      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const availW = pageW - margin * 2;
      const imgH = availW * canvas.height / canvas.width; // высота картинки в мм при ширине availW
      const usableH = pageH - margin * 2;

      // Одна страница или несколько: тайлим одну высокую картинку со сдвигом по Y.
      let heightLeft = imgH;
      let position = margin;
      pdf.addImage(imgData, 'JPEG', margin, position, availW, imgH);
      heightLeft -= usableH;
      while (heightLeft > 0) {
        position = margin - (imgH - heightLeft);
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', margin, position, availW, imgH);
        heightLeft -= usableH;
      }

      const d = getPrintData();
      const base = d.code || d.client?.name || 'смета';
      pdf.save(`Смета_${base}.pdf`);
    } catch (err) {
      console.error('save pdf failed:', err);
      window.alert('Не удалось сохранить PDF: ' + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  });
}
