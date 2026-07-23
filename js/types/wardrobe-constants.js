// Константы, нужные больше чем одному из соседних модулей (wardrobe-sizing/wardrobe-items/
// wardrobe-geometry) — вынесены сюда отдельно, чтобы эти три модуля не завязывались друг на
// друга по кругу (geometry уже импортирует sizing и items, а не наоборот). Константы, нужные
// только одному модулю, остаются локальными (часто приватными) в нём же — см. соответствующий
// файл, а не этот.
import { materials } from '../core/state.js';

export const DOOR_DEPTH_ZONE = 90; // дверная зона (см. wardrobe-geometry.js/wardrobe-sizing.js)
export const TOP_SHELF_GAP = 550;  // от верхней границы наполнения до верхней (pinned) полки

// ── Размерные сетки ассортимента — из каталога (data/materials.json), не из кода (разделение
// «как строим»/«из чего строим», 21.07): сетки сеток/корзин выводятся из самих позиций каталога
// (какие размеры есть в прайсе — те и доступны), длины вешал — отдельный список в каталоге.
// Функции, не константы: каталог загружается асинхронно после импорта модулей. Фолбэки — на
// случай пустого каталога (не должно случаться, но геометрия не должна падать). ──
export function meshDepths() {
  const ds = [...new Set((materials.meshShelf || []).map(m => m.depth))].sort((a, b) => a - b);
  return ds.length ? ds : [300, 400, 500];
}
export function valetLengths() {
  const ls = materials.valetLengths || [];
  return ls.length ? ls : [250, 300, 350, 400, 450, 500, 550];
}
export function basketWidths() {
  const ws = [...new Set((materials.basket || []).map(b => b.width))].sort((a, b) => a - b);
  return ws.length ? ws : [300, 400, 500, 600];
}
export function basketDepthsFor(width) {
  return [...new Set((materials.basket || []).filter(b => b.width === width).map(b => b.depth))].sort((a, b) => a - b);
}

// Двери купе: соседние двери заходят друг на друга внахлёст (щели нет), крайние не вылезают
// за стойки. Ширина одной двери ограничена конструктивом системы — из этого допуска считаются
// доступные варианты количества дверей (см. doorCountOptions в wardrobe-sizing.js).
export const DOOR_OVERLAP = 30;
export const DOOR_MIN_W = 500;
export const DOOR_MAX_W = 1100;

// Смещающий элемент ящика (задание «ящики-двери 19,07», второй раунд) — заглушка той же высоты,
// что и фасад ящика, ставится слева либо справа; сам ящик становится уже секции на её ширину и
// сдвигается к противоположному краю. MIN_OFFSET_WIDTH — минимальная ширина самой заглушки (нет
// смысла в декоративной планке уже этого), MIN_DRAWER_REMAINING_WIDTH — минимальная ширина, до
// которой можно сузить сам ящик (короб+направляющие всё ещё должны на что-то влезть).
export const MIN_DRAWER_OFFSET_WIDTH = 30;
export const MIN_DRAWER_REMAINING_WIDTH = 150;
export const DEFAULT_DRAWER_OFFSET_WIDTH = 100;
