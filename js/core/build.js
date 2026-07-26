import { state, syncPanelThickness } from './state.js';
import { furnitureGroup, focusCameraOnFurniture } from './scene.js';
import { TYPES } from '../types/registry.js';
import { updatePrice } from './pricing.js';
import { renderStaticDimensions } from './dimensions.js';
import { buildRoom } from './room.js';

export function buildFurniture() {
  syncPanelThickness(); // толщина ЛДСП из state.panel32 (важно и при загрузке снапшотов)
  furnitureGroup.clear();
  const type = TYPES[state.type] || TYPES['wardrobe'];
  const counts = type.build();
  focusCameraOnFurniture();
  updatePrice(counts);
  renderStaticDimensions();
  buildRoom(); // комната зависит от габаритов/типа шкафа — пересобираем вместе с ним
  // UI, зависящий от геометрии (например, варианты количества дверей на «Фасаде»), слушает
  // это событие вместо прямого импорта из tabs.js — иначе цикл build.js <-> tabs.js.
  window.dispatchEvent(new CustomEvent('furniture-rebuilt'));
}
