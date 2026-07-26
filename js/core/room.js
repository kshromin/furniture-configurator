// Комната вокруг шкафа-купе (задание «стены 26,07») — полупрозрачные стены, пол уже есть в сцене.
// Шкаф стоит у задней стены; комната двигается вдоль X по пресету позиции (лево/центр/право),
// сам шкаф остаётся в начале координат. Габариты и цвет — в state (см. state.roomEnabled и др.).
import * as THREE from 'three';
import { scene, floor as sceneFloor, controls, camera } from './scene.js';
import { state } from './state.js';

// Палитра стен — 10 спокойных интерьерных тонов (задание требует ≤10). Легко заменить на свои.
export const WALL_COLORS = [
  { name: 'Белый',         hex: '#f7f6f2' },
  { name: 'Молочный',      hex: '#f0e8d6' },
  { name: 'Бежевый',       hex: '#ecd9b6' },
  { name: 'Песок',         hex: '#e3c797' },
  { name: 'Светло-серый',  hex: '#dedede' },
  { name: 'Серый',         hex: '#bcbcbc' },
  { name: 'Тёплый серый',  hex: '#cbbca6' },
  { name: 'Голубая дымка', hex: '#c1d6e0' },
  { name: 'Шалфей',        hex: '#c4d3b4' },
  { name: 'Пудра',         hex: '#eccdc7' },
];

// Палитра пола — дерево + нейтральные тона (отдельно от стен).
export const FLOOR_COLORS = [
  { name: 'Беленый дуб',   hex: '#e6dcc8' },
  { name: 'Светлый дуб',   hex: '#d8c39c' },
  { name: 'Дуб',           hex: '#c7a568' },
  { name: 'Ясень',         hex: '#ddd2bd' },
  { name: 'Орех',          hex: '#9c6b3f' },
  { name: 'Терракота',     hex: '#b5754e' },
  { name: 'Венге',         hex: '#4b3a2f' },
  { name: 'Бетон',         hex: '#b8b8b8' },
  { name: 'Тёмно-серый',   hex: '#7a7a7a' },
  { name: 'Графит',        hex: '#4a4a4a' },
];

const WALL_OPACITY = 0.5;

const roomGroup = new THREE.Group();
scene.add(roomGroup);

function wall(w, h, color) {
  // depthWrite:false — стена полупрозрачная, не должна перекрывать/резать шкаф по глубине.
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.95, metalness: 0,
    transparent: true, opacity: WALL_OPACITY,
    side: THREE.DoubleSide, depthWrite: false,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

// Стены, за которые может уйти камера. Для каждой: ось её плоскости (x|z), координата плоскости
// и знак «внутренней» стороны (где стоит шкаф). Стена гаснет, когда камера уходит на внешнюю
// сторону — иначе она встала бы между камерой и шкафом и перекрыла обзор.
let walls = [];

function updateWallVisibility() {
  if (!state.roomEnabled) return;
  const p = camera.position;
  for (const w of walls) {
    // >= -1мм: небольшой допуск, чтобы стена не мигала, когда камера ровно в плоскости.
    w.mesh.visible = (p[w.axis] - w.plane) * w.inside >= -1;
  }
}
// Один слушатель на всё время жизни модуля — читает актуальный массив walls после каждой пересборки.
controls.addEventListener('change', updateWallVisibility);

export function buildRoom() {
  roomGroup.clear();
  // Комната — только для шкафа-купе (работаем по блокам) и когда включена.
  if (!state.roomEnabled || state.type !== 'wardrobe') {
    roomGroup.visible = false;
    sceneFloor.visible = true; // вернуть общий пол сцены
    return;
  }
  roomGroup.visible = true;
  sceneFloor.visible = false; // прячем общий пол — у комнаты свой, по размеру

  const W = state.width, D = state.depth;                  // габариты шкафа
  const rW = Math.max(state.roomWidth, W);                 // комната не уже/мельче/ниже шкафа
  const rD = Math.max(state.roomDepth, D);
  const rH = Math.max(state.roomHeight, state.height);
  const color = new THREE.Color(state.roomColor);

  const backZ = -D / 2;              // задняя стена — вплотную к спинке шкафа (короб: z ∈ [-D/2, D/2])
  const midZ = backZ + rD / 2;       // центр комнаты по глубине (перёд открыт — со стороны камеры)

  // X-границы комнаты по позиции шкафа вдоль задней стены (шкаф: x ∈ [-W/2, W/2], стоит на месте)
  let xL, xR;
  if (state.roomPos === 'left')       { xL = -W / 2; xR = xL + rW; }   // левый бок шкафа — в левый угол
  else if (state.roomPos === 'right') { xR =  W / 2; xL = xR - rW; }   // правый бок — в правый угол
  else                                { xL = -rW / 2; xR = rW / 2; }   // по центру
  const midX = (xL + xR) / 2;

  // Пол по размеру комнаты (непрозрачный, свой цвет). Приподнят на 1мм над общим серым полом
  // сцены, чтобы не мерцал z-fighting'ом; шкаф стоит на y=0 — 1мм под кромкой незаметен.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(rW, rD),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(state.roomFloorColor), roughness: 0.85, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(midX, 1, midZ);
  roomGroup.add(floor);

  // Задняя стена (плоскость XY, лицом в +Z). Внутренняя сторона — z > backZ (там шкаф).
  const back = wall(rW, rH, color);
  back.position.set(midX, rH / 2, backZ);
  roomGroup.add(back);

  // Левая стена (плоскость ZY, лицом в +X). Внутри — x > xL.
  const left = wall(rD, rH, color);
  left.rotation.y = Math.PI / 2;
  left.position.set(xL, rH / 2, midZ);
  roomGroup.add(left);

  // Правая стена (плоскость ZY, лицом в -X). Внутри — x < xR.
  const right = wall(rD, rH, color);
  right.rotation.y = -Math.PI / 2;
  right.position.set(xR, rH / 2, midZ);
  roomGroup.add(right);

  walls = [
    { mesh: back,  axis: 'z', plane: backZ, inside:  1 },
    { mesh: left,  axis: 'x', plane: xL,    inside:  1 },
    { mesh: right, axis: 'x', plane: xR,    inside: -1 },
  ];
  updateWallVisibility(); // сразу привести к текущему положению камеры (до первого её движения)
}
