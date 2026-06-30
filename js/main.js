import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PANEL_THICKNESS = 18; // mm

let materials = { korpus: [], fasad: [], fittings: [], presets: [] };
let state = {
  type: 'wardrobe',
  width: 1800,
  height: 2400,
  depth: 600,
  korpusId: null,
  fasadId: null,
  shelves: 3,
  drawers: 0,
  rod: true,
};

// ---------- scene setup ----------
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
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(1500, 2500, 2000);
scene.add(dirLight);
const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
dirLight2.position.set(-1500, 1000, -1000);
scene.add(dirLight2);

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

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ---------- furniture model ----------
const furnitureGroup = new THREE.Group();
scene.add(furnitureGroup);

function panelMesh(w, h, d, color, opacity) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const matParams = { color, roughness: 0.6, metalness: 0.05 };
  if (opacity !== undefined && opacity < 1) {
    matParams.transparent = true;
    matParams.opacity = opacity;
  }
  const mat = new THREE.MeshStandardMaterial(matParams);
  return new THREE.Mesh(geo, mat);
}

function getDoorCount(width) {
  return Math.max(2, Math.min(4, Math.round(width / 900)));
}

function buildFurniture() {
  furnitureGroup.clear();
  const counts = state.type === 'chest' ? buildChest() : buildWardrobe();
  furnitureGroup.position.y = 0;
  controls.target.set(0, state.height / 2, 0);
  updatePrice(counts);
}

function buildWardrobe() {
  const { width, height, depth, shelves, drawers, rod } = state;
  const t = PANEL_THICKNESS;
  const korpusColor = getMaterial('korpus', state.korpusId).color;
  const fasadColor = getMaterial('fasad', state.fasadId).color;

  // korpus: bottom, top, left, right, back
  addPanel(width, t, depth, korpusColor, [0, t / 2, 0]);
  addPanel(width, t, depth, korpusColor, [0, height - t / 2, 0]);
  addPanel(t, height - 2 * t, depth, korpusColor, [-width / 2 + t / 2, height / 2, 0]);
  addPanel(t, height - 2 * t, depth, korpusColor, [width / 2 - t / 2, height / 2, 0]);
  addPanel(width - 2 * t, height - 2 * t, 4, korpusColor, [0, height / 2, -depth / 2 + 2]);

  // sliding doors (slightly transparent so the interior fill stays visible)
  const doorCount = getDoorCount(width);
  const gap = 4;
  const doorWidth = (width - gap * (doorCount + 1)) / doorCount;
  const doorHeight = height - 2 * gap;
  for (let i = 0; i < doorCount; i++) {
    const x = -width / 2 + gap + doorWidth / 2 + i * (doorWidth + gap);
    addPanel(doorWidth, doorHeight, t, fasadColor, [x, height / 2, depth / 2 - t / 2], 0.85);
  }

  // interior fill
  const innerWidth = width - 2 * t - 20;
  const innerDepth = depth - 60;
  const fillBottom = t + 10;
  const fillTop = height - t - 10;

  let drawerBlockTop = fillBottom;
  if (drawers > 0) {
    const drawerBlockHeight = Math.min(700, (fillTop - fillBottom) * 0.4);
    const drawerHeight = (drawerBlockHeight - (drawers - 1) * 4) / drawers;
    for (let i = 0; i < drawers; i++) {
      const y = fillBottom + i * (drawerHeight + 4) + drawerHeight / 2;
      addPanel(innerWidth, drawerHeight, t, fasadColor, [0, y, depth / 2 - t - 20], 0.9);
    }
    drawerBlockTop = fillBottom + drawerBlockHeight + 20;
  }

  if (shelves > 0) {
    const usableHeight = fillTop - drawerBlockTop - (rod ? 250 : 0);
    for (let i = 0; i < shelves; i++) {
      const y = drawerBlockTop + (usableHeight * (i + 1)) / (shelves + 1);
      addPanel(innerWidth, t, innerDepth, korpusColor, [0, y, 0]);
    }
  }

  if (rod) {
    const rodGeo = new THREE.CylinderGeometry(8, 8, innerWidth, 12);
    const rodMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.3 });
    const rodMesh = new THREE.Mesh(rodGeo, rodMat);
    rodMesh.rotation.z = Math.PI / 2;
    rodMesh.position.set(0, fillTop - 60, depth / 2 - 100);
    furnitureGroup.add(rodMesh);
  }

  return { door: doorCount, drawer: drawers, shelf: shelves, rod: rod ? 1 : 0, item: 1 };
}

