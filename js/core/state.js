export const PANEL_THICKNESS = 16;

export let materials = { korpus: { producers: [] }, fasad: { producers: [] }, fill: { producers: [] }, fittings: [], presets: [] };
export function setMaterials(m) { materials = m; }

export const state = {
  type: 'wardrobe',
  width: 1800, height: 2400, depth: 600,
  sections: 2, shelves: 3, drawers: 0, rod: true,
  korpusProducer: null, korpusId: null,
  fasadProducer:  null, fasadId:  null,
  fillProducer:   null, fillId:   null,
  showDoors: true,
  backWall: 'none',           // none | ldsp | hdf
  plinthEnabled: true,
  plinthHeight: 50,
  noSideLeft: false,  leftReplace: 'none',  leftBoxW: 66,
  noSideRight: false, rightReplace: 'none', rightBoxW: 66,
  noCeiling: false,   topReplace: 'none',   topBoxH: 66,
  noBottom: false,
  alignerTop: false,
  fasadDoorType: 'sliding',  // sliding | swing | none
  profile: 'standard',       // standard | slim | anod | black
  doorFill: 'ldsp',          // ldsp | mirror | glass
  doorFill2: null,           // null | ldsp | mirror | glass (комбо)
  glassType: 'clear',
};
