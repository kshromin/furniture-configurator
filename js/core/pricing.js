import { state, materials, PANEL_THICKNESS } from './state.js';
import { getColor } from './materials.js';
import { TYPES } from '../types/registry.js';

export function fmt(v) { return Math.round(v).toLocaleString('ru-RU') + ' ₽'; }

// Общая формула площади короба (верх+низ+бока+задняя стенка+вертикальные перегородки).
// dividers — число дополнительных вертикальных перегородок (только у шкафа-купе они платные, см. wardrobe.js).
export function korpusBoxAreaM2(dividers = 0) {
  const { width, height } = state;
  const t = PANEL_THICKNESS;
  const areaMm2 =
    width * t * 2 +
    t * (height - 2 * t) * 2 +
    (width - 2 * t) * (height - 2 * t) +
    dividers * t * (height - 2 * t);
  return areaMm2 / 1e6;
}

// Площадь фасада «по умолчанию» — один сплошной фронт во всю высоту/ширину изделия.
export function defaultFasadAreaM2() {
  const { width, height } = state;
  const t = PANEL_THICKNESS;
  const iW = width - 2 * t - 10;
  return (iW * (height - 2 * t)) / 1e6;
}

export function updatePrice(counts) {
  const type = TYPES[state.type] || TYPES['wardrobe'];
  const { korpusM2 = 0, fasadM2 = 0, fillM2 = 0 } = type.areas(counts);

  const kMat = getColor('korpus');
  const fMat = getColor('fasad');
  const nMat = getColor('fill');

  const korpusPrice = korpusM2 * kMat.pricePerM2;
  const fasadPrice  = fasadM2  * fMat.pricePerM2;
  const fillPrice   = fillM2   * nMat.pricePerM2;

  const fittingsPrice = (materials.fittings || []).reduce((sum, f) => {
    const n = f.per === 'front' ? counts.door + counts.drawer : (counts[f.per] || 0);
    return sum + f.price * n;
  }, 0);

  const total = korpusPrice + fasadPrice + fillPrice + fittingsPrice;

  document.getElementById('priceKorpus').textContent   = fmt(korpusPrice);
  document.getElementById('priceFasad').textContent    = fmt(fasadPrice);
  document.getElementById('priceFill').textContent     = fmt(fillPrice);
  document.getElementById('priceFittings').textContent = fmt(fittingsPrice);
  document.getElementById('priceTotal').textContent    = fmt(total);

  state.lastTotal = total;
}
