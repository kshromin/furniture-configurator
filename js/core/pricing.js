import { state, materials, PANEL_THICKNESS } from './state.js';
import { getColor } from './materials.js';
import { TYPES } from '../types/registry.js';

export function fmt(v) { return Math.round(v).toLocaleString('ru-RU') + ' ₽'; }

// Общая формула площади короба (верх+низ+бока+задняя стенка+вертикальные перегородки).
// dividers — число дополнительных вертикальных перегородок (только у шкафа-купе они платные, см. wardrobe.js).
// heightOverride — высота собственно короба, если она меньше state.height (например, часть высоты занял цоколь).
// skip — какие панели короба отсутствуют (без крыши/дна/стоек), их площадь не учитывается.
// sideHeightOverride — реальная высота стоек/перегородок, если она отличается от height-2t
// (например, крыши/дна нет, и стойка вытянута до самого края короба).
export function korpusBoxAreaM2(dividers = 0, heightOverride, skip = {}, sideHeightOverride) {
  const { width } = state;
  const height = heightOverride ?? state.height;
  const t = PANEL_THICKNESS;
  const sideHeight = sideHeightOverride ?? (height - 2 * t);
  // top + bottom + sides + dividers (без задней стенки — она считается отдельно)
  const areaMm2 =
    (skip.top    ? 0 : width * t) +
    (skip.bottom ? 0 : width * t) +
    (skip.left   ? 0 : t * sideHeight) +
    (skip.right  ? 0 : t * sideHeight) +
    dividers * t * sideHeight;
  return areaMm2 / 1e6;
}

// Площадь фасада «по умолчанию» — один сплошной фронт во всю высоту/ширину изделия.
export function defaultFasadAreaM2() {
  const { width, height } = state;
  const t = PANEL_THICKNESS;
  const iW = width - 2 * t - 10;
  return (iW * (height - 2 * t)) / 1e6;
}

const BACK_WALL_RATE = { ldsp: 2000, hdf: 500 };

export function updatePrice(counts) {
  const type = TYPES[state.type] || TYPES['wardrobe'];
  const {
    korpusM2 = 0, fasadM2 = 0, fillM2 = 0, backWallM2 = 0, backWallType = state.backWall,
    meshPrice = 0, basketPrice = 0, edgeLengthM = 0,
  } = type.areas(counts);

  const kMat = getColor('korpus');
  const fMat = getColor('fasad');
  const nMat = getColor('fill');

  const korpusPrice   = korpusM2   * kMat.pricePerM2;
  const fasadPrice    = fasadM2    * fMat.pricePerM2;
  // Сетчатые полки считаются за погонный метр (своя цена на комбинацию глубина+цвет), корзины —
  // за штуку по каталогу (комбинация ширина+глубина+высота+цвет) — не за м² по общему тарифу
  // наполнения, просто добавляем уже готовые суммы в ту же строку сметы.
  const fillPrice     = fillM2     * nMat.pricePerM2 + meshPrice + basketPrice;
  // backWallType — может отличаться от state.backWall при посегментной стенке (см. wardrobe.js
  // areas()): общая стенка выключена ('none'), но конкретные сегменты по секциям — всегда ЛДСП.
  const backWallPrice = backWallM2 * (BACK_WALL_RATE[backWallType] || 0);

  const fittingsPrice = (materials.fittings || []).reduce((sum, f) => {
    const n = f.per === 'front' ? counts.door + counts.drawer : (counts[f.per] || 0);
    return sum + f.price * n;
  }, 0);
  // Кромка — ПВХ-лента по видимому переднему торцу ЛДСП, за погонный метр (см.
  // data/materials.json edgeBanding, длина считается в js/types/wardrobe.js areas()).
  const kromkaPrice = edgeLengthM * (materials.edgeBanding?.pricePerM || 0);

  const total = korpusPrice + fasadPrice + fillPrice + backWallPrice + fittingsPrice + kromkaPrice;

  document.getElementById('priceKorpus').textContent   = fmt(korpusPrice);
  document.getElementById('priceFasad').textContent    = fmt(fasadPrice);
  document.getElementById('priceFill').textContent     = fmt(fillPrice);
  document.getElementById('priceFittings').textContent = fmt(fittingsPrice);
  document.getElementById('priceKromka').textContent   = fmt(kromkaPrice);
  document.getElementById('priceTotal').textContent    = fmt(total);

  const bwEl = document.getElementById('priceBackWall');
  if (bwEl) bwEl.textContent = backWallPrice > 0 ? fmt(backWallPrice) : '—';

  state.lastTotal = total;
}
