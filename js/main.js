import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PANEL_THICKNESS = 18; // mm

let materials = { korpus: [], fasad: [] };
let state = {
  width: 1800,
  height: 2400,
  depth: 600,
  korpusId: null,
  fasadId: null,
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

// ---------- wardrobe model ----------
const wardrobeGroup = new THREE.Group();
scene.add(wardrobeGroup);

function panelMesh(w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
  return new THREE.Mesh(geo, mat);
}

function buildWardrobe() {
  wardrobeGroup.clear();

  const { width, height, depth } = state;
  const t = PANEL_THICKNESS;
  const korpusColor = getMaterial('korpus', state.korpusId).color;
  const fasadColor = getMaterial('fasad', state.fasadId).color;

  // korpus: bottom, top, left, right, back
  const bottom = panelMesh(width, t, depth, korpusColor);
  bottom.position.set(0, t / 2, 0);
  wardrobeGroup.add(bottom);

  const top = panelMesh(width, t, depth, korpusColor);
  top.position.set(0, height - t / 2, 0);
  wardrobeGroup.add(top);

  const left = panelMesh(t, height - 2 * t, depth, korpusColor);
  left.position.set(-width / 2 + t / 2, height / 2, 0);
  wardrobeGroup.add(left);

  const right = panelMesh(t, height - 2 * t, depth, korpusColor);
  right.position.set(width / 2 - t / 2, height / 2, 0);
  wardrobeGroup.add(right);

  const back = panelMesh(width - 2 * t, height - 2 * t, 4, korpusColor);
  back.position.set(0, height / 2, -depth / 2 + 2);
  wardrobeGroup.add(back);

  // facade doors
  const doorCount = Math.max(2, Math.min(4, Math.round(width / 900)));
  const gap = 4;
  const doorWidth = (width - gap * (doorCount + 1)) / doorCount;
  const doorHeight = height - 2 * gap;
  for (let i = 0; i < doorCount; i++) {
    const door = panelMesh(doorWidth, doorHeight, t, fasadColor);
    const x = -width / 2 + gap + doorWidth / 2 + i * (doorWidth + gap);
    door.position.set(x, height / 2, depth / 2 - t / 2);
    wardrobeGroup.add(door);
  }

  wardrobeGroup.position.y = 0;
  controls.target.set(0, height / 2, 0);

  updatePrice(doorCount, doorWidth, doorHeight);
}

// ---------- materials / UI ----------
function getMaterial(group, id) {
  return materials[group].find(m => m.id === id) || materials[group][0];
}

function renderSwatches(group, containerId, onPick) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  materials[group].forEach(m => {
    const el = document.createElement('div');
    el.className = 'swatch' + (m.id === state[group + 'Id'] ? ' selected' : '');
    el.style.background = m.color;
    el.title = m.name + ' — ' + m.pricePerM2 + ' ₽/м²';
    el.addEventListener('click', () => {
      state[group + 'Id'] = m.id;
      renderSwatches(group, containerId, onPick);
      buildWardrobe();
    });
    container.appendChild(el);
  });
}

function updatePrice(doorCount, doorWidth, doorHeight) {
  const { width, height, depth } = state;
  const t = PANEL_THICKNESS;

  const korpusAreaMm2 =
    width * t +                       // bottom
    width * t +                       // top
    t * (height - 2 * t) +            // left
    t * (height - 2 * t) +            // right
    (width - 2 * t) * (height - 2 * t); // back

  const fasadAreaMm2 = doorCount * doorWidth * doorHeight;

  const korpusM2 = korpusAreaMm2 / 1e6;
  const fasadM2 = fasadAreaMm2 / 1e6;

  const korpusPrice = korpusM2 * getMaterial('korpus', state.korpusId).pricePerM2;
  const fasadPrice = fasadM2 * getMaterial('fasad', state.fasadId).pricePerM2;
  const total = korpusPrice + fasadPrice;

  document.getElementById('priceKorpus').textContent = formatRub(korpusPrice);
  document.getElementById('priceFasad').textContent = formatRub(fasadPrice);
  document.getElementById('priceTotal').textContent = formatRub(total);
}

function formatRub(v) {
  return Math.round(v).toLocaleString('ru-RU') + ' ₽';
}

// ---------- size controls ----------
function bindSlider(id, stateKey, suffix) {
  const input = document.getElementById(id);
  const label = document.getElementById(id + 'Val');
  const sync = () => {
    state[stateKey] = Number(input.value);
    label.textContent = input.value + (suffix || '');
    buildWardrobe();
  };
  input.addEventListener('input', sync);
  sync();
}

// ---------- init ----------
async function init() {
  const res = await fetch('data/materials.json');
  materials = await res.json();
  state.korpusId = materials.korpus[0].id;
  state.fasadId = materials.fasad[0].id;

  renderSwatches('korpus', 'korpusSwatches');
  renderSwatches('fasad', 'fasadSwatches');

  bindSlider('width', 'width', ' мм');
  bindSlider('height', 'height', ' мм');
  bindSlider('depth', 'depth', ' мм');
}

init();
