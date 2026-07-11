import * as THREE from 'three';
import { state, PANEL_THICKNESS } from '../core/state.js';
import { addPanel, furnitureGroup } from '../core/scene.js';
import { getColor } from '../core/materials.js';

export function getDoorCount(width) { return Math.max(2, Math.min(4, Math.round(width / 900))); }

// Вычисляет ширину/высоту дверного пролёта с учётом стоек/крыши/коробов/планок.
// "планка" = та же толщина что и панель (пролёт не меняется относительно варианта "со стойкой").
// "короб" = занимает boxW/boxH из габарита изделия → пролёт уменьшается на размер короба.
// "ничего" (убрана без замены) → пролёт расширяется на толщину убранной панели.
// Выравнивающий элемент — планка у переднего края рядом со стойкой/крышей (та же толщина,
// что и панель, но шириной/высотой по умолчанию 50мм). Сдвигает стойку/крышу вглубь на свой
// размер, поэтому дверной пролёт (и цена) должны знать про него так же, как про планку/короб.
export function effectiveDoorSpan() {
  const { width, noSideLeft, noSideRight, noCeiling, noBottom,
          leftReplace, rightReplace, topReplace, bottomReplace,
          leftBoxW, rightBoxW, topBoxH, bottomBoxH,
          alignerLeft, alignerLeftW, alignerRight, alignerRightW, alignerTop, alignerTopH } = state;
  const t = PANEL_THICKNESS;

  function off(noPanel, replace, boxSize, alignerOn, alignerSize) {
    let base;
    if (!noPanel)                   base = t;     // панель на месте
    else if (replace === 'planka')  base = t;     // планка = та же толщина
    else if (replace === 'box')     base = boxSize;
    else                             base = 0;     // ничего
    return base + (alignerOn ? alignerSize : 0);
  }

  const leftOff   = off(noSideLeft,  leftReplace,   leftBoxW,   alignerLeft,  alignerLeftW);
  const rightOff  = off(noSideRight, rightReplace,  rightBoxW,  alignerRight, alignerRightW);
  const topOff    = off(noCeiling,   topReplace,    topBoxH,    alignerTop,   alignerTopH);
  const bottomOff = off(noBottom,    bottomReplace, bottomBoxH, false,        0);

  // Стойки/задняя стенка/перегородки/выравниватели идут во всю глубину короба, а планка/короб —
  // только декоративная накладка в передней дверной зоне (см. drawSideElem). Поэтому их высота
  // должна знать только про РЕАЛЬНУЮ крышу/дно, а не про декоративную замену — иначе они не
  // дотягиваются до пола/потолка, хотя должны стоять на полу независимо от замены.
  const stojkaTopOff    = noCeiling ? 0 : t + (alignerTop ? alignerTopH : 0);
  const stojkaBottomOff = noBottom  ? 0 : t;

  return {
    spanW:     width - leftOff - rightOff,
    leftOff,
    rightOff,
    topOff,
    bottomOff,
    stojkaTopOff,
    stojkaBottomOff,
  };
}

// Секции наполнения имеют произвольную ширину, но сумма их ширин + перегородки между ними
// обязана совпадать с внутренней шириной короба (effectiveDoorSpan().spanW). Эта функция
// восстанавливает баланс после любого изменения, которое сдвигает границы короба (ширина
// изделия, стойки/выравниватели) или состав секций (добавили/убрали секцию).
// editedIndex — если пользователь только что руками поправил ширину одной секции, её значение
// не трогаем, остальные пропорционально ужимаются/растягиваются под освободившееся место.
export const MIN_SECTION_WIDTH = 150;

export function rebalanceSections(editedIndex = null) {
  const sections = state.sections;
  const n = sections.length;
  if (n === 0) return;
  const t = PANEL_THICKNESS;
  const { spanW } = effectiveDoorSpan();
  const available = spanW - (n - 1) * t;

  if (n === 1) { sections[0].width = available; return; }

  if (editedIndex !== null) {
    const maxForEdited = available - (n - 1) * MIN_SECTION_WIDTH;
    sections[editedIndex].width = Math.min(Math.max(sections[editedIndex].width, MIN_SECTION_WIDTH), maxForEdited);
  }

  const otherIdx = sections.map((_, i) => i).filter(i => i !== editedIndex);
  const fixedW = editedIndex !== null ? sections[editedIndex].width : 0;
  const remaining = Math.max(otherIdx.length * MIN_SECTION_WIDTH, available - fixedW);
  const otherTotal = otherIdx.reduce((s, i) => s + sections[i].width, 0);

  otherIdx.forEach(i => {
    // если у всех «остальных» секций ширина 0 (например, только что собраны из пресета) —
    // делим доступное место поровну, иначе доля 0/0 обнулила бы всех, кроме последней
    const share = otherTotal > 0 ? sections[i].width / otherTotal : 1 / otherIdx.length;
    sections[i].width = Math.max(MIN_SECTION_WIDTH, Math.round(remaining * share));
  });

  // компенсируем накопленное округление в последней «нефиксированной» секции, чтобы сумма
  // ширин точно совпала с available, а не отличалась на пару мм
  const total = sections.reduce((s, sec) => s + sec.width, 0);
  sections[otherIdx[otherIdx.length - 1]].width += available - total;
}

