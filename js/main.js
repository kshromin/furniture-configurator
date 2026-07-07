import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PANEL_THICKNESS = 18;

let materials = { korpus: { producers: [] }, fasad: { producers: [] }, fill: { producers: [] }, fittings: [], presets: [] };
let orderItems = []; // накопленные позиции заказа

let state = {
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

// ---------- scene ----------
const viewport = document.getElementById('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8e8e8);

const camera = new THREE.PerspectiveCamera(45, viewport.clientWidth / viewport.clientHeight, 10, 20000);
camera.position.set(3800, 2200, 4800);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1000, 0);
controls.enableDamping = true;
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
dir1.position.set(1500, 2500, 2000);
scene.add(dir1);
const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
dir2.position.set(-1500, 1000, -1000);
scene.add(dir2);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(6000, 6000),
  new THREE.MeshStandardMaterial({ color: 0xd8d8d8 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

window.addEventListener('resize', () => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
animate();

// ---------- furniture ----------
const furnitureGroup = new THREE.Group();
scene.add(furnitureGroup);

function panelMesh(w, h, d, color, opacity) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const p = { color, roughness: 0.6, metalness: 0.05 };
  if (opacity !== undefined && opacity < 1) { p.transparent = true; p.opacity = opacity; }
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial(p));
}

function addPanel(w, h, d, color, pos, opacity) {
  const mesh = panelMesh(w, h, d, color, opacity);
  mesh.position.set(pos[0], pos[1], pos[2]);
  const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, 15);
  const edgesMat = new THREE.LineBasicMaterial({
    color: 0x222222,
    transparent: opacity !== undefined && opacity < 1,
    opacity: opacity !== undefined && opacity < 1 ? opacity * 0.7 : 1,
  });
  mesh.add(new THREE.LineSegments(edgesGeo, edgesMat));
  furnitureGroup.add(mesh);
  return mesh;
}

function getDoorCount(width) { return Math.max(2, Math.min(4, Math.round(width / 900))); }

function buildFurniture() {
  furnitureGroup.clear();
  let counts;
  if (state.type === 'chest') counts = buildChest();
  else if (state.type === 'table') counts = buildTable();
  else if (state.type === 'parts') counts = buildParts();
  else if (state.type === 'sliding-doors') counts = buildSlidingDoors();
  else if (state.type === 'wardrobe-room') counts = buildWardrobeRoom();
  else counts = buildWardrobe();
  controls.target.set(0, state.height / 2, 0);
  updatePrice(counts);
}

function buildWardrobe() {
  const { width, height, depth, shelves, drawers, rod, sections } = state;
  const t = PANEL_THICKNESS;
  const kColor = getColor('korpus').color;
  const fColor = getColor('fasad').color;
  const nColor = getColor('fill').color;

  addPanel(width, t, depth, kColor, [0, t / 2, 0]);
  addPanel(width, t, depth, kColor, [0, height - t / 2, 0]);
  addPanel(t, height - 2 * t, depth, kColor, [-width / 2 + t / 2, height / 2, 0]);
  addPanel(t, height - 2 * t, depth, kColor, [width / 2 - t / 2, height / 2, 0]);
  addPanel(width - 2 * t, height - 2 * t, 4, kColor, [0, height / 2, -depth / 2 + 2]);

  const innerWidth = width - 2 * t;
  const sectionWidth = (innerWidth - (sections - 1) * t) / sections;
  for (let i = 1; i < sections; i++) {
    addPanel(t, height - 2 * t, depth - 20, kColor, [
      -width / 2 + t + i * (sectionWidth + t) - t / 2,
      height / 2, 0,
    ]);
  }

  const doorCount = getDoorCount(width);
  const gap = 4;
  const doorW = (width - gap * (doorCount + 1)) / doorCount;
  for (let i = 0; i < doorCount; i++) {
    const x = -width / 2 + gap + doorW / 2 + i * (doorW + gap);
    addPanel(doorW, height - 2 * gap, t, fColor, [x, height / 2, depth / 2 - t / 2], 0.85);
  }

  const innerDepth = depth - 60;
  const fillBottom = t + 10, fillTop = height - t - 10;

  for (let s = 0; s < sections; s++) {
    const cx = -width / 2 + t + s * (sectionWidth + t) + sectionWidth / 2;
    const sw = sectionWidth - 10;
    let drawerTop = fillBottom;

    if (drawers > 0) {
      const blkH = Math.min(700, (fillTop - fillBottom) * 0.4);
      const dh = (blkH - (drawers - 1) * 4) / drawers;
      for (let i = 0; i < drawers; i++) {
        const y = fillBottom + i * (dh + 4) + dh / 2;
        addPanel(sw, dh, t, fColor, [cx, y, depth / 2 - t - 20], 0.9);
      }
      drawerTop = fillBottom + blkH + 20;
    }

    if (shelves > 0) {
      const usable = fillTop - drawerTop - (rod ? 250 : 0);
      for (let i = 0; i < shelves; i++) {
        const y = drawerTop + (usable * (i + 1)) / (shelves + 1);
        addPanel(sw, t, innerDepth, nColor, [cx, y, 0]);
      }
    }

    if (rod) {
      const rodGeo = new THREE.CylinderGeometry(8, 8, sw, 12);
      const rodMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.3 });
      const rodMesh = new THREE.Mesh(rodGeo, rodMat);
      rodMesh.rotation.z = Math.PI / 2;
      rodMesh.position.set(cx, fillTop - 60, depth / 2 - 100);
      furnitureGroup.add(rodMesh);
    }
  }

  return { door: doorCount, drawer: drawers * sections, shelf: shelves * sections, rod: rod ? sections : 0, item: 1 };
}

