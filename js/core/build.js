import { state } from './state.js';
import { furnitureGroup, focusCameraOnFurniture } from './scene.js';
import { TYPES } from '../types/registry.js';
import { updatePrice } from './pricing.js';
import { renderStaticDimensions } from './dimensions.js';

export function buildFurniture() {
  furnitureGroup.clear();
  const type = TYPES[state.type] || TYPES['wardrobe'];
  const counts = type.build();
  focusCameraOnFurniture();
  updatePrice(counts);
  renderStaticDimensions();
}