// Двери купе едут по рельсам, вынесенным в переднюю зону короба (как у Командор) —
// это съедает часть глубины у наполнения, но не у самого короба (короб — на полную глубину).
export const DOOR_DEPTH_ZONE = 90;
// Соседние двери заходят друг на друга внахлёст, чтобы не было щели; крайние двери при
// этом не вылезают наружу — весь ряд идёт строго от стойки до стойки (см. buildSlidingDoors).
export const DOOR_OVERLAP = 30;

// Рамка двери купе — по умолчанию серебристый алюминиевый профиль; сама дверь на 90мм
// зоны глубины (ширину/глубину рамки и цвет вынесем в настройки, когда дойдём до этого).
export const DOOR_FRAME_WIDTH = 40; // видимая ширина профиля по периметру
export const DOOR_FRAME_DEPTH = 40; // толщина рамки (она же — толщина двери по Z)
const DOOR_FRAME_COLOR = 0xc4c4c8;
const RAIL_COLOR = 0xb0b0b4;
export const TOP_RAIL_HEIGHT = 50;
export const BOTTOM_RAIL_HEIGHT = 10;

// Габариты короба ящика (дно/боковины/задняя стенка) — чуть меньше фасада (10мм с каждой
// стороны по ширине/высоте), а глубина ограничена, чтобы не вылезти за заднюю стенку короба
// шкафа. Вынесено отдельно, т.к. одна и та же формула нужна и в геометрии, и в расчёте площади.
export function drawerBoxSize(sw, dh, drawerDepth, depth) {
  const t = PANEL_THICKNESS;
  const frontZ = depth / 2 - DOOR_DEPTH_ZONE;
  const boxDepthMax = Math.max(100, frontZ - t + depth / 2);
  return { boxW: sw - 20, boxH: dh - 20, boxDepth: Math.min(drawerDepth, boxDepthMax) };
}

// Дефолтная структура наполнения секции (см. DEVLOG сессия 10): верхняя и нижняя полки —
// не настраиваются, просто задают границы зон над/под ними. shelvesTop/shelvesBottom из
// state.sections[i] добавляют полки ДОПОЛНИТЕЛЬНО, в соответствующей зоне.
export const TOP_SHELF_GAP = 550;    // от верхней границы наполнения до верхней полки
export const BOTTOM_SHELF_GAP = 250; // от нижней границы наполнения до нижней полки
export const ROD_BELOW_TOP_SHELF = 70; // штанга №1 — на столько ниже верхней полки
// Жёсткость — вертикальная пластина, свисающая вниз от полки (перпендикулярно ей, не лежит
// плашмя как полка), стоит в плоскости задней стенки. STIFFENER_THICKNESS — тонкий размер
// пластины (вдоль глубины, впритык к задней стенке), STIFFENER_HEIGHT — на сколько свисает вниз.
export const STIFFENER_THICKNESS = 10;
export const STIFFENER_HEIGHT = 100;
const ROD_COLOR = 0xc0c0c0; // хром
const ROD_RADIUS = 12.5; // диаметр штанги 25мм
const MIN_ZONE_GAP = 200; // страховка для низких секций, чтобы полки не пересеклись

// Максимальная глубина короба ящика, которую можно выбрать в UI: реальный физический предел
// (см. drawerBoxSize) минус обязательный запас 10мм от задней стенки, округлённый вниз до 50мм —
// так пользователь не может ввести значение, которое физически не влезет. Всегда в границах
// 250-600: если короб мельче — потолок снижается до влезающего (но не ниже 250), если короб
// глубже — потолок всё равно не растёт выше 600.
export function maxDrawerDepth(depth) {
  const t = PANEL_THICKNESS;
  const frontZ = depth / 2 - DOOR_DEPTH_ZONE;
  const physicalMax = frontZ - t + depth / 2;
  const rounded = Math.floor((physicalMax - 10) / 50) * 50;
  return Math.min(600, Math.max(250, rounded));
}

