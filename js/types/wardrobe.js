import { state, materials, PANEL_THICKNESS } from '../core/state.js';
import { korpusBoxAreaM2 } from '../core/pricing.js';
import { getColor } from '../core/materials.js';
import {
  buildWardrobeBox, getDoorCount, effectiveDoorSpan, drawerBoxSize, basketFits, sectionMissingSideSupport,
  sectionBackWallSegments, doorCustomSegments, clampDrawerOffsetWidth,
  DOOR_DEPTH_ZONE, DOOR_OVERLAP, TOP_RAIL_HEIGHT, BOTTOM_RAIL_HEIGHT, STIFFENER_HEIGHT, SWING_GAP,
} from './_wardrobe-shared.js';

// Ставка наполнения двери, ₽/м² (общая для цены шкафа в areas() и цены одной двери в
// slidingDoorUnitPrice): sp — индивидуальные {name, price} спеццвета секции, colorId —
// индивидуальный цвет секции (ЛДСП — id цвета фасада, стекло — id цвета стекла); без них —
// глобальные значения (цвет фасада, doorGlassColor, specialFillPrice).
export function doorFillRate(f, sp, colorId) {
  if (f === 'mirror') return materials.slidingDoor?.fills?.mirror?.pricePerM2 || 0;
  if (f === 'glass') {
    const cols = materials.slidingDoor?.fills?.glass?.colors || [];
    const c = cols.find(x => x.id === (colorId || state.doorGlassColor)) || cols[0];
    return c?.pricePerM2 || 0;
  }
  if (f === 'special') return sp?.price ?? state.specialFillPrice ?? 0;
  if (colorId) {
    const prod = (materials.fasad?.producers || []).find(p => p.id === state.fasadProducer);
    const c = (prod?.colors || []).find(x => x.id === colorId);
    if (c) return c.pricePerM2;
  }
  return getColor('fasad').pricePerM2;
}

// Ставки профиля купе для текущих state.profile/profileColor: отдельная строка прайса на каждое
// сочетание профиль×цвет (slidingDoor.profilePrices, без коэффициентов — просьба 21.07).
// Фолбэк на базовые ставки профиля — для сочетаний, которых в прайсе нет (старые снапшоты).
export function profileRates() {
  const cat = materials.slidingDoor || {};
  return (cat.profilePrices || []).find(x => x.profile === state.profile && x.color === state.profileColor)
    || (cat.profiles || []).find(p => p.id === state.profile)
    || (cat.profiles || [])[0]
    || null;
}

// Цена одной двери купе целиком: профиль (вертикали+горизонтали+перемычки) + ролики +
// наполнение по секциям. Без общей направляющей (та на весь проём, не на дверь).
// Формулы те же, что в areas() — для инфопанели выделенной двери (js/core/itemDrag.js).
export function slidingDoorUnitPrice(doorIndex, doorW, doorH) {
  const cat = materials.slidingDoor || {};
  const prof = profileRates();
  const custom = state.doorCustom?.[doorIndex];
  const { segments, dividers } = doorCustomSegments(custom, doorH);
  const oneDoorM2 = (doorW * doorH) / 1e6;
  const totalH = segments.reduce((s, x) => s + x.hMm, 0) || 1;
  let fill = 0;
  if (custom) {
    segments.forEach(sgm => { fill += oneDoorM2 * (sgm.hMm / totalH) * doorFillRate(sgm.fill || state.doorFill, sgm.special, sgm.fillColor); });
  } else {
    fill = oneDoorM2 * doorFillRate(state.doorFill, null, null);
  }
  const profile = prof
    ? (2 * doorH / 1000) * prof.vertPerM + (doorW / 1000) * (prof.horizTopPerM + prof.horizBottomPerM) + dividers.length * (doorW / 1000) * (cat.divider?.pricePerM || 0)
    : 0;
  const rollers = cat.rollers?.pricePerSet || 0;
  return { profile, rollers, fill, total: profile + rollers + fill };
}