function buildSlidingDoors() {
  const { width, height } = state;
  const t = PANEL_THICKNESS;
  const fColor = getColor('fasad').color;
  const doorCount = getDoorCount(width);
  const gap = 4;
  const doorW = (width - gap * (doorCount + 1)) / doorCount;

  // верхняя и нижняя направляющие
  const kColor = getColor('korpus').color;
  addPanel(width, t, 40, kColor, [0, height - t / 2, 0]);
  addPanel(width, t, 40, kColor, [0, t / 2, 0]);

  // полотна дверей (два слоя для имитации купе)
  for (let i = 0; i < doorCount; i++) {
    const x = -width / 2 + gap + doorW / 2 + i * (doorW + gap);
    const zOffset = i % 2 === 0 ? 0 : t + 6;
    addPanel(doorW, height - 2 * gap, t, fColor, [x, height / 2, zOffset]);
  }

  return { door: doorCount, drawer: 0, shelf: 0, rod: 0, item: 1 };
}

function buildWardrobeRoom() {
  // Гардероб — пока заглушка: три стены-секции буквой П
  const { width, height, depth } = state;
  const t = PANEL_THICKNESS;
  const kColor = getColor('korpus').color;
  const sideDepth = Math.round(width * 0.4);

  // задняя стенка
  addPanel(width, height, t, kColor, [0, height / 2, -depth / 2]);
  // левая боковая
  addPanel(t, height, sideDepth, kColor, [-width / 2 + t / 2, height / 2, sideDepth / 2 - depth / 2]);
  // правая боковая
  addPanel(t, height, sideDepth, kColor, [width / 2 - t / 2, height / 2, sideDepth / 2 - depth / 2]);
  // верхняя крышка
  addPanel(width, t, sideDepth, kColor, [0, height - t / 2, sideDepth / 2 - depth / 2]);

  return { door: 0, drawer: 0, shelf: 0, rod: 0, item: 1 };
}

function buildTable() {
  const { width, height, depth } = state;
  const t = PANEL_THICKNESS;
  const kColor = getColor('korpus').color;
  const legH = height - t;
  const legD = 40;
  // столешница
  addPanel(width, t, depth, kColor, [0, height - t / 2, 0]);
  // 4 ножки
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
    addPanel(legD, legH, legD, kColor, [
      sx * (width / 2 - legD / 2 - 20),
      legH / 2,
      sz * (depth / 2 - legD / 2 - 20),
    ]);
  });
  return { door: 0, drawer: 0, shelf: 0, rod: 0, item: 1 };
}

function buildParts() {
  const { width, height, depth } = state;
  const kColor = getColor('korpus').color;
  // просто деталь — один прямоугольный щит
  addPanel(width, height, depth, kColor, [0, height / 2, 0]);
  return { door: 0, drawer: 0, shelf: 0, rod: 0, item: 1 };
}

