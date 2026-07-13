// Константы, нужные больше чем одному из соседних модулей (wardrobe-sizing/wardrobe-items/
// wardrobe-geometry) — вынесены сюда отдельно, чтобы эти три модуля не завязывались друг на
// друга по кругу (geometry уже импортирует sizing и items, а не наоборот). Константы, нужные
// только одному модулю, остаются локальными (часто приватными) в нём же — см. соответствующий
// файл, а не этот.
export const DOOR_DEPTH_ZONE = 90; // дверная зона (см. wardrobe-geometry.js/wardrobe-sizing.js)
export const TOP_SHELF_GAP = 550;  // от верхней границы наполнения до верхней (pinned) полки
export const MESH_DEPTHS = [300, 400, 500];
export const VALET_LENGTHS = [250, 300, 350, 400, 450, 500, 550];
export const BASKET_WIDTHS = [300, 400, 500];
export const BASKET_DEPTHS_BY_WIDTH = { 300: [400], 400: [400, 450, 500, 550, 600], 500: [500, 550, 600] };
