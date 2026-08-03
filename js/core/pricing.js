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
  // База всегда 16мм: удорожание за 32мм (общий режим ×2 в pricing, «Детали 32мм» — добавка
  // extraM2 в wardrobe.js) идёт отдельными множителями. Если брать живой PANEL_THICKNESS,
  // при 32мм t-члены формулы удвоились бы САМИ + ещё раз множителем — двойной счёт (×4).
  const t = 16;
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
    korpusM2 = 0, fasadM2 = 0, doorFillPrice = 0, doorHardwarePrice = 0, doorLines = [],
    fillM2 = 0, backWallM2 = 0, backWallType = state.backWall,
    meshPrice = 0, basketPrice = 0, drawerSlidePrice = 0, edgeMm = null, mountPrice = 0,
    fastenerCount = 0, embedCount = 0, rodMeterM = 0, handlePrice = 0, handleCount = 0,
  } = type.areas(counts);

  const kMat = getColor('korpus');
  const fMat = getColor('fasad');
  const nMat = getColor('fill');

  // Детали 32мм («в две плиты», state.panel32): материал ×2. Не касается фурнитуры,
  // сеток/корзин (готовые изделия), крепежа и коробов/выравнивателей. Кромка при 32мм —
  // больше не множитель ×3, а отдельная цена ленты «на 32» у цвета (см. kromkaPrice ниже).
  // «В две плиты» (32мм) удваивает материал ТОЛЬКО у 16мм плит; у материалов другой толщины
  // (напр. МДФ 18мм) переключатель 16/32 не применяется — толщина это параметр материала.
  const mulFor = mat => (state.panel32 && (mat?.thickness || 16) === 16) ? 2 : 1;
  const thickMul = mulFor(kMat); // корпус
  const fillMul = mulFor(nMat);  // наполнение

  // mountPrice — скрытые крепёж (100₽/деталь ЛДСП) и встройка (300₽/деталь без боковой опоры):
  // отдельной строки в смете нет по заданию, суммы входят в «Корпус»; количества
  // (fastenerCount/embedCount из wardrobe.js areas()) выйдут строками в будущей спецификации.
  const korpusPrice   = korpusM2   * kMat.pricePerM2 * thickMul + mountPrice;
  // Фасады не умножаются: двери купе — рамочный профиль с наполнением, не плита 32мм.
  // doorFillPrice — полотна дверей готовой суммой из wardrobe.js areas() (тариф по типу
  // наполнения каждой секции полотна: ЛДСП/зеркало/спеццвет, задание «двери-начали 20,07»);
  // fasadM2 — фасады ящиков, всегда ЛДСП по цвету фасада.
  const fasadPrice    = fasadM2 * fMat.pricePerM2 + doorFillPrice;
  // Сетчатые полки считаются за погонный метр (своя цена на комбинацию глубина+цвет), корзины —
  // за штуку по каталогу (комбинация ширина+глубина+высота+цвет) — не за м² по общему тарифу
  // наполнения, просто добавляем уже готовые суммы в ту же строку сметы.
  const fillPrice     = fillM2     * nMat.pricePerM2 * fillMul + meshPrice + basketPrice;
  // backWallType — может отличаться от state.backWall при посегментной стенке (см. wardrobe.js
  // areas()): общая стенка выключена ('none'), но конкретные сегменты по секциям — всегда ЛДСП.
  const backWallPrice = backWallM2 * (BACK_WALL_RATE[backWallType] || 0) * thickMul;

  // Направляющие ящика — не в общем цикле по fittings: цена зависит от ДВУХ параметров
  // (тип + длина под глубину короба), а не просто счётчика, см. drawerSlideUnitPrice в
  // wardrobe.js areas(). Итог уже посчитан там, здесь просто добавляем к фурнитуре.
  // doorHardwarePrice — профиль/ролики/направляющая дверей купе (лумп-сумма из wardrobe.js
  // areas(), та же схема, что и drawerSlidePrice): вертикальные и горизонтальные профили по
  // пог. м с учётом вида и цвета, ролики за дверь, направляющая за пог. м ширины проёма.
  // Штанга — погонными метрами (materials.rod ₽/пог.м). Доводчик двери купе — по выбору
  // пользователя: state.doorSoftClose — массив индексов дверей купе с доводчиком, 1 на дверь.
  const rodPrice = rodMeterM * (materials.rod?.pricePerM || 0);
  const softCloseCount = state.fasadDoorType === 'sliding'
    ? (state.doorSoftClose || []).filter(i => i < (counts.door || 0)).length : 0;
  const softClosePrice = softCloseCount * (materials.doorSoftClose?.pricePerDoor || 0);
  const fittingsPrice = (materials.fittings || []).reduce((sum, f) => {
    const n = f.per === 'front' ? counts.door + counts.drawer : (counts[f.per] || 0);
    return sum + f.price * n;
  }, 0) + drawerSlidePrice + doorHardwarePrice + rodPrice + softClosePrice + handlePrice;
  // Фурнитура распашных дверей — отдельная позиция по счётчику swingDoor (купейные rail/ручка
  // на распашные не начисляются, см. counts в wardrobe-geometry.js). 500₽/дверь — заглушка,
  // реальная цена будет уточнена.
  const swingHwPrice = (counts.swingDoor || 0) * (materials.swingDoorHardware?.pricePerDoor || 0);
  // Кромка — индивидуальна по цвету плиты и толщине (сессия 39): длины по вёдрам
  // «материал × 16/32» приходят из wardrobe.js areas() (edgeMm, мм), цена — лента выбранного
  // цвета (edgePerM16/edgePerM32 у цвета в materials.json). «Кромка на 32» — отдельная
  // позиция, не множитель. Фолбэк — старая общая цена edgeBanding.pricePerM (и ×3 для 32),
  // если у цвета цен ленты нет (старый каталог/выгрузка).
  const edgeRate = (mat, t) => mat?.[t === 32 ? 'edgePerM32' : 'edgePerM16']
    ?? (materials.edgeBanding?.pricePerM || 0) * (t === 32 ? 3 : 1);
  const kromkaPrice = edgeMm ? (
    edgeMm.korpus16 * edgeRate(kMat, 16) + edgeMm.korpus32 * edgeRate(kMat, 32) +
    edgeMm.fasad16  * edgeRate(fMat, 16) + edgeMm.fasad32  * edgeRate(fMat, 32) +
    edgeMm.fill16   * edgeRate(nMat, 16) + edgeMm.fill32   * edgeRate(nMat, 32)
  ) / 1000 : 0;

  const total = korpusPrice + fasadPrice + fillPrice + backWallPrice + fittingsPrice + swingHwPrice + kromkaPrice;

  document.getElementById('priceKorpus').textContent   = fmt(korpusPrice);
  document.getElementById('priceFasad').textContent    = fmt(fasadPrice);
  document.getElementById('priceFill').textContent     = fmt(fillPrice);
  document.getElementById('priceFittings').textContent = fmt(fittingsPrice);
  document.getElementById('priceKromka').textContent   = fmt(kromkaPrice);
  document.getElementById('priceTotal').textContent    = fmt(total);

  const bwEl = document.getElementById('priceBackWall');
  if (bwEl) bwEl.textContent = backWallPrice > 0 ? fmt(backWallPrice) : '—';

  const swEl = document.getElementById('priceSwingHw');
  if (swEl) swEl.textContent = swingHwPrice > 0 ? fmt(swingHwPrice) : '—';

  state.lastTotal = total;
  // Разбивка по категориям (те же суммы, что в панели цены) — для спецификации, вид «разбивка»
  // (план Этап 4). Только стэш готовых значений, расчёт не меняем.
  state.lastBreakdown = {
    korpus: korpusPrice, fasad: fasadPrice, fill: fillPrice, backWall: backWallPrice,
    fittings: fittingsPrice, swingHw: swingHwPrice, kromka: kromkaPrice, total,
  };

  // ДЕТАЛЬНАЯ разбивка по позициям (спецификация, «наименование · кол-во · ед · цена · сумма»).
  // Строится из тех же величин, что и цена выше, поэтому Σ строк == total (сверка в конце: любой
  // остаток — строкой «Прочее»). Аддитивно, расчёт не меняем. Направляющие и профиль дверей пока
  // одной строкой-группой — детализацию по типам/элементам добавим следующим шагом.
  const li = [];
  const push = (name, qty, unit, price, sum) => { if (Math.round(sum || 0) !== 0) li.push({ name, qty, unit, price, sum }); };
  const doorsN = (counts.door || 0) + (counts.swingDoor || 0);

  // Материал — ОДНОЙ строкой на «название + толщина» (не по поверхности корпус/фасад/наполнение):
  // суммируем площади всех поверхностей одного материала. Тип пишем в названии («ЛДСП …», «МДФ …»).
  // Стоимость с ×2 для 16мм «в две плиты» — по фактическим суммам, поэтому сходится с итогом.
  const ldsp = new Map();
  const addLdsp = (mat, m2, mul) => {
    if (m2 <= 0) return;
    const th = mat.thickness || 16;
    const key = (mat.name || mat.id || '—') + '|' + th;
    const e = ldsp.get(key) || { name: mat.name || mat.id || '—', th, m2: 0, cost: 0, rate: mat.pricePerM2 };
    e.m2 += m2; e.cost += m2 * mat.pricePerM2 * mul; ldsp.set(key, e);
  };
  addLdsp(kMat, korpusM2, thickMul);
  addLdsp(fMat, fasadM2, 1);
  addLdsp(nMat, fillM2, fillMul);
  ldsp.forEach(e => push(`${e.name}, ${e.th} мм`, +e.m2.toFixed(2), 'м²', e.rate, e.cost));

  push('Крепёж (за деталь)', fastenerCount, 'дет.', 100, fastenerCount * 100);
  push('Встройка в проём (за деталь)', embedCount, 'дет.', 300, embedCount * 300);
  // Наполнение и профиль дверей — детально по позициям (из areas().doorLines): зеркало/стекло по м²,
  // вертикали/горизонтали/перемычки/направляющая по пог.м, ролики — компл.
  (doorLines || []).forEach(l => push(l.name, l.qty, l.unit, l.price, l.sum));
  push('Сетчатые полки', counts.meshShelf || 0, 'шт', null, meshPrice);
  push('Корзины', counts.basket || 0, 'шт', null, basketPrice);
  push('Задняя стенка', backWallM2, 'м²', null, backWallPrice);
  push('Направляющие ящиков', counts.drawer || 0, 'компл', null, drawerSlidePrice);
  push('Ручки ящиков', handleCount, 'шт', null, handlePrice);
  push(materials.rod?.name || 'Штанга для одежды', +rodMeterM.toFixed(2), 'пог.м', materials.rod?.pricePerM, rodPrice);
  (materials.fittings || []).forEach(f => {
    const n = f.per === 'front' ? (counts.door || 0) + (counts.drawer || 0) : (counts[f.per] || 0);
    push(f.name, n, 'шт', f.price, f.price * n);
  });
  push(materials.doorSoftClose?.name || 'Доводчик двери купе', softCloseCount, 'дв.', materials.doorSoftClose?.pricePerDoor, softClosePrice);
  push(materials.swingDoorHardware?.name || 'Фурнитура распашных дверей', counts.swingDoor || 0, 'дв.', materials.swingDoorHardware?.pricePerDoor, swingHwPrice);

  // Кромка — по ЦВЕТУ (+ толщина 16/32), без раскладки корпус/фасад/наполнение.
  const edge = new Map();
  const addEdge = (mat, mm, tt) => {
    if (!mm || mm <= 0) return;
    const key = (mat.name || '—') + '|' + tt;
    const e = edge.get(key) || { name: mat.name || '—', t: tt, m: 0, rate: edgeRate(mat, tt) };
    e.m += mm / 1000; edge.set(key, e);
  };
  if (edgeMm) {
    addEdge(kMat, edgeMm.korpus16, 16); addEdge(kMat, edgeMm.korpus32, 32);
    addEdge(fMat, edgeMm.fasad16, 16);  addEdge(fMat, edgeMm.fasad32, 32);
    addEdge(nMat, edgeMm.fill16, 16);   addEdge(nMat, edgeMm.fill32, 32);
  }
  edge.forEach(e => push(`Кромка ${e.name}, ${e.t}мм`, +e.m.toFixed(2), 'пог.м', e.rate, e.m * e.rate));

  const liSum = li.reduce((s, x) => s + x.sum, 0);
  const diff = total - liSum;
  if (Math.round(diff) !== 0) push('Прочее (сверка расчёта)', '', '', null, diff);
  state.lastLineItems = li;
}