function buildChest() {
  const { width, height, depth, drawers } = state;
  const t = PANEL_THICKNESS;
  const kColor = getColor('korpus').color;
  const fColor = getColor('fasad').color;
  const dc = Math.max(1, drawers);

  addPanel(width, t, depth, kColor, [0, t / 2, 0]);
  addPanel(width, t, depth, kColor, [0, height - t / 2, 0]);
  addPanel(t, height - 2 * t, depth, kColor, [-width / 2 + t / 2, height / 2, 0]);
  addPanel(t, height - 2 * t, depth, kColor, [width / 2 - t / 2, height / 2, 0]);
  addPanel(width - 2 * t, height - 2 * t, 4, kColor, [0, height / 2, -depth / 2 + 2]);

  const gap = 4, iH = height - 2 * t, dh = (iH - gap * (dc + 1)) / dc;
  const iW = width - 2 * t - 10;
  for (let i = 0; i < dc; i++) {
    const y = t + gap + i * (dh + gap) + dh / 2;
    addPanel(iW, dh, t, fColor, [0, y, depth / 2 - t / 2]);
  }

  return { door: 0, drawer: dc, shelf: 0, rod: 0, item: 1 };
}

// ---------- materials helpers ----------
function getProducers(group) { return materials[group]?.producers || []; }

function getColors(group, producerId) {
  const p = getProducers(group).find(p => p.id === producerId);
  return p ? p.colors : [];
}

function getColor(group) {
  const id = state[group + 'Id'];
  const pid = state[group + 'Producer'];
  const colors = getColors(group, pid);
  return colors.find(c => c.id === id) || colors[0] || { color: '#cccccc', pricePerM2: 0 };
}

// ---------- UI: material selects & swatches ----------
function renderProducerSelect(group, selectId, swatchesId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '';
  getProducers(group).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  sel.value = state[group + 'Producer'];
  sel.addEventListener('change', () => {
    state[group + 'Producer'] = sel.value;
    const colors = getColors(group, sel.value);
    state[group + 'Id'] = colors[0]?.id || null;
    renderSwatches(group, swatchesId);
    buildFurniture();
  });
  renderSwatches(group, swatchesId);
}

// name element ids per group
const SWATCH_NAME_IDS = { korpus: 'korpusColorName', fasad: 'fasadColorName', fill: 'fillColorName' };

function renderSwatches(group, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const colors = getColors(group, state[group + 'Producer']);
  colors.forEach(c => {
    const el = document.createElement('div');
    el.className = 'swatch' + (c.id === state[group + 'Id'] ? ' selected' : '');
    el.style.background = c.color;
    el.title = c.name + ' — ' + c.pricePerM2 + ' ₽/м²';
    el.addEventListener('click', () => {
      state[group + 'Id'] = c.id;
      renderSwatches(group, containerId);
      buildFurniture();
    });
    container.appendChild(el);
  });
  // show selected color name
  const nameEl = document.getElementById(SWATCH_NAME_IDS[group]);
  if (nameEl) {
    const sel = colors.find(c => c.id === state[group + 'Id']);
    nameEl.textContent = sel ? sel.name + (sel.pricePerM2 ? '  ·  ' + sel.pricePerM2 + ' ₽/м²' : '') : '';
  }
}

// ---------- UI: presets ----------
function renderPresets() {
  const container = document.getElementById('presets');
  if (!container) return;
  container.innerHTML = '';
  (materials.presets || []).forEach(p => {
    const card = document.createElement('div');
    card.className = 'preset-card';

    const typeNames = {
      'wardrobe': 'Шкаф-купе', 'wardrobe-swing': 'Шкаф распашной',
      'wardrobe-open': 'Шкаф открытый', 'chest': 'Комод',
      'table': 'Стол', 'parts': 'Детали',
      'sliding-doors': 'Двери купе', 'wardrobe-room': 'Гардероб',
    };

    card.innerHTML = `
      <div class="preset-card-name">${p.name}</div>
      <div class="preset-card-desc">${typeNames[p.type] || p.type} · ${p.width}×${p.height}×${p.depth} мм</div>
    `;
    card.addEventListener('click', () => {
      applyPreset(p);
      document.querySelector('[data-tab="type"]').click();
    });
    container.appendChild(card);
  });
}

