export const PANEL_THICKNESS = 18;

export let materials = { korpus: { producers: [] }, fasad: { producers: [] }, fill: { producers: [] }, fittings: [], presets: [] };
export function setMaterials(m) { materials = m; }

export const state = {
  type: 'wardrobe',
  width: 1800, height: 2400, depth: 600,
  sections: 2, shelves: 3, drawers: 0, rod: true,
  korpusProducer: null, korpusId: null,
  fasadProducer:  null, fasadId:  null,
  fillProducer:   null, fillId:   null,
  fasadDoorType: 'sliding',  // sliding | swing | none
  profile: 'standard',       // standard | slim | anod | black
  doorFill: 'ldsp',          // ldsp | mirror | glass
  doorFill2: null,           // null | ldsp | mirror | glass (комбо)
  glassType: 'clear',
};
