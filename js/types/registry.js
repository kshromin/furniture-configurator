import wardrobe from './wardrobe.js';
import wardrobeSwing from './wardrobe-swing.js';
import wardrobeOpen from './wardrobe-open.js';
import chest from './chest.js';
import table from './table.js';
import parts from './parts.js';
import slidingDoors from './sliding-doors.js';
import wardrobeRoom from './wardrobe-room.js';

export const TYPE_LIST = [
  wardrobe, wardrobeSwing, wardrobeOpen, chest, table, parts, slidingDoors, wardrobeRoom,
];

export const TYPES = Object.fromEntries(TYPE_LIST.map(t => [t.id, t]));
