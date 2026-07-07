import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './state.js';

const viewport = document.getElementById('viewport');
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8e8e8);

export const camera = new THREE.PerspectiveCamera(45, viewport.clientWidth / viewport.clientHeight, 10, 20000);
camera.position.set(3800, 2200, 4800);

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

window.addEventListener('resize', () => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
animate();

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
}