function applyPreset(p) {
  state.type           = p.type || 'wardrobe';
  state.width          = p.width;
  state.height         = p.height;
  state.depth          = p.depth;
  state.sections       = p.sections || 2;
  state.shelves        = p.shelves  || 0;
  state.drawers        = p.drawers  || 0;
  state.rod            = !!p.rod;
  state.korpusProducer = p.korpusProducer;
  state.korpusId       = p.korpusId;
  state.fasadProducer  = p.fasadProducer;
  state.fasadId        = p.fasadId;
  state.fillProducer   = p.fillProducer;
  state.fillId         = p.fillId;
  syncUIFromState();
  buildFurniture();
}

function syncUIFromState() {
  setSlider('width',    state.width,    ' мм');
  setSlider('height',   state.height,   ' мм');
  setSlider('depth',    state.depth,    ' мм');
  setSlider('sections', state.sections, '');
  setSlider('shelves',  state.shelves,  '');
  setSlider('drawers',  state.drawers,  '');
  document.getElementById('rod').checked = state.rod;

  document.querySelectorAll('.type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === state.type);
  });

  ['korpus', 'fasad', 'fill'].forEach(g => {
    const sel = document.getElementById(g + 'Producer');
    if (sel) {
      sel.value = state[g + 'Producer'];
      renderSwatches(g, g + 'Swatches');
    }
  });
}

function setSlider(id, value, suffix) {
  const input = document.getElementById(id);
  if (!input) return;
  input.value = value;
  const label = document.getElementById(id + 'Val');
  if (label) label.textContent = value + (suffix || '');
}

// ---------- pricing ----------
function updatePrice(counts) {
  const { width, height, depth, type, sections } = state;
  const t = PANEL_THICKNESS;

  const dividers = type === 'wardrobe' ? (sections - 1) : 0;
  const korpusAreaMm2 =
    width * t * 2 +
    t * (height - 2 * t) * 2 +
    (width - 2 * t) * (height - 2 * t) +
    dividers * t * (height - 2 * t);
  const korpusM2 = korpusAreaMm2 / 1e6;
  const kMat = getColor('korpus');
  const korpusPrice = korpusM2 * kMat.pricePerM2;

  let fasadM2 = 0, fillM2 = 0;
  const fMat = getColor('fasad');
  const nMat = getColor('fill');

  if (type === 'wardrobe') {
    const dc = getDoorCount(width);
    const gap = 4;
    const dw = (width - gap * (dc + 1)) / dc;
    fasadM2 = (dc * dw * (height - 2 * gap)) / 1e6;

    const innerWidth = width - 2 * t;
    const sw = (innerWidth - (sections - 1) * t) / sections - 10;
    if (state.drawers > 0) {
      const blkH = Math.min(700, (height - 2 * t - 20) * 0.4);
      fillM2 += (sections * sw * blkH) / 1e6;
    }
    if (state.shelves > 0) {
      const innerDepth = depth - 60;
      fillM2 += (sections * state.shelves * sw * innerDepth) / 1e6;
    }
  } else {
    const dc = Math.max(1, state.drawers);
    const iW = width - 2 * t - 10;
    fasadM2 = (iW * (height - 2 * t)) / 1e6;
    void dc;
  }

  const fasadPrice = fasadM2 * fMat.pricePerM2;
  const fillPrice  = fillM2  * nMat.pricePerM2;

  const fittingsPrice = (materials.fittings || []).reduce((sum, f) => {
    const n = f.per === 'front' ? counts.door + counts.drawer : (counts[f.per] || 0);
    return sum + f.price * n;
  }, 0);

  const total = korpusPrice + fasadPrice + fillPrice + fittingsPrice;

  document.getElementById('priceKorpus').textContent   = fmt(korpusPrice);
  document.getElementById('priceFasad').textContent    = fmt(fasadPrice);
  document.getElementById('priceFill').textContent     = fmt(fillPrice);
  document.getElementById('priceFittings').textContent = fmt(fittingsPrice);
  document.getElementById('priceTotal').textContent    = fmt(total);

  state.lastTotal = total;
}

function fmt(v) { return Math.round(v).toLocaleString('ru-RU') + ' ₽'; }