// Сетчатые полки — независимое от ящиков поле, тоже строятся снизу вверх (максимум 3шт),
// но ширина всегда во всю секцию (как обычная полка), а фиксированный выбор глубины (300/400/500мм)
// ограничен реальной доступной глубиной наполнения (innerDepth = глубина короба − дверная зона).
export const MESH_DEPTHS = [300, 400, 500];
export const MESH_THICKNESS = 20; // высота силовых прутков
export const MESH_PITCH = 300;    // шаг между соседними сетчатыми полками (центр-центр)
const MESH_WIRE = 4;  // толщина частых прутков решётки
const MESH_WIRE_STEP = 25; // шаг частых прутков вдоль ШИРИНЫ (сами прутки идут вдоль глубины)
const MESH_LIP_HEIGHT = 35; // высота загиба переднего края

export function availableMeshDepths(depth) {
  const innerDepth = depth - DOOR_DEPTH_ZONE;
  return MESH_DEPTHS.filter(d => d <= innerDepth);
}

function meshShelfMaterialProps(colorKey) {
  return colorKey === 'silver'
    ? { color: 0xc0c0c0, metalness: 0.7, roughness: 0.25 }
    : { color: 0xf2f2f2, metalness: 0.05, roughness: 0.5 };
}

// Торцевое вешало — выдвижная штанга-петля (см. mdm-complect.ru/catalog/shtangi/36654):
// телескопический рельс, крепится саморезами к самой верхней полке. valetLength — габарит
// ВСЕГО вешала целиком, включая кронштейны с обоих концов (как у реального товара) — прутки
// внутри короче на глубину кронштейна с каждого конца, но весь узел (кронштейн-кронштейн)
// укладывается ровно в заявленный размер и не вылезает за реальную доступную глубину.
// П-образный пруток (петля) тянется вдоль глубины. Показываем в выдвинутом положении.
export const VALET_LENGTHS = [250, 300, 350, 400, 450, 500, 550];
const VALET_LOOP_WIDTH = 60; // ширина петли штанги
const VALET_ROD_RADIUS = 4;
const VALET_COLOR = 0xc0c0c0;
const VALET_BRACKET_DEPTH = 20; // глубина кронштейна (совпадает с 'd' в addPanel ниже)

// Если сзади стоит планка жёсткости (не ЛДСП задняя стенка), крепление вешала не может занимать
// её место — глубина, доступная под вешало, уменьшается на 16мм (толщина панели/запас).
function valetBackClearance() {
  return state.backWall !== 'ldsp' ? PANEL_THICKNESS : 0;
}

export function availableValetLengths(depth) {
  const innerDepth = depth - DOOR_DEPTH_ZONE;
  return VALET_LENGTHS.filter(v => v <= innerDepth - valetBackClearance());
}

// Общий клампинг фиксированных размеров (глубина ящика/сетки, длина вешала) под текущую
// глубину короба. Вызывается и из build() (чтобы геометрия не вылезала за реальные границы),
// и из renderSectionsList() (чтобы <select> в UI сразу показывал уже подрезанное значение —
// иначе браузер молча выбирает первый вариант списка, пока значение не совпадёт ни с одной
// опцией, и в поле показывается не то, что реально построено).
export function clampSectionSizes(sections, depth) {
  const maxDD = maxDrawerDepth(depth);
  const meshAvail = availableMeshDepths(depth);
  const valetAvail = availableValetLengths(depth);
  sections.forEach(sec => {
    if (sec.drawerDepth > maxDD) sec.drawerDepth = maxDD;
    if (!meshAvail.includes(sec.meshDepth)) sec.meshDepth = meshAvail.length ? meshAvail[meshAvail.length - 1] : MESH_DEPTHS[0];
    if (!valetAvail.includes(sec.valetLength)) sec.valetLength = valetAvail.length ? valetAvail[valetAvail.length - 1] : VALET_LENGTHS[0];
  });
}