export default {
  id: 'wardrobe',
  name: 'Шкаф-купе',
  ctx: {
    variant: { doors: true, extra: true },
    fill:    { sections: false, shelves: false, drawers: false, rod: false, color: true, list: true },
    fasad:   { available: true },
  },

  build: buildWardrobeBox,

  areas() {
    const { width, depth, sections, plinthEnabled, plinthHeight, noSideLeft, noSideRight, noCeiling, noBottom } = state;
    const t = PANEL_THICKNESS;
    const plinthH = (plinthEnabled && !noBottom) ? plinthHeight : 0;
    const height = state.height - plinthH;

    const {
      spanW, topOff, bottomOff,
      stojkaTopOff, stojkaBottomOff, stojkaLeftOff, stojkaRightOff,
    } = effectiveDoorSpan();
    const stojkaH = height - stojkaTopOff - stojkaBottomOff;

    let korpusM2 = korpusBoxAreaM2(sections.length - 1, height, {
      top: noCeiling, bottom: noBottom, left: noSideLeft, right: noSideRight,
    }, stojkaH);
    if (plinthH > 0) {
      korpusM2 += (width * (depth - 40)) / 1e6; // цоколь — тот же материал, что корпус
    }

    const dc = getDoorCount(spanW);
    const gap = 4;
    // Купе и распашные — разная геометрия дверей (см. buildWardrobeBox): у купе нахлёст и
    // направляющие, у распашных зазоры 7мм и узкие полосы высотой с нижнюю рельсу.
    let dw, doorH;
    if (state.fasadDoorType === 'swing') {
      dw = (spanW - (dc + 1) * SWING_GAP) / dc;
      doorH = height - topOff - bottomOff - 2 * BOTTOM_RAIL_HEIGHT - 2 * SWING_GAP;
    } else {
      dw = (spanW + (dc - 1) * DOOR_OVERLAP) / dc;
      doorH = height - topOff - bottomOff - TOP_RAIL_HEIGHT - BOTTOM_RAIL_HEIGHT - 2 * gap;
    }
    // Полотна дверей — ОТДЕЛЬНО от фасадов ящиков (fasadM2 ниже): наполнение двери может быть
    // не ЛДСП (зеркало/спеццвет, задание «двери-начали 20,07»), а с перемычками (окно
    // «Комбинированная дверь») — у каждой секции полотна своё наполнение; считаем готовую сумму
    // здесь (та же схема, что и drawerSlidePrice). Фасады ящиков — всегда ЛДСП по цвету фасада.
    // «Без дверей»: конструктив под купе, но двери в стоимость не входят вообще.
    const fillRate = doorFillRate; // общий расчёт ставки — см. экспорт выше
    let fasadM2 = 0;
    let doorFillPrice = 0;

    // Фурнитура/профиль дверей купе (цены-заглушки — единый ценовой хвост): вертикальные
    // профили (2 шт/дверь × высота), горизонтальные верхний и нижний (ширина двери),
    // горизонтальные перемычки (пог. м, по разбивке doorCustom), комплект роликов (шт/дверь),
    // направляющая верх+низ на всю ширину проёма (пог. м). Вид профиля и цвет — общие на все
    // двери (state.profile/profileColor), цены — прайс profilePrices по сочетанию профиль×цвет.
    let doorHardwarePrice = 0;
    if (state.fasadDoorType !== 'none') {
      const sliding = state.fasadDoorType === 'sliding';
      const globalFill = sliding ? state.doorFill : 'ldsp'; // у распашных всегда ЛДСП
      let dividerM = 0;
      for (let i = 0; i < dc; i++) {
        const custom = sliding ? state.doorCustom?.[i] : null;
        const oneDoorM2 = (dw * doorH) / 1e6;
        // Кастом учитывается и БЕЗ перемычек (было custom?.dividers?.length — наполнение всей
        // двери, заданное в редакторе одной секцией, показывалось в 3D, но не попадало в цену)
        if (custom) {
          const { segments, dividers } = doorCustomSegments(custom, doorH);
          const totalH = segments.reduce((s, x) => s + x.hMm, 0) || 1;
          segments.forEach(sgm => { doorFillPrice += oneDoorM2 * (sgm.hMm / totalH) * fillRate(sgm.fill || globalFill, sgm.special, sgm.fillColor); });
          dividerM += (dividers.length * dw) / 1000;
        } else {
          doorFillPrice += oneDoorM2 * fillRate(globalFill, null, null);
        }
      }
      if (sliding) {
        const cat = materials.slidingDoor || {};
        const prof = profileRates(); // прайс профиль×цвет, см. экспорт выше
        if (prof) {
          const vertM = (2 * doorH * dc) / 1000;
          const horizM = (dw * dc) / 1000;
          doorHardwarePrice =
            vertM * prof.vertPerM + horizM * prof.horizTopPerM + horizM * prof.horizBottomPerM +
            dividerM * (cat.divider?.pricePerM || 0) +
            dc * (cat.rollers?.pricePerSet || 0) +
            (spanW / 1000) * (cat.track?.pricePerM || 0);
        }
      }
    }

    // Площадь коробов и планок (материал — корпус)
    const H = state.height;
    function elemM2(noSide, replace, boxW, isHoriz) {
      if (!noSide || replace === 'none') return 0;
      const w = replace === 'box' ? boxW : t;
      return isHoriz
        ? (width * w * 2 + width * DOOR_DEPTH_ZONE + w * DOOR_DEPTH_ZONE * 2) / 1e6
        : (w * H * 2 + w * DOOR_DEPTH_ZONE * 2 + H * DOOR_DEPTH_ZONE) / 1e6;
    }
    const leftBoxM2   = elemM2(state.noSideLeft,  state.leftReplace,   state.leftBoxW,   false);
    const rightBoxM2  = elemM2(state.noSideRight, state.rightReplace,  state.rightBoxW,  false);
    const topBoxM2    = elemM2(state.noCeiling,   state.topReplace,    state.topBoxH,    true);
    const bottomBoxM2 = elemM2(state.noBottom,    state.bottomReplace, state.bottomBoxH, true);

    // Выравнивающие элементы — та же геометрия, что и addPanel в buildWardrobeBox
    const alignerM2 =
      (state.alignerLeft  ? (state.alignerLeftW  * stojkaH) / 1e6 : 0) +
      (state.alignerRight ? (state.alignerRightW * stojkaH) / 1e6 : 0) +
      (state.alignerTop   ? (width * state.alignerTopH) / 1e6 : 0);

    // «Детали 32 мм» точечно (галочки в Опциях + item.thick32 у полок), когда общий режим 16:
    // материал детали ×2 → её площадь добавляется ещё раз. При общем panel32 тот же коэффициент
    // применяет pricing.js ко ВСЕМУ сразу — здесь ноль, иначе был бы двойной счёт. Площади
    // частей — те же формулы, что и в базовом расчёте. Кромка деталей 32мм больше не считается
    // здесь множителем — она уходит в ведро «на 32» при накоплении длины (см. edgeMm ниже).
    let extraKorpusM2 = 0, extraFillM2 = 0;
    if (!state.panel32) {
      const th = state.thick32 || {};
      const B = 16; // базовая толщина формулы площади короба (см. korpusBoxAreaM2)
      if (th.bottom && !noBottom)   extraKorpusM2 += (width * B) / 1e6;
      if (th.top && !noCeiling)     extraKorpusM2 += (width * B) / 1e6;
      if (th.left && !noSideLeft)   extraKorpusM2 += (B * stojkaH) / 1e6;
      if (th.right && !noSideRight) extraKorpusM2 += (B * stojkaH) / 1e6;
      if (th.dividers)              extraKorpusM2 += ((sections.length - 1) * B * stojkaH) / 1e6;
      // планка-замена наследует толщину своей стороны (короба не участвуют — по заданию)
      if (th.left  && state.noSideLeft  && state.leftReplace  === 'planka') extraKorpusM2 += leftBoxM2;
      if (th.right && state.noSideRight && state.rightReplace === 'planka') extraKorpusM2 += rightBoxM2;
      if (th.top   && state.noCeiling   && state.topReplace   === 'planka') extraKorpusM2 += topBoxM2;
      if (th.bottom && state.noBottom   && state.bottomReplace === 'planka') extraKorpusM2 += bottomBoxM2;
    }

    function meshPricePerM(depth, color) {
      const entry = (materials.meshShelf || []).find(m => m.depth === depth && m.color === color);
      return entry ? entry.pricePerM : 0;
    }

    // Сетчатая корзина — готовое изделие фиксированного типоразмера (ширина/глубина/высота/цвет),
    // цена за штуку берётся из каталога, а не считается по площади/погонному метру.
    function basketUnitPrice(width, depth, height, color) {
      const entry = (materials.basket || []).find(b => b.width === width && b.depth === depth && b.height === height && b.color === color);
      return entry ? entry.price : 0;
    }

    // Направляющие ящика — комплект зависит от типа (шариковые/скрытые доводчик/push/BLUM) И
    // длины (= глубина короба ящика, каталог 250-600 с шагом 50) — длиннее направляющая, дороже
    // комплект. См. data/materials.json → drawerSlide (матрица тип×длина), sec.drawerSlideType.
    // Реальная глубина короба (boxDepth в drawerBoxSize) — это ФИЗИЧЕСКИЙ лимит места в шкафу,
    // не обязательно кратный 50 (клампится по остатку места, см. drawerBoxSize в
    // wardrobe-sizing.js) — берём ближайшую направляющую, которая ещё помещается по длине
    // (первую в каталоге ≥ факта), а не точное совпадение: направляющая короче факта физически
    // не дотянется до задней стенки короба.
    function drawerSlideUnitPrice(type, length) {
      const options = (materials.drawerSlide || []).filter(d => d.type === type).sort((a, b) => a.length - b.length);
      const match = options.find(d => d.length >= length) || options[options.length - 1];
      return match ? match.price : 0;
    }

    let fillM2 = 0, meshPrice = 0, basketPrice = 0, drawerSlidePrice = 0;
    const innerDepth = depth - DOOR_DEPTH_ZONE;
    // Наполнение секции теперь свободно перетаскиваемые items (см. state.js), а не счётчики —
    // считаем штуки по типу; общие на тип параметры (высота/глубина/цвет) не изменились.
    const countOf = (sec, type) => sec.items.filter(it => it.type === type).length;

    // Кромка (ПВХ-лента по видимым торцам ЛДСП) — считаем каждый реально оклеиваемый торец,
    // с учётом того, что скрыто в стыках/у стены:
    // - крыша/дно: передний торец (ширина короба) + левый/правый торец (глубина короба) —
    //   у крыши/дна есть боковые срезы помимо переднего.
    // - боковые стойки, перегородки между секциями: только передний торец (высота стойки) —
    //   задний у стены/в примыкании, не оклеивается.
    // - планка/короб, заменяющие снятую стойку/крышу/дно: ДВА торца (наружный+внутренний) — это
    //   отдельная накладка в дверной зоне, ничем не прикрыта ни спереди, ни изнутри, в отличие
    //   от настоящей стойки, у которой задний торец упирается в стену.
    // - полки: передний торец на ширину своей секции.
    //
    // Лента теперь индивидуальна по ЦВЕТУ плиты и ТОЛЩИНЕ (сессия 39): длина копится в шесть
    // вёдер «материал × толщина» (корпус/фасад/наполнение × 16/32), цена каждого ведра — из цен
    // ленты выбранного цвета (edgePerM16/edgePerM32 у цвета в materials.json, см. pricing.js).
    // «Кромка на 32» — отдельная позиция каталога вместо прежнего множителя ×3.
    // При общем режиме 32мм корпус/наполнение — сдвоенная плита (лента «на 32»); фасады ящиков
    // остаются одинарной плитой и лентой «на 16» (их материал при 32 тоже не удваивается).
    // Точечные «детали 32мм» переводят в ведро 32 кромку только своей детали.
    const edgeMm = { korpus16: 0, korpus32: 0, fasad16: 0, fasad32: 0, fill16: 0, fill32: 0 };
    const th32 = state.thick32 || {};
    const korpusEdge = (mm, t32) => { edgeMm[(state.panel32 || t32) ? 'korpus32' : 'korpus16'] += mm; };
    const fillEdge   = (mm, t32) => { edgeMm[(state.panel32 || t32) ? 'fill32'   : 'fill16']   += mm; };
    const fasadEdge  = (mm)      => { edgeMm.fasad16 += mm; };

    if (!noCeiling)   korpusEdge(width + 2 * depth, th32.top);
    if (!noBottom)    korpusEdge(width + 2 * depth, th32.bottom);
    if (!noSideLeft)  korpusEdge(stojkaH, th32.left);
    if (!noSideRight) korpusEdge(stojkaH, th32.right);
    korpusEdge((sections.length - 1) * stojkaH, th32.dividers); // перегородки — всегда есть

    // Планка наследует точечную толщину своей стороны, короб — нет (как и в материале выше).
    function replaceEdge(noSide, replace, span, t32) {
      if (noSide && replace !== 'none') korpusEdge(2 * span, replace === 'planka' && t32);
    }
    replaceEdge(state.noSideLeft,  state.leftReplace,   H, th32.left);
    replaceEdge(state.noSideRight, state.rightReplace,  H, th32.right);
    replaceEdge(state.noCeiling,   state.topReplace,    width, th32.top);
    replaceEdge(state.noBottom,    state.bottomReplace, width, th32.bottom);

    sections.forEach((sec, s) => {
      // Без зазора — совпадает с геометрией в buildWardrobeBox.
      const sw = sec.width;
      // Без опоры по бокам (см. sectionMissingSideSupport) ящики не ставятся — только в той
      // крайней секции, где реально сняли стойку, не во всех сразу — см. buildWardrobeBox.
      // Поштучно (не агрегатом по count×sw), т.к. смещающий элемент (задание «ящики-двери 19,07»)
      // делает конкретный ящик уже секции — у каждого экземпляра теперь своя ширина короба.
      if (!sectionMissingSideSupport(sections, s)) {
        sec.items.filter(it => it.type === 'drawer').forEach(it => {
          const offW = it.offsetSide ? clampDrawerOffsetWidth(sw, it.offsetWidth) : 0;
          const drawerW = sw - offW;
          // Фасад ящика — в площадь фасадов; короб (дно+2 боковины+задняя стенка) — в наполнение/ЛДСП.
          fasadM2 += (drawerW * sec.drawerHeight) / 1e6;
          const { boxW, boxH, boxDepth } = drawerBoxSize(drawerW, sec.drawerHeight, sec.drawerDepth, depth);
          const boxM2 = boxW * boxDepth + 2 * boxH * boxDepth + boxW * boxH;
          fillM2 += boxM2 / 1e6;
          // Кромка ящика: фасад целиком по периметру; у короба — дно без кромки (скрыто в стыке),
          // боковины оклеены с трёх сторон (верх+перед+зад — не оклеен только низ, в стыке с
          // дном), задняя стенка — только верхний торец (левый/правый/нижний скрыты в стыках с
          // боковинами и дном).
          fasadEdge(2 * (drawerW + sec.drawerHeight));   // фасад ящика — лента в цвет фасада
          fillEdge(2 * (boxDepth + 2 * boxH) + boxW);    // короб ящика — лента в цвет наполнения
          // Длина направляющей — по реальной (уже клампнутой под глубину короба) физической
          // глубине ящика, не по «желаемому» sec.drawerDepth — то же значение, что режет короб.
          drawerSlidePrice += drawerSlideUnitPrice(sec.drawerSlideType, boxDepth);
          if (offW > 0) {
            // Заглушка — тот же фасадный материал/толщина, что и фасад ящика (см. addOffsetFiller
            // в wardrobe-geometry.js), без короба/направляющих — отдельная панель со своей кромкой
            // по периметру (два новых внутренних торца, которых не было бы у цельного фасада).
            fasadM2 += (offW * sec.drawerHeight) / 1e6;
            fasadEdge(2 * (offW + sec.drawerHeight));
          }
        });
      }
      // Сетчатые полки — цена за погонный метр (ширина секции), а не за м², зависит от
      // выбранной глубины и цвета (см. materials.json meshShelf).
      const meshCount = countOf(sec, 'mesh');
      if (meshCount > 0) {
        meshPrice += meshCount * (sw / 1000) * meshPricePerM(sec.meshDepth, sec.meshColor);
      }
      // Сетчатые корзины — как ящики, нужна опора по бокам и точное совпадение ширины секции с
      // обязательным проёмом (basketFits) — иначе корзина физически не встанет (см. state.js).
      const basketCount = (sectionMissingSideSupport(sections, s) || !basketFits(sec)) ? 0 : countOf(sec, 'basket');
      if (basketCount > 0) {
        basketPrice += basketCount * basketUnitPrice(sec.basketWidth, sec.basketDepth, sec.basketHeight, sec.basketColor);
      }
      // Полки (верхняя структурная — тоже обычный item типа shelf, отдельно не считается, см.
      // _wardrobe-shared.js) плюс планка жёсткости (если задняя стенка не ЛДСП, висит от
      // структурной полки).
      if (state.backWall !== 'ldsp') fillM2 += (sw * STIFFENER_HEIGHT) / 1e6; // жёсткость — вертикальная пластина, площадь ширина×высота
      sec.items.filter(it => it.type === 'shelf').forEach(it => {
        fillM2 += (sw * innerDepth) / 1e6;
        fillEdge(sw, it.thick32); // передний торец полки; у полки 32мм — лента «на 32»
        if (!state.panel32 && it.thick32) { // полка 32мм: материал ×2 (кромка — выше, вся в ведре 32)
          extraFillM2 += (sw * innerDepth) / 1e6;
        }
      });
    });

    // Посегментная задняя стенка (см. sec.backWallSegments) — альтернатива общей на весь шкаф,
    // работает только когда та выключена; всегда ЛДСП (тот же тариф, что и обычная ЛДСП-стенка).
    let backWallM2 = 0;
    let backWallType = state.backWall;
    let backWallSegmentCount = 0;
    if (state.backWall !== 'none') {
      backWallM2 = ((width - stojkaLeftOff - stojkaRightOff) * stojkaH) / 1e6;
    } else {
      sections.forEach((sec, idx) => {
        if (!sec.backWallSegments?.length) return;
        sectionBackWallSegments(sec, idx).forEach(seg => {
          if (seg.eligible && sec.backWallSegments.includes(seg.key)) {
            backWallM2 += (sec.width * (seg.hiY - seg.loY)) / 1e6;
            backWallSegmentCount++;
          }
        });
      });
      if (backWallM2 > 0) backWallType = 'ldsp';
    }

    // ---------- крепёж и встройка (скрытые позиции, нигде не отображаются — только в
    // стоимость; в будущей спецификации выйдут отдельными строками) ----------
    // Крепёж 100₽ — к КАЖДОЙ детали ЛДСП. Встройка 300₽ — к деталям без двух сторон
    // крепления: полки/крыша/дно, у которых сбоку нет стойки (встроенные в проём).
    let fastenerCount = 0, embedCount = 0;
    const sideMissing = noSideLeft || noSideRight;
    if (!noBottom)  { fastenerCount++; if (sideMissing) embedCount++; } // дно
    if (!noCeiling) { fastenerCount++; if (sideMissing) embedCount++; } // крыша
    if (!noSideLeft)  fastenerCount++;                                  // стойки
    if (!noSideRight) fastenerCount++;
    fastenerCount += sections.length - 1;                               // перегородки
    if (plinthH > 0) fastenerCount++;                                   // цоколь
    // планки/короба вместо снятых панелей и выравниватели — тоже детали ЛДСП
    [[noSideLeft, state.leftReplace], [noSideRight, state.rightReplace],
     [noCeiling, state.topReplace],   [noBottom, state.bottomReplace]].forEach(([no, rep]) => {
      if (no && rep !== 'none') fastenerCount++;
    });
    if (state.alignerLeft)  fastenerCount++;
    if (state.alignerRight) fastenerCount++;
    if (state.alignerTop)   fastenerCount++;
    if (backWallType === 'ldsp' && state.backWall === 'ldsp') fastenerCount++; // общая стенка
    fastenerCount += backWallSegmentCount;                              // посегментные стенки
    sections.forEach((sec, s) => {
      if (state.backWall !== 'ldsp') fastenerCount++;                   // планка жёсткости
      const shelfCount = countOf(sec, 'shelf');
      fastenerCount += shelfCount;                                      // полки
      // полка в крайней секции без боковой стойки — встроенная
      if (sectionMissingSideSupport(sections, s)) embedCount += shelfCount;
      // ящики (если стоят) — сборная тумба, крепёж как одна деталь
      if (!sectionMissingSideSupport(sections, s)) fastenerCount += countOf(sec, 'drawer');
    });
    const mountPrice = fastenerCount * 100 + embedCount * 300;

    return {
      korpusM2: korpusM2 + leftBoxM2 + rightBoxM2 + topBoxM2 + bottomBoxM2 + alignerM2 + extraKorpusM2,
      fasadM2, doorFillPrice, doorHardwarePrice,
      fillM2: fillM2 + extraFillM2, backWallM2, backWallType, meshPrice, basketPrice, drawerSlidePrice,
      edgeMm,
      mountPrice, fastenerCount, embedCount, // для будущей спецификации
    };
  },

  describe() {
    const { sections } = state;
    const countOf = (sec, type) => sec.items.filter(it => it.type === type).length;
    // Верхняя (структурная) полка — теперь тоже обычный item типа shelf, отдельно не считается.
    const totalShelves = sections.reduce((s, sec) => s + countOf(sec, 'shelf'), 0);
    const totalBaskets = sections.reduce((sum, sec, i) => sum + ((sectionMissingSideSupport(sections, i) || !basketFits(sec)) ? 0 : countOf(sec, 'basket')), 0);
    // Без опоры по бокам ящики не ставятся — только в крайней секции без стойки, см. buildWardrobeBox.
    const totalDrawers = sections.reduce((sum, sec, i) => sum + (sectionMissingSideSupport(sections, i) ? 0 : countOf(sec, 'drawer')), 0);
    const totalRod = sections.reduce((s, sec) => s + countOf(sec, 'rod'), 0);
    const totalMesh = sections.reduce((s, sec) => s + countOf(sec, 'mesh'), 0);
    const totalValet = sections.reduce((s, sec) => s + (sec.valet ? 1 : 0), 0);
    // Нулевые количества не пишем вовсе (правило 21.07): «корзин: 0» — шум, пусто = нет.
    const parts = [
      ['секций', sections.length],
      ['полок', totalShelves],
      ['ящиков', totalDrawers],
      ['штанг', totalRod],
      ['сетчатых полок', totalMesh],
      ['торцевых вешал', totalValet],
      ['корзин', totalBaskets],
    ].filter(([, n]) => n > 0);
    return parts.length ? ', ' + parts.map(([l, n]) => `${l}: ${n}`).join(', ') : '';
  },
};