// ---------- controls ----------
// ---------- type bar ----------
const TYPE_NAMES_MAP = {
  'wardrobe':       'Шкаф-купе',
  'wardrobe-swing': 'Шкаф распашной',
  'wardrobe-open':  'Шкаф открытый',
  'chest':          'Комод',
  'table':          'Стол',
  'parts':          'Детали',
  'sliding-doors':  'Двери купе',
  'wardrobe-room':  'Гардероб',
};

function updateTypeBar() {
  const name = TYPE_NAMES_MAP[state.type] || state.type;
  document.getElementById('typeBarName').textContent =
    `${name}  ·  ${state.width} × ${state.height} мм`;
}

// ---------- fill tab context ----------
const FILL_CTX = {
  'wardrobe':       { sections: true,  shelves: true,  drawers: true,  rod: true,  color: true  },
  'wardrobe-swing': { sections: true,  shelves: true,  drawers: true,  rod: true,  color: true  },
  'wardrobe-open':  { sections: true,  shelves: true,  drawers: false, rod: true,  color: true  },
  'wardrobe-room':  { sections: true,  shelves: true,  drawers: false, rod: true,  color: true  },
  'chest':          { sections: false, shelves: false, drawers: true,  rod: false, color: false },
  'table':          { sections: false, shelves: false, drawers: false, rod: false, color: false },
  'parts':          { sections: false, shelves: false, drawers: false, rod: false, color: false },
  'sliding-doors':  { sections: false, shelves: false, drawers: false, rod: false, color: false },
};

function updateFillContext() {
  const ctx = FILL_CTX[state.type] || FILL_CTX['wardrobe'];
  document.querySelectorAll('[data-fill-ctx]').forEach(el => {
    el.style.display = ctx[el.dataset.fillCtx] ? '' : 'none';
  });
  const colorGroup = document.getElementById('fillColorGroup');
  const emptyNote  = document.getElementById('fillEmptyNote');
  const hasAny = Object.values(ctx).some(Boolean);
  if (colorGroup) colorGroup.style.display = ctx.color ? '' : 'none';
  if (emptyNote)  emptyNote.style.display  = hasAny ? 'none' : 'block';
}

function bindSlider(id, key, suffix) {
  const input = document.getElementById(id);
  const label = document.getElementById(id + 'Val');
  if (!input) return;
  input.addEventListener('input', () => {
    state[key] = Number(input.value);
    if (label) label.textContent = input.value + (suffix || '');
    if (key === 'width' || key === 'height') updateTypeBar();
    buildFurniture();
  });
}

function bindFasadTab() {
  // тип дверей
  document.querySelectorAll('.fasad-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fasad-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.fasadDoorType = btn.dataset.fasad;
      document.getElementById('fasadSlidingBlock').style.display = state.fasadDoorType === 'sliding' ? 'block' : 'none';
      document.getElementById('fasadSwingBlock').style.display   = state.fasadDoorType === 'swing'   ? 'block' : 'none';
      buildFurniture();
    });
  });

  // профиль
  document.querySelectorAll('.profile-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.profile-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.profile = btn.dataset.profile;
    });
  });

  // наполнение двери
  function showDoorFill(fill) {
    ['ldsp', 'mirror', 'glass'].forEach(f => {
      const el = document.getElementById('fill' + f.charAt(0).toUpperCase() + f.slice(1));
      if (el) el.style.display = f === fill ? 'block' : 'none';
    });
  }

  document.querySelectorAll('.door-fill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.door-fill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.doorFill = btn.dataset.fill;
      showDoorFill(state.doorFill);
      buildFurniture();
    });
  });

  document.querySelectorAll('.door-fill-btn2').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.door-fill-btn2').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.doorFill2 = btn.dataset.fill2;
    });
  });

  // комбо
  const comboCb = document.getElementById('doorCombo');
  comboCb.addEventListener('change', () => {
    document.getElementById('doorComboBlock').style.display = comboCb.checked ? 'block' : 'none';
    state.doorFill2 = comboCb.checked ? 'mirror' : null;
  });

  // тип стекла
  document.getElementById('glassType').addEventListener('change', e => { state.glassType = e.target.value; });

  // производитель/цвет фасада (купе — ЛДСП)
  renderProducerSelect('fasad', 'fasadProducer', 'fasadSwatches');
}

