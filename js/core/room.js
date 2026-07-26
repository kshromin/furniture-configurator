// Комната вокруг шкафа-купе (задание «стены 26,07») — полупрозрачные стены, пол уже есть в сцене.
// Шкаф стоит у задней стены; комната двигается вдоль X по пресету позиции (лево/центр/право),
// сам шкаф остаётся в начале координат. Габариты и цвет — в state (см. state.roomEnabled и др.).
import * as THREE from 'three';
import { scene } from './scene.js';
import { state } from './state.js';

// Палитра стен — 10 спокойных интерьерных тонов (задание требует ≤10). Легко заменить на свои.
export const WALL_COLORS = [
  { name: 'Белый',         hex: '#f5f4f1' },
  { name: 'Молочный',      hex: '#efe9df' },
  { name: 'Бежевый',       hex: '#e6d9c3' },
  { name: 'Песок',         hex: '#dcc9a8' },
  { name: 'Светло-серый',  hex: '#dcdcdc' },
  { name: 'Серый',         hex: '#c2c2c2' },
  { name: 'Тёплый серый',  hex: '#cabfb2' },
  { name: 'Голубая дымка', hex: '#ccd6da' },
  { name: 'Шалфей',        hex: '#ccd3c2' },
  { name: 'Пудра',         hex: '#e3d2cf' },
];

const WALL_OPACITY = 0.34;

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

export function buildRoom() {
  roomGroup.clear();
  // Комната — только для шкафа-купе (работаем по блокам) и когда включена.
  if (!state.roomEnabled || state.type !== 'wardrobe') { roomGroup.visible = false; return; }
  roomGroup.visible = true;

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

  // Задняя стена (плоскость XY, лицом в +Z)
  const back = wall(rW, rH, color);
  back.position.set(midX, rH / 2, backZ);
  roomGroup.add(back);

  // Левая стена (плоскость ZY, лицом в +X)
  const left = wall(rD, rH, color);
  left.rotation.y = Math.PI / 2;
  left.position.set(xL, rH / 2, midZ);
  roomGroup.add(left);

  // Правая стена (плоскость ZY, лицом в -X)
  const right = wall(rD, rH, color);
  right.rotation.y = -Math.PI / 2;
  right.position.set(xR, rH / 2, midZ);
  roomGroup.add(right);
}