function buildChest() {
  const { width, height, depth, drawers } = state;
  const t = PANEL_THICKNESS;
  const korpusColor = getMaterial('korpus', state.korpusId).color;
  const fasadColor = getMaterial('fasad', state.fasadId).color;
  const drawerCount = Math.max(1, drawers);

  addPanel(width, t, depth, korpusColor, [0, t / 2, 0]);
  addPanel(width, t, depth, korpusColor, [0, height - t / 2, 0]);
  addPanel(t, height - 2 * t, depth, korpusColor, [-width / 2 + t / 2, height / 2, 0]);
  addPanel(t, height - 2 * t, depth, korpusColor, [width / 2 - t / 2, height / 2, 0]);
  addPanel(width - 2 * t, height - 2 * t, 4, korpusColor, [0, height / 2, -depth / 2 + 2]);

  const gap = 4;
  const innerHeight = height - 2 * t;
  const drawerHeight = (innerHeight - gap * (drawerCount + 1)) / drawerCount;
  const innerWidth = width - 2 * t - 10;
  for (let i = 0; i < drawerCount; i++) {
    const y = t + gap + i * (drawerHeight + gap) + drawerHeight / 2;
    addPanel(innerWidth, drawerHeight, t, fasadColor, [0, y, depth / 2 - t / 2]);
  }

  return { door: 0, drawer: drawerCount, shelf: 0, rod: 0, item: 1 };
}

function addPanel(w, h, d, color, position, opacity) {
  const mesh = panelMesh(w, h, d, color, opacity);
  mesh.position.set(position[0], position[1], position[2]);
  furnitureGroup.add(mesh);
  return mesh;
}

// ---------- materials / UI ----------
function getMaterial(group, id) {
  return materials[group].find(m => m.id === id) || materials[group][0];
}

function renderSwatches(group, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  materials[group].forEach(m => {
    const el = document.createElement('div');
    el.className = 'swatch' + (m.id === state[group + 'Id'] ? ' selected' : '');
    el.style.background = m.color;
    el.title = m.name + ' — ' + m.pricePerM2 + ' ₽/м²';
    el.addEventListener('click', () => {
      state[group + 'Id'] = m.id;
      renderSwatches(group, containerId);
      buildFurniture();
    });
    container.appendChild(el);
  });
}

function renderPresets() {
  const container = document.getElementById('presets');
  container.innerHTML = '';
  (materials.presets || []).forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.textContent = p.name;
    btn.addEventListener('click', () => applyPreset(p));
    container.appendChild(btn);
  });
}

function applyPreset(p) {
  state.type = p.type || 'wardrobe';
  state.width = p.width;
  state.height = p.height;
  state.depth = p.depth;
  state.korpusId = p.korpusId;
  state.fasadId = p.fasadId;
  state.shelves = p.shelves || 0;
  state.drawers = p.drawers || 0;
  state.rod = !!p.rod;
  syncControlsFromState();
  renderSwatches('korpus', 'korpusSwatches');
  renderSwatches('fasad', 'fasadSwatches');
  buildFurniture();
}

function syncControlsFromState() {
  document.getElementById('furnitureType').value = state.type;
  setSlider('width', state.width, ' мм');
  setSlider('height', state.height, ' мм');
  setSlider('depth', state.depth, ' мм');
  setSlider('shelves', state.shelves, '');
  setSlider('drawers', state.drawers, '');
  document.getElementById('rod').checked = state.rod;
  updateFieldVisibility();
}

function setSlider(id, value, suffix) {
  const input = document.getElementById(id);
  input.value = value;
  document.getElementById(id + 'Val').textContent = value + (suffix || '');
}

function updateFieldVisibility() {
  const isChest = state.type === 'chest';
  document.getElementById('fillFields').style.display = isChest ? 'none' : 'block';
  document.getElementById('title').textContent = isChest ? 'Комод' : 'Шкаф-купе';
}

