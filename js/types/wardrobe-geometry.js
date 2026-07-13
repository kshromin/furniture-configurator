import * as THREE from 'three';
import { state, PANEL_THICKNESS } from '../core/state.js';
import { addPanel, furnitureGroup } from '../core/scene.js';
import { getColor } from '../core/materials.js';
import { DOOR_DEPTH_ZONE, TOP_SHELF_GAP, MESH_DEPTHS, VALET_LENGTHS, BASKET_WIDTHS, BASKET_DEPTHS_BY_WIDTH } from './wardrobe-constants.js';
import {
  effectiveDoorSpan, rebalanceSections, getDoorCount,
  maxDrawerDepth, availableMeshDepths, availableValetLengths, backWallClearance, valetBackClearance,
  drawerBoxSize, basketFits, availableBasketDepths,
} from './wardrobe-sizing.js';
import { sectionVerticalBounds, clampItemPositions, resolveValetAnchorY } from './wardrobe-items.js';

// Геометрия/рендер: собственно построение 3D-модели шкафа-купе (buildWardrobeBox) — короб,
// двери, наполнение секций. Опирается на wardrobe-sizing.js (сколько места доступно) и
// wardrobe-items.js (где сейчас стоит каждый элемент) как на готовые данные, сама не считает
// доступные размеры и не разруливает коллизии — только рисует по уже готовым позициям.

// Двери купе едут по рельсам, вынесенным в переднюю зону короба (как у Командор) —
// это съедает часть глубины у наполнения, но не у самого короба (короб — на полную глубину).
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

// Жёсткость — вертикальная пластина, свисающая вниз от полки (перпендикулярно ей, не лежит
// плашмя как полка), стоит в плоскости задней стенки. STIFFENER_THICKNESS — тонкий размер
// пластины (вдоль глубины, впритык к задней стенке), STIFFENER_HEIGHT — на сколько свисает вниз.
export const STIFFENER_THICKNESS = 10;
export const STIFFENER_HEIGHT = 100;
const ROD_COLOR = 0xc0c0c0; // хром
const ROD_RADIUS = 12.5; // диаметр штанги 25мм

// Сетчатые полки — независимое от ящиков поле, тоже строятся снизу вверх (максимум 3шт),
// но ширина всегда во всю секцию (как обычная полка), а фиксированный выбор глубины (300/400/500мм)
// ограничен реальной доступной глубиной наполнения (innerDepth = глубина короба − дверная зона
// − толщина задней стенки, если она есть, см. backWallClearance).
const MESH_WIRE = 4;  // толщина частых прутков решётки
const MESH_WIRE_STEP = 25; // шаг частых прутков вдоль ШИРИНЫ (сами прутки идут вдоль глубины)
const MESH_LIP_HEIGHT = 35; // высота загиба переднего края

// silver/white — исходно для сетчатой полки (2 цвета); black добавлен для корзин (3 цвета) —
// без явной ветки 'black' раньше проваливался в белую по умолчанию (белая проволока вместо чёрной).
function meshShelfMaterialProps(colorKey) {
  if (colorKey === 'silver') return { color: 0xc0c0c0, metalness: 0.7, roughness: 0.25 };
  if (colorKey === 'black')  return { color: 0x1c1c1c, metalness: 0.4, roughness: 0.35 };
  return { color: 0xf2f2f2, metalness: 0.05, roughness: 0.5 }; // white
}

// Торцевое вешало — выдвижная штанга-петля (см. mdm-complect.ru/catalog/shtangi/36654):
// телескопический рельс, крепится саморезами к самой верхней полке. valetLength — габарит
// ВСЕГО вешала целиком, включая кронштейны с обоих концов (как у реального товара) — прутки
// внутри короче на глубину кронштейна с каждого конца, но весь узел (кронштейн-кронштейн)
// укладывается ровно в заявленный размер и не вылезает за реальную доступную глубину.
// П-образный пруток (петля) тянется вдоль глубины. Показываем в выдвинутом положении.
const VALET_LOOP_WIDTH = 60; // ширина петли штанги
const VALET_ROD_RADIUS = 4;
const VALET_COLOR = 0xc0c0c0;
const VALET_BRACKET_DEPTH = 20; // глубина кронштейна (совпадает с 'd' в addPanel ниже)

