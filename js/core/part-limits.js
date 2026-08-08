// Проверка деталей по габаритам ЛИСТА материала (задание «макс размер детали 5,08»).
//
// В каталоге у материала «Длинна, мм» / «Ширина, мм» — это габарит ЛИСТА, как он приходит от
// поставщика (решение пользователя 8.08). Деталь всегда меньше листа на ОБЗОЛ — кромку листа,
// которая уходит в рез: SAW_TRIM миллиметров с каждой стороны листа по каждой оси.
// Габариты не заведены (пусто) = ограничения нет, деталь не проверяется.
//
// Реакция — ПРЕДУПРЕЖДЕНИЕ, а не запрет: шкаф собирают из деталей разных материалов, и зажимать
// общий габарит шкафа по самому мелкому листу нельзя — деталь можно и сострить, и заменить
// материал. Поэтому проблемные детали показываются списком, а размеры остаются какими заданы.
//
// Собирается по ходу сборки сцены: addPanel() зовёт checkPart() на каждую деталь, build.js
// открывает сборку beginParts() и закрывает reportParts() — как beginFrame/releaseUnused у текстур.
import { showToast } from './toast.js';

export const SAW_TRIM = 10;   // мм — обзол при пилении: деталь не может быть в размер листа

let issues = null;      // ключ «материал|длина×ширина» → {name, long, short, maxL, maxW, count}
let lastSignature = ''; // чтобы не показывать тост на каждую перестройку сцены

/** Начало сборки: список проблемных деталей копится заново. */
export function beginParts() {
  issues = new Map();
}

/** Деталь из материала `color` размером w×h×d (мм; толщина — наименьшая из трёх).
 *  Вызывается из addPanel(); материалы без габаритов листа и не-каталожные цвета пропускаются. */
export function checkPart(w, h, d, color) {
  if (!issues || !color || typeof color !== 'object') return;
  const sheet = [Number(color.maxPartL) || 0, Number(color.maxPartW) || 0];
  if (!sheet[0] || !sheet[1]) return;             // габариты листа не заведены
  const maxL = Math.max(...sheet) - SAW_TRIM;
  const maxW = Math.min(...sheet) - SAW_TRIM;
  // Толщина — самая маленькая из трёх сторон, две другие и есть размер детали в листе.
  const [long, short] = [w, h, d].map(v => Math.round(Number(v) || 0)).sort((a, b) => b - a);
  if (long <= maxL && short <= maxW) return;
  const name = color.name || 'материал';
  const key = `${name}|${long}x${short}`;
  const seen = issues.get(key);
  if (seen) { seen.count++; return; }
  issues.set(key, { name, long, short, maxL, maxW, count: 1 });
}

/** Конец сборки: показать проблемные детали в панели цены (и тостом — только когда состав
 *  проблем изменился, иначе тост мигал бы на каждое движение ползунка). */
export function reportParts() {
  const list = issues ? [...issues.values()] : [];
  const el = document.getElementById('partLimitWarn');
  if (el) {
    el.innerHTML = '';
    if (list.length) {
      const head = document.createElement('div');
      head.className = 'part-limit-head';
      head.textContent = `Не выходит из листа: ${list.reduce((n, i) => n + i.count, 0)} дет.`;
      el.appendChild(head);
      list.forEach(i => {
        const row = document.createElement('div');
        row.className = 'part-limit-row';
        row.textContent = `${i.long}×${i.short} мм${i.count > 1 ? ` (×${i.count})` : ''} — `
          + `«${i.name}», максимум ${i.maxL}×${i.maxW}`;
        el.appendChild(row);
      });
    }
    el.style.display = list.length ? '' : 'none';
  }
  const signature = list.map(i => `${i.name}|${i.long}x${i.short}`).sort().join(';');
  if (signature && signature !== lastSignature) {
    const first = list[0];
    showToast(list.length === 1
      ? `Деталь ${first.long}×${first.short} не выходит из листа «${first.name}» `
        + `(максимум ${first.maxL}×${first.maxW} мм с учётом обзола ${SAW_TRIM} мм)`
      : `${list.length} размера деталей не выходят из листа — см. список под ценой`);
  }
  lastSignature = signature;
}