// ---------- pricing ----------
function updatePrice(counts) {
  const { width, height, depth, type } = state;
  const t = PANEL_THICKNESS;

  const korpusAreaMm2 =
    width * t +
    width * t +
    t * (height - 2 * t) +
    t * (height - 2 * t) +
    (width - 2 * t) * (height - 2 * t);
  const korpusM2 = korpusAreaMm2 / 1e6;
  const korpusPrice = korpusM2 * getMaterial('korpus', state.korpusId).pricePerM2;

  let fasadM2 = 0;
  let fillM2 = 0;
  const fasadPricePerM2 = getMaterial('fasad', state.fasadId).pricePerM2;

  if (type === 'wardrobe') {
    const doorCount = getDoorCount(width);
    const gap = 4;
    const doorWidth = (width - gap * (doorCount + 1)) / doorCount;
    const doorHeight = height - 2 * gap;
    fasadM2 = (doorCount * doorWidth * doorHeight) / 1e6;

    const innerWidth = width - 2 * t - 20;
    if (state.drawers > 0) {
      const drawerBlockHeight = Math.min(700, (height - 2 * t - 20) * 0.4);
      fillM2 += (innerWidth * drawerBlockHeight) / 1e6;
    }
    if (state.shelves > 0) {
      const innerDepth = depth - 60;
      fillM2 += (state.shelves * innerWidth * innerDepth) / 1e6;
    }
  } else {
    const drawerCount = Math.max(1, state.drawers);
    const innerWidth = width - 2 * t - 10;
    const innerHeight = height - 2 * t;
    fasadM2 = (innerWidth * innerHeight) / 1e6; // drawer fronts cover the whole face
    void drawerCount;
  }

  const fasadPrice = fasadM2 * fasadPricePerM2;
  const fillPrice = fillM2 * getMaterial('korpus', state.korpusId).pricePerM2;

  const fittingsPrice = (materials.fittings || []).reduce((sum, f) => {
    let n = 0;
    if (f.per === 'front') n = counts.door + counts.drawer;
    else n = counts[f.per] || 0;
    return sum + f.price * n;
  }, 0);

  const total = korpusPrice + fasadPrice + fillPrice + fittingsPrice;

  document.getElementById('priceKorpus').textContent = formatRub(korpusPrice);
  document.getElementById('priceFasad').textContent = formatRub(fasadPrice);
  document.getElementById('priceFill').textContent = formatRub(fillPrice);
  document.getElementById('priceFittings').textContent = formatRub(fittingsPrice);
  document.getElementById('priceTotal').textContent = formatRub(total);

  state.lastTotal = total;
}

function formatRub(v) {
  return Math.round(v).toLocaleString('ru-RU') + ' ₽';
}

// ---------- controls ----------
function bindSlider(id, stateKey, suffix) {
  const input = document.getElementById(id);
  const label = document.getElementById(id + 'Val');
  const sync = () => {
    state[stateKey] = Number(input.value);
    label.textContent = input.value + (suffix || '');
    buildFurniture();
  };
  input.addEventListener('input', sync);
}

function bindFurnitureType() {
  const select = document.getElementById('furnitureType');
  select.addEventListener('change', () => {
    state.type = select.value;
    updateFieldVisibility();
    buildFurniture();
  });
}

function bindRod() {
  const checkbox = document.getElementById('rod');
  checkbox.addEventListener('change', () => {
    state.rod = checkbox.checked;
    buildFurniture();
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
  document.getElementById('orderCancel').addEventListener('click', () => {
    overlay.classList.remove('visible');
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('visible');
  });
  document.getElementById('orderSubmit').addEventListener('click', () => {
    const name = document.getElementById('orderName').value.trim();
    const phone = document.getElementById('orderPhone').value.trim();
    const result = document.getElementById('orderResult');
    if (!name) {
      result.textContent = 'Укажите имя';
      result.style.color = 'red';
      return;
    }
    if (!phone) {
      result.textContent = 'Укажите телефон';
      result.style.color = 'red';
      return;
    }
    const order = {
      id: Date.now(),
      name,
      phone,
      summary: describeConfig(),
      total: state.lastTotal,
      createdAt: new Date().toISOString(),
    };
    const orders = JSON.parse(localStorage.getItem('orders') || '[]');
    orders.push(order);
    localStorage.setItem('orders', JSON.stringify(orders));

    result.style.color = 'green';
    result.textContent = 'Заявка сохранена. Мы свяжемся с вами!';
    setTimeout(() => overlay.classList.remove('visible'), 1500);
  });
}

function describeConfig() {
  const typeName = state.type === 'chest' ? 'Комод' : 'Шкаф-купе';
  const korpus = getMaterial('korpus', state.korpusId).name;
  const fasad = getMaterial('fasad', state.fasadId).name;
  let line = `${typeName}, ${state.width}×${state.height}×${state.depth} мм, корпус: ${korpus}, фасад: ${fasad}`;
  if (state.type === 'wardrobe') {
    line += `, полок: ${state.shelves}, ящиков: ${state.drawers}, штанга: ${state.rod ? 'да' : 'нет'}`;
  } else {
    line += `, ящиков: ${Math.max(1, state.drawers)}`;
  }
  line += `. Итого: ${formatRub(state.lastTotal || 0)}`;
  return line;
}

// ---------- init ----------
async function init() {
  const res = await fetch('data/materials.json');
  materials = await res.json();
  state.korpusId = materials.korpus[0].id;
  state.fasadId = materials.fasad[0].id;

  renderSwatches('korpus', 'korpusSwatches');
  renderSwatches('fasad', 'fasadSwatches');
  renderPresets();

  bindSlider('width', 'width', ' мм');
  bindSlider('height', 'height', ' мм');
  bindSlider('depth', 'depth', ' мм');
  bindSlider('shelves', 'shelves', '');
  bindSlider('drawers', 'drawers', '');
  bindFurnitureType();
  bindRod();
  bindOrderForm();

  syncControlsFromState();
  buildFurniture();
}

init();