// Дверь купе = рамка по периметру + наполнение внутри неё (зеркало/ЛДСП/стекло).
// Наполнение сейчас той же толщины, что и панели короба, и красится в цвет фасада —
// когда рамка/наполнение станут настраиваться раздельно (разный цвет рамки, разный материал
// наполнения), менять нужно будет только эту функцию.
function buildSlidingDoor(x, y, z, w, h, fillColor) {
  const fw = DOOR_FRAME_WIDTH;
  addPanel(w, fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x, y + h / 2 - fw / 2, z]); // верхний брусок рамки
  addPanel(w, fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x, y - h / 2 + fw / 2, z]); // нижний брусок рамки
  addPanel(fw, h - 2 * fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x - w / 2 + fw / 2, y, z]); // левый брусок
  addPanel(fw, h - 2 * fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x + w / 2 - fw / 2, y, z]); // правый брусок
  addPanel(w - 2 * fw, h - 2 * fw, PANEL_THICKNESS, fillColor, [x, y, z], 0.85); // наполнение
}

// Общий короб для шкафа-купе / распашного / открытого — сегодня они выглядят одинаково
// (двери купе рисуются всегда), различия по дверям будут добавлены отдельно для каждого типа.
export function buildWardrobeBox() {
  const { width, depth, plinthEnabled, plinthHeight, noSideLeft, noSideRight, noCeiling, noBottom } = state;
  const t = PANEL_THICKNESS;
  const kColor = getColor('korpus').color;
  const fColor = getColor('fasad').color;
  const nColor = getColor('fill').color;

  // Без дна нечему опираться на цоколь — он тоже пропадает, даже если галочка стоит.
  const plinthH = (plinthEnabled && !noBottom) ? plinthHeight : 0;
  // Цоколь занимает нижнюю часть общей высоты изделия — короб над ним ниже на эту величину.
  const height = state.height - plinthH;
  const y0 = plinthH; // низ короба, всё остальное строится как раньше, но с этим смещением

  if (plinthH > 0) {
    addPanel(width, plinthH, depth - 40, kColor, [0, plinthH / 2, -20]);
  }

  // Выравнивающие элементы — тонкие планки (толщиной с панель) у самого переднего края,
  // рядом со стойкой/крышей; сама стойка/крыша сдвигается вглубь на их размер.
  const alLeftW  = state.alignerLeft  ? state.alignerLeftW  : 0;
  const alRightW = state.alignerRight ? state.alignerRightW : 0;
  const alTopH   = state.alignerTop   ? state.alignerTopH   : 0;
  const alignZ = depth / 2 - t / 2;

  // Реальные границы короба — с учётом планок/коробов/выравнивающих элементов (та же логика,
  // что и для дверного пролёта). Стойки, задняя стенка и наполнение опираются на них, а не на
  // голую толщину панели — иначе при снятой крыше/дне (или сдвиге от выравнивателя) они не
  // дотянутся до реального края короба или, наоборот, вылезут за него.
  const { spanW, leftOff, rightOff, topOff, bottomOff, stojkaTopOff, stojkaBottomOff } = effectiveDoorSpan();
  const stojkaH = height - stojkaTopOff - stojkaBottomOff;
  const stojkaCenterY = y0 + stojkaBottomOff + stojkaH / 2;

  if (!noBottom)    addPanel(width, t, depth, kColor, [0, y0 + t / 2, 0]);
  if (!noCeiling)   addPanel(width, t, depth, kColor, [0, y0 + height - alTopH - t / 2, 0]);
  if (!noSideLeft)  addPanel(t, stojkaH, depth, kColor, [-width / 2 + alLeftW + t / 2, stojkaCenterY, 0]);
  if (!noSideRight) addPanel(t, stojkaH, depth, kColor, [width / 2 - alRightW - t / 2, stojkaCenterY, 0]);
  if (state.alignerLeft)  addPanel(alLeftW,  stojkaH, t, kColor, [-width / 2 + alLeftW / 2, stojkaCenterY, alignZ]);
  if (state.alignerRight) addPanel(alRightW, stojkaH, t, kColor, [width / 2 - alRightW / 2, stojkaCenterY, alignZ]);
  if (state.alignerTop)   addPanel(width, alTopH, t, kColor, [0, y0 + height - alTopH / 2, alignZ]);
  if (state.backWall !== 'none') {
    const bwColor = state.backWall === 'hdf' ? 0xffffff : kColor;
    const bwThick = state.backWall === 'hdf' ? 4 : t;
    addPanel(width - leftOff - rightOff, stojkaH, bwThick, bwColor, [0, stojkaCenterY, -depth / 2 + bwThick / 2]);
  }

  // Наполнение (перегородки, полки) не занимает дверную зону и прижато к задней стенке —
  // короб при этом остаётся на полную глубину.
  const innerDepth = depth - DOOR_DEPTH_ZONE;
  const innerZ = -DOOR_DEPTH_ZONE / 2;

  // Ширины секций хранятся как есть в state.sections; здесь только страховка на случай, если
  // что-то изменило границы короба (габариты, стойки, выравниватели) и не вызвало rebalanceSections()
  // само — без этого секции могли бы не долетать до края короба или вылезать за него.
  const sections = state.sections;
  {
    const available = spanW - (sections.length - 1) * t;
    const sum = sections.reduce((s, sec) => s + sec.width, 0);
    if (Math.abs(sum - available) > 0.5) rebalanceSections();
  }
  clampSectionSizes(sections, depth);
  const sectionCenters = [];
  {
    let cursorX = -width / 2 + leftOff;
    sections.forEach((sec, i) => {
      sectionCenters.push(cursorX + sec.width / 2);
      cursorX += sec.width;
      if (i < sections.length - 1) {
        addPanel(t, stojkaH, innerDepth, nColor, [cursorX + t / 2, stojkaCenterY, innerZ]);
        cursorX += t;
      }
    });
  }

  // Визуализация планок и коробов (глубина = дверная зона, внутри габарита изделия)
  const elemZ = depth / 2 - DOOR_DEPTH_ZONE / 2;
  const totalH = state.height;

  function drawSideElem(noSide, replace, boxW, xCenter) {
    if (!noSide) return;
    if (replace === 'planka')
      addPanel(t, totalH, DOOR_DEPTH_ZONE, kColor, [xCenter, totalH / 2, elemZ]);
    else if (replace === 'box')
      addPanel(boxW, totalH, DOOR_DEPTH_ZONE, kColor, [xCenter, totalH / 2, elemZ]);
  }
  drawSideElem(state.noSideLeft,  state.leftReplace,  state.leftBoxW,  -width / 2 + (state.leftReplace === 'box' ? state.leftBoxW : t) / 2);
  drawSideElem(state.noSideRight, state.rightReplace, state.rightBoxW,  width / 2 - (state.rightReplace === 'box' ? state.rightBoxW : t) / 2);

  if (state.noCeiling) {
    const h = state.topReplace === 'box' ? state.topBoxH : t;
    if (state.topReplace !== 'none')
      addPanel(width, h, DOOR_DEPTH_ZONE, kColor, [0, totalH - h / 2, elemZ]);
  }
  if (state.noBottom) {
    const h = state.bottomReplace === 'box' ? state.bottomBoxH : t;
    if (state.bottomReplace !== 'none')
      addPanel(width, h, DOOR_DEPTH_ZONE, kColor, [0, h / 2, elemZ]);
  }

  const spanCenterX = -width / 2 + leftOff + spanW / 2;

  const doorCount = getDoorCount(spanW);
  if (state.showDoors) {
    const gap = 4;
    const doorW = (spanW + (doorCount - 1) * DOOR_OVERLAP) / doorCount;
    const doorZoneZ = depth / 2 - DOOR_DEPTH_ZONE / 2;
    const railFront = depth / 2 - DOOR_FRAME_DEPTH / 2;
    const railBack  = depth / 2 - DOOR_DEPTH_ZONE + DOOR_FRAME_DEPTH / 2;

    addPanel(spanW, TOP_RAIL_HEIGHT,    DOOR_DEPTH_ZONE, RAIL_COLOR, [spanCenterX, y0 + height - topOff - TOP_RAIL_HEIGHT / 2,       doorZoneZ]);
    addPanel(spanW, BOTTOM_RAIL_HEIGHT, DOOR_DEPTH_ZONE, RAIL_COLOR, [spanCenterX, y0 + bottomOff + BOTTOM_RAIL_HEIGHT / 2, doorZoneZ]);

    const doorBottom  = y0 + bottomOff + BOTTOM_RAIL_HEIGHT + gap;
    const doorTop     = y0 + height - topOff - TOP_RAIL_HEIGHT - gap;
    const doorH       = doorTop - doorBottom;
    const doorCenterY = (doorBottom + doorTop) / 2;

    for (let i = 0; i < doorCount; i++) {
      const leftEdge = -spanW / 2 + i * (doorW - DOOR_OVERLAP);
      const x = spanCenterX + leftEdge + doorW / 2;
      const z = i % 2 === 0 ? railFront : railBack;
      buildSlidingDoor(x, doorCenterY, z, doorW, doorH, fColor);
    }
  }

  const fillBottom = bottomOff + 10, fillTop = height - topOff - 10;
  // Граница дверной зоны — та же, что и у полок/перегородки (innerZ ± innerDepth/2): ящики
  // должны быть с ней вровень, а не торчать вперёд к самим дверям.
  const frontZ = depth / 2 - DOOR_DEPTH_ZONE;
  let totalShelves = 0, totalDrawers = 0, totalRod = 0, totalDrawerSoft = 0, totalDrawerBasic = 0, totalMeshShelves = 0, totalValet = 0;

  function addRod(cx, y, sw) {
    const rodGeo = new THREE.CylinderGeometry(ROD_RADIUS, ROD_RADIUS, sw, 24);
    const rodMat = new THREE.MeshStandardMaterial({ color: ROD_COLOR, metalness: 0.9, roughness: 0.15 });
    const rodMesh = new THREE.Mesh(rodGeo, rodMat);
    rodMesh.rotation.z = Math.PI / 2;
    rodMesh.position.set(cx, y0 + y, innerZ);
    furnitureGroup.add(rodMesh);
  }

  // Ящик = фасад (лицевая панель, цвет фасада, вровень с перегородкой) + короб позади него
  // (дно/боковины/задняя стенка, цвет наполнения/ЛДСП, чуть уже фасада). Глубина короба
  // ограничена, чтобы не вылезти за заднюю стенку короба шкафа.
  function addDrawer(cx, y, sw, sec) {
    const dh = sec.drawerHeight;
    const facadeZ = frontZ - t / 2;
    const { boxW, boxH, boxDepth } = drawerBoxSize(sw, dh, sec.drawerDepth, depth);
    const boxCenterZ = facadeZ - t / 2 - boxDepth / 2;

    addPanel(sw, dh, t, fColor, [cx, y0 + y, facadeZ], 0.9); // фасад
    addPanel(boxW, t, boxDepth, nColor, [cx, y0 + y - boxH / 2 + t / 2, boxCenterZ]);      // дно короба
    addPanel(t, boxH, boxDepth, nColor, [cx - boxW / 2 + t / 2, y0 + y, boxCenterZ]);      // левая боковина
    addPanel(t, boxH, boxDepth, nColor, [cx + boxW / 2 - t / 2, y0 + y, boxCenterZ]);      // правая боковина
    addPanel(boxW, boxH, t, nColor, [cx, y0 + y, boxCenterZ - boxDepth / 2 + t / 2]);       // задняя стенка короба
  }

  // Тонкая планка без чёрного контура (addPanel рисует его всегда, для десятков тонких прутков
  // это выглядело бы захламлённо) — металлик/белый по выбранному цвету.
  function addBar(w, h, d, x, y, z, colorKey) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(meshShelfMaterialProps(colorKey)));
    mesh.position.set(x, y, z);
    furnitureGroup.add(mesh);
  }

  // Круглый пруток (настоящая сетка/штанга сделана из проволоки, не плоских планок) — цилиндр,
  // ориентированный вдоль оси 'x' или 'z' (по умолчанию — вдоль 'y', как обычный CylinderGeometry).
  function addRodBar(length, radius, x, y, z, axis, colorKey) {
    const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(meshShelfMaterialProps(colorKey)));
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    else if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    furnitureGroup.add(mesh);
  }

  // Сетчатая полка — сделана из круглой проволоки (не плоских планок). Частые тонкие прутки
  // идут ВДОЛЬ ГЛУБИНЫ, с шагом 25мм вдоль ширины, и тянутся сквозь все силовые прутки без
  // разрыва. У КАЖДОГО такого прутка свой отдельный загиб-крючок на переднем конце — приподнят
  // на 35мм. Силовых прутков поперёк (вдоль ширины) — 4: задний ровно на заднем крае (им
  // заканчивается полка), второй чуть ближе к переднему краю от середины, третий у основания
  // загиба (на высоте прутков, в лицевой плоскости), четвёртый замыкает загиб сверху (на высоте
  // окончания крючков).
  function addMeshShelf(cx, y, sw, meshDepth, colorKey) {
    const backZ = -depth / 2;
    const frontZ = backZ + meshDepth;
    const wireR = MESH_WIRE / 2;
    const crossR = MESH_WIRE * 1.3 / 2;

    const nWires = Math.max(6, Math.round(sw / MESH_WIRE_STEP));
    for (let i = 0; i <= nWires; i++) {
      const wx = cx - sw / 2 + (sw * i) / nWires;
      addRodBar(meshDepth, wireR, wx, y, backZ + meshDepth / 2, 'z', colorKey);
      addRodBar(MESH_LIP_HEIGHT, wireR, wx, y + MESH_LIP_HEIGHT / 2, frontZ, 'y', colorKey); // свой крючок
    }

    addRodBar(sw, crossR, cx, y, backZ, 'x', colorKey);                       // 1: задний, на краю
    addRodBar(sw, crossR, cx, y, backZ + meshDepth * 0.6, 'x', colorKey);     // 2: чуть ближе к переду от середины
    addRodBar(sw, crossR, cx, y, frontZ, 'x', colorKey);                      // 3: у основания загиба
    addRodBar(sw, crossR, cx, y + MESH_LIP_HEIGHT, frontZ, 'x', colorKey);    // 4: замыкает загиб сверху
  }

  // Торцевое вешало — крепится к низу верхней полки 4 саморезами (2 спереди, 2 сзади — не к
  // задней жёсткости, крепления отнесены вперёд). Один замкнутый прямоугольник по центру секции
  // (не два, не слева-справа): верхний пруток вдоль глубины (у полки) → стойка вниз спереди →
  // нижний пруток вдоль глубины (параллельно, ниже — на нём висят вешалки) → стойка вверх сзади
  // → замыкается обратно на верхний. Показываем в выдвинутом положении.
  // Перемычки (доп. жёсткость) убраны — расположение будет уточнено отдельно.
  // topShelfWorldY — мировая Y-координата верхней полки (с учётом y0), как и у других функций.
  function addValet(cx, topShelfWorldY, valetLength) {
    const shelfBottomY = topShelfWorldY - t / 2;
    const railY = shelfBottomY - 8;
    const half = VALET_LOOP_WIDTH / 2;
    const dropH = 50; // на сколько нижний пруток (штанга-вешалка) ниже верхнего рельса

    // valetLength — габарит всего узла целиком (кронштейн-кронштейн). Если сзади жёсткость —
    // узел сдвинут вперёд на её толщину (см. valetBackClearance/availableValetLengths — те же
    // 16мм там уже вычтены из допустимых размеров). Центры кронштейнов (и концы прутков)
    // отступают от краёв габарита на полглубины кронштейна.
    const envBackZ = -depth / 2 + valetBackClearance();
    const backZ = envBackZ + VALET_BRACKET_DEPTH / 2;
    const frontZ = envBackZ + valetLength - VALET_BRACKET_DEPTH / 2;
    const rodLen = frontZ - backZ;

    addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx - half, shelfBottomY - 7, backZ]);  // кронштейн задний левый
    addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx + half, shelfBottomY - 7, backZ]);  // кронштейн задний правый
    addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx - half, shelfBottomY - 7, frontZ]); // кронштейн передний левый
    addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx + half, shelfBottomY - 7, frontZ]); // кронштейн передний правый

    const mat = { color: VALET_COLOR, metalness: 0.8, roughness: 0.2 };
    const addValetRod = (length, x, y, z, axis) => {
      const geo = new THREE.CylinderGeometry(VALET_ROD_RADIUS, VALET_ROD_RADIUS, length, 10);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(mat));
      if (axis === 'x') mesh.rotation.z = Math.PI / 2;
      else if (axis === 'z') mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, z);
      furnitureGroup.add(mesh);
    };
    addValetRod(rodLen, cx, railY, backZ + rodLen / 2, 'z');          // верхний пруток (рельс у полки)
    addValetRod(dropH, cx, railY - dropH / 2, frontZ, 'y');           // стойка вниз спереди
    addValetRod(rodLen, cx, railY - dropH, backZ + rodLen / 2, 'z');  // нижний пруток (штанга-вешалка)
    addValetRod(dropH, cx, railY - dropH / 2, backZ, 'y');            // стойка вверх сзади

    // Два прутка вдоль ширины, соединяющие середины нижних граней кронштейнов (левого и
    // правого) — отдельно спереди и сзади.
    const bracketBottomY = shelfBottomY - 7 - 15 / 2;
    addValetRod(VALET_LOOP_WIDTH, cx, bracketBottomY, backZ, 'x');
    addValetRod(VALET_LOOP_WIDTH, cx, bracketBottomY, frontZ, 'x');
  }

  sections.forEach((sec, s) => {
    const cx = sectionCenters[s];
    // Без зазора — полки/жёсткость/штанга/ящики примыкают к стойкам/перегородке вплотную.
    const sw = sec.width;

    // Дефолтная пара полок: верхняя и нижняя, задают границы зон для доп. полок/штанги.
    // Для очень низких секций отступы сжимаются к центру, чтобы полки не пересеклись.
    let topShelfY = fillTop - TOP_SHELF_GAP;
    let bottomShelfY = fillBottom + BOTTOM_SHELF_GAP;
    if (topShelfY - bottomShelfY < MIN_ZONE_GAP) {
      const mid = (fillTop + fillBottom) / 2;
      topShelfY = mid + MIN_ZONE_GAP / 2;
      bottomShelfY = mid - MIN_ZONE_GAP / 2;
    }
    addPanel(sw, t, innerDepth, nColor, [cx, y0 + topShelfY, innerZ]);
    totalShelves += 1;
    // Нижняя, в отличие от верхней, съёмная — но её позиция всё равно остаётся границей зон
    // для доп. полок снизу и штанги №2, даже когда сама панель не рисуется.
    if (sec.bottomShelf) {
      addPanel(sw, t, innerDepth, nColor, [cx, y0 + bottomShelfY, innerZ]);
      totalShelves += 1;
    }

    if (sec.valet) {
      addValet(cx, y0 + topShelfY, sec.valetLength);
      totalValet += 1;
    }

    // Ящики стоят над нижней полкой (на её верхней грани), а если полку убрали — прямо на
    // дне короба.
    if (sec.drawers > 0) {
      const gap = 4;
      const baseY = sec.bottomShelf ? bottomShelfY + t / 2 : fillBottom;
      for (let i = 0; i < sec.drawers; i++) {
        const y = baseY + i * (sec.drawerHeight + gap) + sec.drawerHeight / 2;
        addDrawer(cx, y, sw, sec);
      }
      totalDrawers += sec.drawers;
      if (sec.drawerSoftClose) totalDrawerSoft += sec.drawers; else totalDrawerBasic += sec.drawers;
    }

    // Сетчатые полки — независимое от ящиков поле, тоже строятся снизу вверх (максимум 3шт).
    if (sec.meshShelves > 0) {
      const baseY = sec.bottomShelf ? bottomShelfY + t / 2 : fillBottom;
      for (let i = 0; i < sec.meshShelves; i++) {
        const y = baseY + MESH_THICKNESS / 2 + i * MESH_PITCH;
        addMeshShelf(cx, y0 + y, sw, sec.meshDepth, sec.meshColor);
      }
      totalMeshShelves += sec.meshShelves;
    }

    // Планка жёсткости под верхней полкой — не нужна, если задняя стенка сама держит форму (ЛДСП).
    // Вертикальная пластина (перпендикулярно полке, свисает вниз от неё), стоит в плоскости
    // задней стенки — не лежит плашмя на всю глубину полки, как раньше.
    if (state.backWall !== 'ldsp') {
      const stiffenerZ = -depth / 2 + STIFFENER_THICKNESS / 2;
      const stiffenerY = topShelfY - t / 2 - STIFFENER_HEIGHT / 2;
      addPanel(sw, STIFFENER_HEIGHT, STIFFENER_THICKNESS, nColor, [cx, y0 + stiffenerY, stiffenerZ]);
    }

    // Доп. полки сверху (между верхней границей и верхней полкой) и снизу (между верхней и нижней полкой).
    if (sec.shelvesTop > 0) {
      const usable = fillTop - topShelfY;
      for (let i = 0; i < sec.shelvesTop; i++) {
        const y = topShelfY + (usable * (i + 1)) / (sec.shelvesTop + 1);
        addPanel(sw, t, innerDepth, nColor, [cx, y0 + y, innerZ]);
      }
      totalShelves += sec.shelvesTop;
    }
    if (sec.shelvesBottom > 0) {
      const usable = topShelfY - bottomShelfY;
      for (let i = 0; i < sec.shelvesBottom; i++) {
        const y = bottomShelfY + (usable * (i + 1)) / (sec.shelvesBottom + 1);
        addPanel(sw, t, innerDepth, nColor, [cx, y0 + y, innerZ]);
      }
      totalShelves += sec.shelvesBottom;
    }

    // Штанга №1 — фиксированно под верхней полкой; штанга №2 (если выбраны обе) — посередине
    // между штангой №1 и нижней полкой.
    const rodCount = Math.max(0, Math.min(2, sec.rod || 0));
    if (rodCount >= 1) {
      const rod1Y = topShelfY - ROD_BELOW_TOP_SHELF;
      addRod(cx, rod1Y, sw);
      if (rodCount === 2) addRod(cx, (rod1Y + bottomShelfY) / 2, sw);
      totalRod += rodCount;
    }
  });

  return {
    door: doorCount, drawer: totalDrawers, shelf: totalShelves, rod: totalRod, item: 1,
    drawerSoft: totalDrawerSoft, drawerBasic: totalDrawerBasic, meshShelf: totalMeshShelves, valet: totalValet,
  };
}