// Сетчатые корзины — реальный типоразмерный ряд, геометрия — см. addBasket ниже.
const BASKET_WIRE = 4;
// Один общий шаг и для дна (в обе стороны — вдоль глубины и вдоль ширины), и для вертикальных
// стоек стенок — по просьбе пользователя дно чуть реже (было 25мм), а стойки чуть чаще
// (было 70мм), и то и другое сошлось к одному значению.
export const BASKET_WIRE_STEP = 35;
export const BASKET_TAPER = 60; // на столько уже дно корзины, чем верх (трапеция), по ширине
const BASKET_MIN_BOTTOM_WIDTH = 150; // страховка от вырожденной геометрии при малой ширине
export const BASKET_RAIL_HEIGHT = 40; // направляющая — планка на стойке под дном корзины
export const BASKET_RAIL_WIDTH = 15;
const BASKET_RAIL_COLOR = 0xb0b0b4; // тот же металлик, что у дверных рельс/кронштейнов вешала
const BASKET_CLIP_HEIGHT = 10; // полосы, соединяющие корзину со стойкой/направляющей
const BASKET_CLIP_DEPTH = 20;

// Общий клампинг фиксированных размеров (глубина ящика/сетки, длина вешала) под текущую
// глубину короба. Вызывается и из build() (чтобы геометрия не вылезала за реальные границы),
// и из renderSectionsList() (чтобы <select> в UI сразу показывал уже подрезанное значение —
// иначе браузер молча выбирает первый вариант списка, пока значение не совпадёт ни с одной
// опцией, и в поле показывается не то, что реально построено).
export function clampSectionSizes(sections, depth) {
  const maxDD = maxDrawerDepth(depth);
  const meshAvail = availableMeshDepths(depth);
  const valetAvail = availableValetLengths(depth);
  const { fillBottom, fillTop } = sectionVerticalBounds();
  sections.forEach(sec => {
    if (sec.drawerDepth > maxDD) sec.drawerDepth = maxDD;
    // Если ни одна глубина сетчатой полки больше не влезает — убираем сетчатые полки из items
    // (та же логика, что у корзины ниже); раньше молча падало на MESH_DEPTHS[0], хотя полка уже
    // не влезала — торчала наружу вместо того, чтобы исчезнуть.
    if (meshAvail.length) {
      if (!meshAvail.includes(sec.meshDepth)) sec.meshDepth = meshAvail[meshAvail.length - 1];
    } else {
      sec.meshDepth = MESH_DEPTHS[0];
      sec.items = sec.items.filter(it => it.type !== 'mesh');
    }
    // Аналогично для вешала — если ни один заявленный размер больше не влезает, гасим галочку.
    if (valetAvail.length) {
      if (!valetAvail.includes(sec.valetLength)) sec.valetLength = valetAvail[valetAvail.length - 1];
    } else {
      sec.valetLength = VALET_LENGTHS[0];
      sec.valet = 0;
    }
    if (!BASKET_WIDTHS.includes(sec.basketWidth)) sec.basketWidth = BASKET_WIDTHS[0];
    const basketDepthAvail = availableBasketDepths(sec.basketWidth, depth);
    if (basketDepthAvail.length) {
      // Шкаф стал мельче — уже построенная корзина подрезается до наибольшей ещё влезающей
      // глубины (та же логика, что и у глубины ящика — maxDrawerDepth/drawerDepth).
      if (!basketDepthAvail.includes(sec.basketDepth)) sec.basketDepth = basketDepthAvail[basketDepthAvail.length - 1];
    } else {
      // Ни один вариант глубины для этой ширины корзины больше не влезает в шкаф вообще —
      // подрезать нечего, корзина физически не влезет ни при какой доступной глубине.
      // Показываем в UI дефолтную глубину (первую из типоразмерного ряда), но убираем из items.
      sec.basketDepth = BASKET_DEPTHS_BY_WIDTH[sec.basketWidth][0];
      sec.items = sec.items.filter(it => it.type !== 'basket');
    }
    // Тихая защита данных: если ширина секции разошлась с обязательным проёмом (например, из-за
    // ребаланса других секций), корзину включать нельзя — убираем без тоста (тост — только
    // при прямом действии пользователя, см. тосты в tabs.js).
    if (!basketFits(sec)) sec.items = sec.items.filter(it => it.type !== 'basket');
    // Вешало — если якорная полка исчезла (удалена мышкой), сброс на дефолт (структурная полка).
    if (sec.valetAnchorId && !sec.items.some(it => it.id === sec.valetAnchorId)) sec.valetAnchorId = null;
    clampItemPositions(sec, fillBottom, fillTop);
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

// Транзиентные реестры "что было построено в последней сборке" — не часть state (не
// сохраняются/не сериализуются), только для js/core/itemDrag.js, чтобы не гонять raycaster по
// всей сцене на каждый кадр драга. Пересоздаются (не мутируются) в начале каждой сборки — ES-
// модули отдают "живые" биндинги, так что импортёры всегда видят актуальную ссылку.
// lastBuildItemMeshes: ключ "sectionIndex|itemId" -> mesh[] (перетаскиваемые элементы).
// lastBuildValetMeshes: ключ sectionIndex -> mesh[] (вешало — не перетаскивается свободно, снап).
// lastBuildSectionCenters/lastBuildY0: мировые X-центры секций и смещение цоколя по Y — нужны
// js/core/dimensions.js, чтобы проецировать точки размерных линий в мировые координаты той же
// сборки, не дублируя формулу расчёта cursorX/y0 здесь и там.
export let lastBuildItemMeshes = new Map();
export let lastBuildValetMeshes = new Map();
export let lastBuildSectionCenters = [];
export let lastBuildY0 = 0;

function tagItemMesh(mesh, sectionIndex, item) {
  if (!mesh) return;
  mesh.userData.sectionIndex = sectionIndex;
  mesh.userData.itemId = item.id;
  mesh.userData.itemType = item.type;
  const key = sectionIndex + '|' + item.id;
  if (!lastBuildItemMeshes.has(key)) lastBuildItemMeshes.set(key, []);
  lastBuildItemMeshes.get(key).push(mesh);
}

function tagValetMeshes(meshes, sectionIndex) {
  meshes.forEach(mesh => {
    if (!mesh) return;
    mesh.userData.sectionIndex = sectionIndex;
    mesh.userData.itemType = 'valet';
  });
  lastBuildValetMeshes.set(sectionIndex, meshes.filter(Boolean));
}

// Общий короб для шкафа-купе / распашного / открытого — сегодня они выглядят одинаково
// (двери купе рисуются всегда), различия по дверям будут добавлены отдельно для каждого типа.
export function buildWardrobeBox() {
  const { width, depth, plinthEnabled, plinthHeight, noSideLeft, noSideRight, noCeiling, noBottom } = state;
  const t = PANEL_THICKNESS;
  lastBuildItemMeshes = new Map();
  lastBuildValetMeshes = new Map();
  lastBuildSectionCenters = [];
  const kColor = getColor('korpus').color;
  const fColor = getColor('fasad').color;
  const nColor = getColor('fill').color;

  // Без дна нечему опираться на цоколь — он тоже пропадает, даже если галочка стоит.
  const plinthH = (plinthEnabled && !noBottom) ? plinthHeight : 0;
  // Цоколь занимает нижнюю часть общей высоты изделия — короб над ним ниже на эту величину.
  const height = state.height - plinthH;
  const y0 = plinthH; // низ короба, всё остальное строится как раньше, но с этим смещением
  lastBuildY0 = y0;

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
  const {
    spanW, leftOff, rightOff, topOff, bottomOff,
    stojkaTopOff, stojkaBottomOff, stojkaLeftOff, stojkaRightOff, innerSpanW,
  } = effectiveDoorSpan();
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
    addPanel(width - stojkaLeftOff - stojkaRightOff, stojkaH, bwThick, bwColor, [0, stojkaCenterY, -depth / 2 + bwThick / 2]);
  }

  // Наполнение (перегородки, полки) не занимает дверную зону и прижато к задней стенке —
  // короб при этом остаётся на полную глубину.
  const innerDepth = depth - DOOR_DEPTH_ZONE;
  const innerZ = -DOOR_DEPTH_ZONE / 2;

  // Ширины секций хранятся как есть в state.sections; здесь только страховка на случай, если
  // что-то изменило границы короба (габариты, стойки, выравниватели) и не вызвало rebalanceSections()
  // само — без этого секции могли бы не долетать до края короба или вылезать за него. Считаем
  // от innerSpanW (реальная ширина до стены), а не spanW (дверной пролёт) — наполнение должно
  // доходить до стены независимо от планки/короба на стойке.
  const sections = state.sections;
  {
    const available = innerSpanW - (sections.length - 1) * t;
    const sum = sections.reduce((s, sec) => s + sec.width, 0);
    if (Math.abs(sum - available) > 0.5) rebalanceSections();
  }
  clampSectionSizes(sections, depth);
  const sectionCenters = [];
  {
    let cursorX = -width / 2 + stojkaLeftOff;
    sections.forEach((sec, i) => {
      sectionCenters.push(cursorX + sec.width / 2);
      cursorX += sec.width;
      if (i < sections.length - 1) {
        addPanel(t, stojkaH, innerDepth, nColor, [cursorX + t / 2, stojkaCenterY, innerZ]);
        cursorX += t;
      }
    });
  }
  lastBuildSectionCenters = sectionCenters;

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

  // fillBottom/fillTop — общая для всех секций (см. sectionVerticalBounds) — та же формула, что
  // уже посчитана здесь (bottomOff/topOff/height в области видимости), вынесена в общую функцию,
  // чтобы clampSectionSizes/renderSectionsList считали идентично, не дублируя.
  const { fillBottom, fillTop } = sectionVerticalBounds();
  // Граница дверной зоны — та же, что и у полок/перегородки (innerZ ± innerDepth/2): ящики
  // должны быть с ней вровень, а не торчать вперёд к самим дверям.
  const frontZ = depth / 2 - DOOR_DEPTH_ZONE;
  let totalShelves = 0, totalDrawers = 0, totalRod = 0, totalDrawerSoft = 0, totalDrawerBasic = 0, totalMeshShelves = 0, totalValet = 0, totalBaskets = 0;

  function addRod(cx, y, sw) {
    const rodGeo = new THREE.CylinderGeometry(ROD_RADIUS, ROD_RADIUS, sw, 24);
    const rodMat = new THREE.MeshStandardMaterial({ color: ROD_COLOR, metalness: 0.9, roughness: 0.15 });
    const rodMesh = new THREE.Mesh(rodGeo, rodMat);
    rodMesh.rotation.z = Math.PI / 2;
    rodMesh.position.set(cx, y0 + y, innerZ);
    furnitureGroup.add(rodMesh);
    return rodMesh;
  }

  // Ящик = фасад (лицевая панель, цвет фасада, вровень с перегородкой) + короб позади него
  // (дно/боковины/задняя стенка, цвет наполнения/ЛДСП, чуть уже фасада). Глубина короба
  // ограничена, чтобы не вылезти за заднюю стенку короба шкафа.
  function addDrawer(cx, y, sw, sec) {
    const dh = sec.drawerHeight;
    const facadeZ = frontZ - t / 2;
    const { boxW, boxH, boxDepth } = drawerBoxSize(sw, dh, sec.drawerDepth, depth);
    const boxCenterZ = facadeZ - t / 2 - boxDepth / 2;

    return [
      addPanel(sw, dh, t, fColor, [cx, y0 + y, facadeZ], 0.9), // фасад
      addPanel(boxW, t, boxDepth, nColor, [cx, y0 + y - boxH / 2 + t / 2, boxCenterZ]),      // дно короба
      addPanel(t, boxH, boxDepth, nColor, [cx - boxW / 2 + t / 2, y0 + y, boxCenterZ]),      // левая боковина
      addPanel(t, boxH, boxDepth, nColor, [cx + boxW / 2 - t / 2, y0 + y, boxCenterZ]),      // правая боковина
      addPanel(boxW, boxH, t, nColor, [cx, y0 + y, boxCenterZ - boxDepth / 2 + t / 2]),       // задняя стенка короба
    ];
  }

  // Тонкая планка без чёрного контура (addPanel рисует его всегда, для десятков тонких прутков
  // это выглядело бы захламлённо) — металлик/белый по выбранному цвету.
  function addBar(w, h, d, x, y, z, colorKey) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(meshShelfMaterialProps(colorKey)));
    mesh.position.set(x, y, z);
    furnitureGroup.add(mesh);
    return mesh;
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
    return mesh;
  }

  // Наклонный пруток между двумя произвольными точками — обычный addRodBar умеет только строго
  // вдоль осей x/y/z, а трапециевидным стойкам корзины нужен реальный наклон.
  function addRodBetween(p1, p2, radius, colorKey) {
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], dz = p2[2] - p1[2];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(meshShelfMaterialProps(colorKey)));
    mesh.position.set((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    furnitureGroup.add(mesh);
    return mesh;
  }

  // Сетчатая полка — сделана из круглой проволоки (не плоских планок). Частые тонкие прутки
  // идут ВДОЛЬ ГЛУБИНЫ, с шагом 25мм вдоль ширины, и тянутся сквозь все силовые прутки без
  // разрыва. У КАЖДОГО такого прутка свой отдельный загиб-крючок на переднем конце — приподнят
  // на 35мм. Силовых прутков поперёк (вдоль ширины) — 4: задний ровно на заднем крае (им
  // заканчивается полка), второй чуть ближе к переднему краю от середины, третий у основания
  // загиба (на высоте прутков, в лицевой плоскости), четвёртый замыкает загиб сверху (на высоте
  // окончания крючков).
  function addMeshShelf(cx, y, sw, meshDepth, colorKey) {
    // Если есть задняя стенка, полка не должна протыкать её насквозь — сдвигаем задний край
    // вперёд на её толщину (см. backWallClearance).
    const backZ = -depth / 2 + backWallClearance();
    const frontZ = backZ + meshDepth;
    const wireR = MESH_WIRE / 2;
    const crossR = MESH_WIRE * 1.3 / 2;
    const m = [];

    const nWires = Math.max(6, Math.round(sw / MESH_WIRE_STEP));
    for (let i = 0; i <= nWires; i++) {
      const wx = cx - sw / 2 + (sw * i) / nWires;
      m.push(addRodBar(meshDepth, wireR, wx, y, backZ + meshDepth / 2, 'z', colorKey));
      m.push(addRodBar(MESH_LIP_HEIGHT, wireR, wx, y + MESH_LIP_HEIGHT / 2, frontZ, 'y', colorKey)); // свой крючок
    }

    m.push(addRodBar(sw, crossR, cx, y, backZ, 'x', colorKey));                       // 1: задний, на краю
    m.push(addRodBar(sw, crossR, cx, y, backZ + meshDepth * 0.6, 'x', colorKey));     // 2: чуть ближе к переду от середины
    m.push(addRodBar(sw, crossR, cx, y, frontZ, 'x', colorKey));                      // 3: у основания загиба
    m.push(addRodBar(sw, crossR, cx, y + MESH_LIP_HEIGHT, frontZ, 'x', colorKey));    // 4: замыкает загиб сверху
    return m;
  }

  // Сетчатая корзина — открытый сверху проволочный короб (дно + 4 стенки), выкатной, типоразмер
  // жёстко привязан к ширине секции (см. basketFits/requiredBasketProyom). Физическая ширина
  // корзины — basketWidth (меньше ширины секции на BASKET_PROYOM_GAP — это зазор под
  // направляющие), центрирована в секции. В проекции (вид спереди) — трапеция: дно уже верха на
  // BASKET_TAPER мм по ширине (реальная форма выкатных корзин, не прямоугольный короб). Глубина
  // не сужается — только ширина. Дно и вертикальные стойки стенок используют один и тот же шаг
  // BASKET_WIRE_STEP (дно — реже, чем было раньше, стойки — чаще).
  function addBasket(cx, yBottom, sw, basketWidth, basketDepth, basketHeight, colorKey) {
    // Если есть задняя стенка, корзина не должна протыкать её насквозь — сдвигаем задний край
    // вперёд на её толщину (см. backWallClearance).
    const backZ = -depth / 2 + backWallClearance();
    const frontZ = backZ + basketDepth;
    const yTop = yBottom + basketHeight;
    const wireR = BASKET_WIRE / 2;
    const m = [];

    const widthTop = basketWidth;
    const widthBottom = Math.max(basketWidth - BASKET_TAPER, BASKET_MIN_BOTTOM_WIDTH);
    const leftXTop = cx - widthTop / 2;
    const leftXBottom = cx - widthBottom / 2;

    // X-координата на произвольной высоте y для прутка, который у верхнего (широкого) края
    // находится в доле t (0..1) поперёк ширины — линейная интерполяция между широким верхом и
    // узким низом даёт правильную трапецию на любой высоте.
    function xAt(t, y) {
      const topX = leftXTop + widthTop * t;
      const botX = leftXBottom + widthBottom * t;
      const k = (y - yBottom) / basketHeight;
      return botX + (topX - botX) * k;
    }

    const nW = Math.max(4, Math.round(widthTop / BASKET_WIRE_STEP));   // прутков поперёк ширины
    const nD = Math.max(2, Math.round(basketDepth / BASKET_WIRE_STEP)); // прутков поперёк глубины

    // Дно — сетка в обе стороны (не только вдоль глубины, как раньше, но и вдоль ширины), на
    // уровне нижнего (узкого) края.
    for (let i = 0; i <= nW; i++) {
      const wx = xAt(i / nW, yBottom);
      m.push(addRodBar(basketDepth, wireR, wx, yBottom, backZ + basketDepth / 2, 'z', colorKey));
    }
    for (let i = 0; i <= nD; i++) {
      const wz = backZ + (basketDepth * i) / nD;
      m.push(addRodBar(widthBottom, wireR, cx, yBottom, wz, 'x', colorKey));
    }

    // Стенка вдоль ширины (перед/зад): широкий верхний рельс + узкий нижний рельс + наклонные
    // стойки между ними.
    function wallAlongWidth(z) {
      m.push(addRodBar(widthTop,    wireR, cx, yTop,    z, 'x', colorKey));
      m.push(addRodBar(widthBottom, wireR, cx, yBottom, z, 'x', colorKey));
      for (let i = 0; i <= nW; i++) {
        const t = i / nW;
        m.push(addRodBetween([xAt(t, yTop), yTop, z], [xAt(t, yBottom), yBottom, z], wireR, colorKey));
      }
    }
    // Стенка вдоль глубины (t=0 — левая, t=1 — правая): рельсы горизонтальны (глубина не
    // сужается), но сама стенка наклонена внутрь у дна — те же наклонные стойки.
    function wallAlongDepth(t) {
      m.push(addRodBar(basketDepth, wireR, xAt(t, yTop),    yTop,    backZ + basketDepth / 2, 'z', colorKey));
      m.push(addRodBar(basketDepth, wireR, xAt(t, yBottom), yBottom, backZ + basketDepth / 2, 'z', colorKey));
      for (let i = 0; i <= nD; i++) {
        const wz = backZ + (basketDepth * i) / nD;
        m.push(addRodBetween([xAt(t, yTop), yTop, wz], [xAt(t, yBottom), yBottom, wz], wireR, colorKey));
      }
    }
    wallAlongWidth(backZ);
    wallAlongWidth(frontZ);
    wallAlongDepth(0);
    wallAlongDepth(1);

    // Направляющие — планки, прижатые к стойкам СЕКЦИИ (sw — реальная ширина секции, не
    // корзины — между ними и есть зазор BASKET_PROYOM_GAP), низ планки ровно на уровне дна
    // корзины (не ниже), сама планка стоит выше этой линии. Глубина совпадает с глубиной
    // корзины. Цвет фиксированный — металлик, как у дверных рельс/кронштейнов вешала, не
    // зависит от цвета корзины (реальная фурнитура рельс всегда металлическая).
    const railZCenter = backZ + basketDepth / 2;
    const railYCenter = yBottom + BASKET_RAIL_HEIGHT / 2;
    const stojkaLeftX  = cx - sw / 2;
    const stojkaRightX = cx + sw / 2;
    const leftRailX  = stojkaLeftX  + BASKET_RAIL_WIDTH / 2;
    const rightRailX = stojkaRightX - BASKET_RAIL_WIDTH / 2;
    m.push(addPanel(BASKET_RAIL_WIDTH, BASKET_RAIL_HEIGHT, basketDepth, BASKET_RAIL_COLOR, [leftRailX,  railYCenter, railZCenter]));
    m.push(addPanel(BASKET_RAIL_WIDTH, BASKET_RAIL_HEIGHT, basketDepth, BASKET_RAIL_COLOR, [rightRailX, railYCenter, railZCenter]));

    // Полосы — соединяют корзину с направляющей/стойкой у переднего и заднего торца (2 слева +
    // 2 справа = 4 всего). Ширина — от самой стойки до касания корзины (перекрывает и
    // направляющую тоже), высота 10мм, глубина (по Z) 20мм, низ строго на уровне дна корзины
    // (не ниже — yBottom, планка стоит НАД этой линией, а не свисает под неё).
    const rightXBottom = cx + widthBottom / 2;
    const leftStripW  = leftXBottom  - stojkaLeftX;
    const rightStripW = stojkaRightX - rightXBottom;
    const leftStripX  = (stojkaLeftX  + leftXBottom)  / 2;
    const rightStripX = (stojkaRightX + rightXBottom) / 2;
    const stripYCenter = yBottom + BASKET_CLIP_HEIGHT / 2;
    const stripZFront = backZ + basketDepth - BASKET_CLIP_DEPTH / 2;
    const stripZBack  = backZ + BASKET_CLIP_DEPTH / 2;
    [[leftStripX, leftStripW], [rightStripX, rightStripW]].forEach(([sx, w]) => {
      m.push(addPanel(w, BASKET_CLIP_HEIGHT, BASKET_CLIP_DEPTH, BASKET_RAIL_COLOR, [sx, stripYCenter, stripZFront]));
      m.push(addPanel(w, BASKET_CLIP_HEIGHT, BASKET_CLIP_DEPTH, BASKET_RAIL_COLOR, [sx, stripYCenter, stripZBack]));
    });
    return m;
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
    const envBackZ = -depth / 2 + valetBackClearance() + backWallClearance();
    const backZ = envBackZ + VALET_BRACKET_DEPTH / 2;
    const frontZ = envBackZ + valetLength - VALET_BRACKET_DEPTH / 2;
    const rodLen = frontZ - backZ;

    const m = [
      addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx - half, shelfBottomY - 7, backZ]),  // кронштейн задний левый
      addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx + half, shelfBottomY - 7, backZ]),  // кронштейн задний правый
      addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx - half, shelfBottomY - 7, frontZ]), // кронштейн передний левый
      addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx + half, shelfBottomY - 7, frontZ]), // кронштейн передний правый
    ];

    const mat = { color: VALET_COLOR, metalness: 0.8, roughness: 0.2 };
    const addValetRod = (length, x, y, z, axis) => {
      const geo = new THREE.CylinderGeometry(VALET_ROD_RADIUS, VALET_ROD_RADIUS, length, 10);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(mat));
      if (axis === 'x') mesh.rotation.z = Math.PI / 2;
      else if (axis === 'z') mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, z);
      furnitureGroup.add(mesh);
      return mesh;
    };
    m.push(addValetRod(rodLen, cx, railY, backZ + rodLen / 2, 'z'));          // верхний пруток (рельс у полки)
    m.push(addValetRod(dropH, cx, railY - dropH / 2, frontZ, 'y'));           // стойка вниз спереди
    m.push(addValetRod(rodLen, cx, railY - dropH, backZ + rodLen / 2, 'z'));  // нижний пруток (штанга-вешалка)
    m.push(addValetRod(dropH, cx, railY - dropH / 2, backZ, 'y'));            // стойка вверх сзади

    // Два прутка вдоль ширины, соединяющие середины нижних граней кронштейнов (левого и
    // правого) — отдельно спереди и сзади.
    const bracketBottomY = shelfBottomY - 7 - 15 / 2;
    m.push(addValetRod(VALET_LOOP_WIDTH, cx, bracketBottomY, backZ, 'x'));
    m.push(addValetRod(VALET_LOOP_WIDTH, cx, bracketBottomY, frontZ, 'x'));
    return m;
  }

  sections.forEach((sec, s) => {
    const cx = sectionCenters[s];
    // Без зазора — полки/жёсткость/штанга/ящики примыкают к стойкам/перегородке вплотную.
    const sw = sec.width;

    // Страховка: подрезаем позиции под текущие границы секции на случай прямого вызова build()
    // в обход clampSectionSizes (renderSectionsList вызывает его сама, buildFurniture — тоже, но
    // геометрия должна быть защищена независимо от порядка вызовов).
    clampItemPositions(sec, fillBottom, fillTop);

    if (sec.valet) {
      const anchorY = resolveValetAnchorY(sec);
      const valetMeshes = addValet(cx, y0 + anchorY, sec.valetLength);
      tagValetMeshes(valetMeshes, s);
      totalValet += 1;
    }

    // Свободно перетаскиваемое мышкой наполнение — каждый элемент рисуется по своей сохранённой
    // Y-позиции (item.y — центр полосы коллизии), без какого-либо алгоритмического распределения.
    sec.items.forEach(item => {
      switch (item.type) {
        case 'shelf': {
          const mesh = addPanel(sw, t, innerDepth, nColor, [cx, y0 + item.y, innerZ]);
          tagItemMesh(mesh, s, item);
          totalShelves += 1;
          break;
        }
        case 'drawer': {
          // Направляющие ящика крепятся к боковой стойке — без неё крепить некуда, не строим.
          if (noSideLeft || noSideRight) break;
          const meshes = addDrawer(cx, item.y, sw, sec);
          meshes.forEach(m => tagItemMesh(m, s, item));
          totalDrawers += 1;
          if (sec.drawerSoftClose) totalDrawerSoft += 1; else totalDrawerBasic += 1;
          break;
        }
        case 'mesh': {
          const meshes = addMeshShelf(cx, y0 + item.y, sw, sec.meshDepth, sec.meshColor);
          meshes.forEach(m => tagItemMesh(m, s, item));
          totalMeshShelves += 1;
          break;
        }
        case 'basket': {
          // Как и ящик — нужна боковая стойка; плюс ширина секции строго равна обязательному
          // проёму (basketFits) — clampSectionSizes уже убрал корзины из items, если не совпало,
          // но проверяем ещё раз на случай прямого вызова build() в обход клампа.
          if (noSideLeft || noSideRight || !basketFits(sec)) break;
          const yBottom = item.y - sec.basketHeight / 2; // item.y — центр, addBasket ждёт низ
          const meshes = addBasket(cx, y0 + yBottom, sw, sec.basketWidth, sec.basketDepth, sec.basketHeight, sec.basketColor);
          meshes.forEach(m => tagItemMesh(m, s, item));
          totalBaskets += 1;
          break;
        }
        case 'rod': {
          const mesh = addRod(cx, item.y, sw);
          tagItemMesh(mesh, s, item);
          totalRod += 1;
          break;
        }
      }
    });

    // Планка жёсткости под верхней (структурной, pinned) полкой — не нужна, если задняя стенка
    // сама держит форму (ЛДСП). Вертикальная пластина (перпендикулярно полке, свисает вниз от
    // неё), стоит в плоскости задней стенки. Полка теперь перетаскиваемая — жёсткость висит от
    // её ТЕКУЩЕЙ (возможно, перетащенной) позиции, а не от фиксированной константы.
    if (state.backWall !== 'ldsp') {
      const pinnedItem = sec.items.find(it => it.type === 'shelf' && it.pinned);
      const pinnedY = pinnedItem ? pinnedItem.y : fillTop - TOP_SHELF_GAP;
      const stiffenerZ = -depth / 2 + STIFFENER_THICKNESS / 2;
      const stiffenerY = pinnedY - t / 2 - STIFFENER_HEIGHT / 2;
      const stiffenerMesh = addPanel(sw, STIFFENER_HEIGHT, STIFFENER_THICKNESS, nColor, [cx, y0 + stiffenerY, stiffenerZ]);
      if (pinnedItem) tagItemMesh(stiffenerMesh, s, pinnedItem);
    }
  });

  return {
    door: doorCount, drawer: totalDrawers, shelf: totalShelves, rod: totalRod, item: 1,
    drawerSoft: totalDrawerSoft, drawerBasic: totalDrawerBasic, meshShelf: totalMeshShelves, valet: totalValet,
    basket: totalBaskets,
  };
}
