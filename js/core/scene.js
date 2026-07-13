import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './state.js';
import { showToast } from './toast.js';

const viewport = document.getElementById('viewport');
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8e8e8);

const perspCamera = new THREE.PerspectiveCamera(45, viewport.clientWidth / viewport.clientHeight, 10, 20000);
perspCamera.position.set(3800, 2200, 4800);

// Ортографическая камера — «вид в плоскости» (см. showFrontView/showPerspectiveView), включается
// средней кнопкой мыши: без перспективных искажений размеры на модели читаются как на чертеже.
const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 20000);

// camera — mutable-биндинг (не const): showFrontView/showPerspectiveView переключают, чем
// рендерим сцену; itemDrag.js/dimensions.js импортируют её же и всегда видят актуальную (ES-
// модули отдают "живые" биндинги), поэтому раздельно синхронизировать их не нужно.
export let camera = perspCamera;

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
viewport.appendChild(renderer.domElement);

export const controls = new OrbitControls(camera, renderer.domElement);
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

function updateOrthoFrustum() {
  const aspect = viewport.clientWidth / viewport.clientHeight;
  // Половина видимой высоты в мировых единицах — с запасом вокруг габаритов текущего изделия,
  // чтобы модель не обрезалась по краям вне зависимости от её размера.
  const halfH = Math.max(state.height, state.width / aspect) * 0.65 + 400;
  orthoCamera.left = -halfH * aspect;
  orthoCamera.right = halfH * aspect;
  orthoCamera.top = halfH;
  orthoCamera.bottom = -halfH;
  orthoCamera.updateProjectionMatrix();
}

window.addEventListener('resize', () => {
  perspCamera.aspect = viewport.clientWidth / viewport.clientHeight;
  perspCamera.updateProjectionMatrix();
  updateOrthoFrustum();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
animate();

// «Вид в плоскости» (вид спереди, без перспективы) — включается средней кнопкой мыши (см.
// перехватчик ниже), выключается нажатием ЛКМ (см. js/core/itemDrag.js — там же проверяется
// isFrontView() в начале onPointerDown, чтобы не начинался драг элемента при выходе из режима).
let frontView = false;
export function isFrontView() { return frontView; }

export function showFrontView() {
  if (frontView) return;
  frontView = true;
  updateOrthoFrustum();
  const targetY = controls.target.y;
  orthoCamera.position.set(0, targetY, 4000);
  orthoCamera.up.set(0, 1, 0);
  orthoCamera.lookAt(0, targetY, 0);
  camera = orthoCamera;
  controls.object = camera;
  controls.enableRotate = false;
  controls.update();
}

export function showPerspectiveView() {
  if (!frontView) return;
  frontView = false;
  camera = perspCamera;
  controls.object = camera;
  controls.enableRotate = true;
  controls.update();
}

// Средняя кнопка — вход в вид спереди. Перехватываем на фазе capture (раньше, чем OrbitControls
// — тот по умолчанию тоже реагирует на среднюю кнопку долли-зумом), иначе оба обработчика сразу
// среагируют на один и тот же клик.
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  showToast('Вид в плоскости (спереди, без перспективы). ЛКМ — вернуться в 3D.');
  showFrontView();
}, true);

export const furnitureGroup = new THREE.Group();
scene.add(furnitureGroup);

function panelMesh(w, h, d, color, opacity) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const p = { color, roughness: 0.6, metalness: 0.05 };
  if (opacity !== undefined && opacity < 1) { p.transparent = true; p.opacity = opacity; }
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial(p));
}

export function addPanel(w, h, d, color, pos, opacity) {
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

export function focusCameraOnFurniture() {
  controls.target.set(0, state.height / 2, 0);
  if (frontView) {
    updateOrthoFrustum();
    orthoCamera.position.set(0, controls.target.y, orthoCamera.position.z);
    orthoCamera.lookAt(0, controls.target.y, 0);
    controls.update();
  }
}