function bindVariantControls() {
  const antresolCb = document.getElementById('antresolEnabled');
  const antresolFld = document.getElementById('antresolHeightField');
  antresolCb.addEventListener('change', () => {
    antresolFld.style.display = antresolCb.checked ? 'block' : 'none';
  });
  document.getElementById('antresolHeight').addEventListener('input', e => {
    document.getElementById('antresolHeightVal').textContent = e.target.value + ' мм';
  });

  const plinthCb = document.getElementById('plinthEnabled');
  const plinthFld = document.getElementById('plinthHeightField');
  plinthCb.addEventListener('change', () => {
    plinthFld.style.display = plinthCb.checked ? 'block' : 'none';
  });
  document.getElementById('plinthHeight').addEventListener('input', e => {
    document.getElementById('plinthHeightVal').textContent = e.target.value + ' мм';
  });
}

// ---------- order form ----------
function bindOrderForm() {
  const overlay = document.getElementById('orderOverlay');
  document.getElementById('orderBtn').addEventListener('click', () => {
    document.getElementById('orderSummary').textContent = describeConfig();
    document.getElementById('orderResult').textContent = '';
    document.getElementById('orderName').value = '';
    document.getElementById('orderPhone').value = '';
    overlay.classList.add('visible');
  });
  document.getElementById('orderCancel').addEventListener('click', () => overlay.classList.remove('visible'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('visible'); });
  document.getElementById('orderSubmit').addEventListener('click', () => {
    const name  = document.getElementById('orderName').value.trim();
    const phone = document.getElementById('orderPhone').value.trim();
    const result = document.getElementById('orderResult');
    if (!name)  { result.style.color = 'red'; result.textContent = 'Укажите имя';     return; }
    if (!phone) { result.style.color = 'red'; result.textContent = 'Укажите телефон'; return; }
    const orders = JSON.parse(localStorage.getItem('orders') || '[]');
    orders.push({ id: Date.now(), name, phone, summary: describeConfig(), total: state.lastTotal, createdAt: new Date().toISOString() });
    localStorage.setItem('orders', JSON.stringify(orders));
    result.style.color = 'green';
    result.textContent = 'Заявка сохранена. Мы свяжемся с вами!';
    setTimeout(() => overlay.classList.remove('visible'), 1500);
  });
}

function describeConfig() {
  const typeNames = { wardrobe: 'Шкаф-купе', 'wardrobe-swing': 'Шкаф распашной', 'wardrobe-open': 'Шкаф открытый', chest: 'Комод' };
  const kName = getColor('korpus').name || '';
  const fName = getColor('fasad').name  || '';
  let s = `${typeNames[state.type] || state.type}, ${state.width}×${state.height}×${state.depth} мм`;
  s += `, корпус: ${kName}, фасад: ${fName}`;
  if (state.type === 'wardrobe') s += `, секций: ${state.sections}, полок: ${state.shelves}, ящиков: ${state.drawers}, штанга: ${state.rod ? 'да' : 'нет'}`;
  else s += `, ящиков: ${Math.max(1, state.drawers)}`;
  s += `. Итого: ${fmt(state.lastTotal || 0)}`;
  return s;
}

// ---------- multi-item order ----------
let editingItemId = null; // id редактируемой позиции

function addCurrentToOrder() {
  const snap = JSON.parse(JSON.stringify(state));
  if (editingItemId !== null) {
    // обновляем существующую позицию
    const idx = orderItems.findIndex(it => it.id === editingItemId);
    if (idx !== -1) {
      orderItems[idx].label   = describeConfig();
      orderItems[idx].total   = state.lastTotal || 0;
      orderItems[idx].snapshot = snap;
    }
    editingItemId = null;
    document.getElementById('addItemBtn').textContent = '+ Добавить в заказ';
  } else {
    orderItems.push({ id: Date.now(), label: describeConfig(), total: state.lastTotal || 0, snapshot: snap });
  }
  renderOrderCards();
}

function loadItemForEdit(id) {
  const item = orderItems.find(it => it.id === id);
  if (!item) return;
  editingItemId = id;
  Object.assign(state, JSON.parse(JSON.stringify(item.snapshot)));
  syncUIFromState();
  ['korpus', 'fasad', 'fill'].forEach(g => {
    document.getElementById(g + 'Producer').value = state[g + 'Producer'];
    renderSwatches(g, g + 'Swatches');
  });
  buildFurniture();
  document.getElementById('addItemBtn').textContent = '✓ Обновить позицию';
  // переключаемся на вкладку Тип
  document.querySelector('[data-tab="type"]').click();
  renderOrderCards();
}

function renderOrderCards() {
  const list    = document.getElementById('orderCardsList');
  const empty   = document.getElementById('orderEmptyNote');
  const grandRow = document.getElementById('orderGrandRow');
  const grandEl  = document.getElementById('orderGrandTotal');
  const badge    = document.getElementById('orderBadge');
  const counter  = document.getElementById('orderCounterRow');
  const counterTxt = document.getElementById('orderCounterText');

  list.innerHTML = '';

  if (orderItems.length === 0) {
    empty.style.display   = 'block';
    grandRow.style.display = 'none';
    badge.style.display    = 'none';
    counter.style.display  = 'none';
    return;
  }

  empty.style.display    = 'none';
  grandRow.style.display = 'flex';
  badge.style.display    = 'block';
  counter.style.display  = 'flex';
  badge.textContent      = orderItems.length;

  let grand = 0;
  orderItems.forEach((item, idx) => {
    grand += item.total;
    const isEditing = item.id === editingItemId;
    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-card-num">#${idx + 1}</span>
        <span class="order-card-name">${item.label}</span>
        <button class="order-card-remove" data-id="${item.id}" title="Удалить">×</button>
      </div>
      <div class="order-card-price">${fmt(item.total)}</div>
      <button class="order-card-edit ${isEditing ? 'editing' : ''}" data-id="${item.id}">
        ${isEditing ? '✏️ Редактируется сейчас...' : 'Изменить'}
      </button>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.order-card-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      orderItems = orderItems.filter(it => it.id !== id);
      if (editingItemId === id) {
        editingItemId = null;
        document.getElementById('addItemBtn').textContent = '+ Добавить в заказ';
      }
      renderOrderCards();
    });
  });

  list.querySelectorAll('.order-card-edit').forEach(btn => {
    btn.addEventListener('click', () => loadItemForEdit(Number(btn.dataset.id)));
  });

  grandEl.textContent = fmt(grand);
  counterTxt.textContent = `В заказе: ${orderItems.length} изд. • ${fmt(grand)}`;
}

function orderSummaryFull() {
  if (orderItems.length === 0) return describeConfig();
  const lines = orderItems.map((it, i) => `${i + 1}. ${it.label}`);
  const grand = orderItems.reduce((s, it) => s + it.total, 0);
  return lines.join('\n') + `\n\nИтого по заказу: ${fmt(grand)}`;
}

// ---------- init ----------
async function init() {
  const res = await fetch('data/materials.json');
  materials = await res.json();

  // default state from first producer/color
  ['korpus', 'fasad', 'fill'].forEach(g => {
    const firstProducer = materials[g]?.producers?.[0];
    state[g + 'Producer'] = firstProducer?.id || null;
    state[g + 'Id']       = firstProducer?.colors?.[0]?.id || null;
  });

  // producer selects + swatches
  renderProducerSelect('korpus', 'korpusProducer', 'korpusSwatches');
  renderProducerSelect('fasad',  'fasadProducer',  'fasadSwatches');
  renderProducerSelect('fill',   'fillProducer',   'fillSwatches');

  renderPresets();

  // type buttons
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.type = btn.dataset.type;
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateTypeBar();
      updateFillContext();
      buildFurniture();
    });
  });

  bindSlider('width',    'width',    ' мм');
  bindSlider('height',   'height',   ' мм');
  bindSlider('depth',    'depth',    ' мм');
  bindSlider('sections', 'sections', '');
  bindSlider('shelves',  'shelves',  '');
  bindSlider('drawers',  'drawers',  '');
  document.getElementById('rod').addEventListener('change', e => { state.rod = e.target.checked; buildFurniture(); });

  bindFasadTab();

  document.getElementById('addItemBtn').addEventListener('click', () => {
    addCurrentToOrder();
    renderOrderCards();
  });

  bindVariantControls();
  bindOrderForm();

  syncUIFromState();
  updateTypeBar();
  updateFillContext();
  buildFurniture();
}

init();
