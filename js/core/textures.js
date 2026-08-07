import * as THREE from 'three';

// Текстуры материалов в 3D (задание «текстуры 17,07», сделано 5.08). Файлы кладёт скрипт
// `scripts/textures_import.py` («Загрузить текстуры.bat»): проверяет → жмёт до 1024px → в
// `data/textures`, а имя файла проставляет материалу в поле `texture` (см. DATA-SCHEMA).
//
// Правила из задания и как они здесь выполнены:
//  1. Файлы лёгкие (жмёт скрипт при заливке) — тут только грузим.
//  2. ТАЙЛИНГ, а не растяжение: рисунок повторяется каждые MM_PER_TILE мм (RepeatWrapping).
//     Масштаб задаётся НЕ через texture.repeat, а разворотом UV самой панели (scaleBoxUV):
//     repeat живёт в объекте текстуры, а панели все разного размера — пришлось бы клонировать
//     текстуру на каждую деталь. С UV один объект текстуры обслуживает весь шкаф, и каждая
//     грань (пласть/торец) получает СВОЙ масштаб — рисунок на торцах не растянут.
//  3. Грузим только то, что реально стоит на модели: запрос идёт из panelMesh при сборке.
//  4. Один файл — одна загрузка: кэш ниже, панели переиспользуют один объект текстуры.
//  5. dispose при смене каталога — releaseUnused() (вызывается после пересборки сцены).
const MM_PER_TILE = 500;   // сколько миллиметров занимает одна «плитка» рисунка (решение пользователя)
const TEX_DIR = 'data/textures/';

const loader = new THREE.TextureLoader();
const cache = new Map();   // имя файла → { tex, failed, waiting:Set<Material>, used:boolean }

function setup(tex) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;   // тайлинг
  tex.colorSpace = THREE.SRGBColorSpace;          // иначе древесина уходит в пересвет
  tex.anisotropy = 4;                             // three сам обрежет до предела видеокарты
  return tex;
}

// Текстура поверх цвета красилась бы в этот цвет (map умножается на material.color), поэтому у
// текстурированной панели цвет делаем белым — рисунок показывается как есть.
function applyTo(material, tex) {
  material.map = tex;
  material.color.set(0xffffff);
  material.needsUpdate = true;
}

/** Запросить текстуру для материала панели. Готовую ставит сразу, ещё не загруженную — по приходу
 *  (сцена рендерится непрерывно, отдельная перерисовка не нужна). Файла нет → панель остаётся
 *  цветной, как раньше. */
export function requestTexture(file, material) {
  let e = cache.get(file);
  if (!e) {
    e = { tex: null, failed: false, waiting: new Set(), used: true };
    cache.set(file, e);
    loader.load(
      TEX_DIR + encodeURIComponent(file),
      tex => {
        e.tex = setup(tex);
        e.waiting.forEach(m => applyTo(m, tex));
        e.waiting.clear();
      },
      undefined,
      () => {
        e.failed = true;                 // нет файла — не пытаемся снова, панель просто цветная
        e.waiting.clear();
        console.warn('Текстура не загрузилась:', file);
      },
    );
  }
  e.used = true;
  if (e.tex) applyTo(material, e.tex);
  else if (!e.failed) e.waiting.add(material);
}

/** Развернуть UV коробки так, чтобы рисунок повторялся каждые MM_PER_TILE мм по КАЖДОЙ грани.
 *  BoxGeometry держит uv гранями по 4 вершины в порядке +x, -x, +y, -y, +z, -z. */
export function scaleBoxUV(geo, w, h, d) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  // Направление волокон (задание 7.08). На картинках текстур волокна ВСЕГДА вертикальные, то есть
  // идут по оси V. У деталей, которые стоят вертикально (стойки, фасады — в том числе фасады
  // ящиков, задние щиты), так и надо: оставляем как есть. У ГОРИЗОНТАЛЬНЫХ деталей (полка, крыша,
  // дно — у них самый малый размер по высоте) волокна должны идти ВДОЛЬ ДЛИНЫ детали, слева
  // направо, поэтому развёртку их пласти (верх/низ, грани ±Y) поворачиваем на 90°.
  const horizontal = h < w && h < d;
  const faceSize = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceSize[f];
    const rotate = horizontal && (f === 2 || f === 3);   // пласть горизонтальной детали
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      const u = uv.getX(k), v = uv.getY(k);
      // при повороте оси меняются местами: U идёт по глубине, V (волокна) — по длине детали
      if (rotate) uv.setXY(k, v * sv / MM_PER_TILE, u * su / MM_PER_TILE);
      else        uv.setXY(k, u * su / MM_PER_TILE, v * sv / MM_PER_TILE);
    }
  }
  uv.needsUpdate = true;
}

/** Материал панели может задаваться как hex (профили, зеркало, служебные цвета) или позицией
 *  каталога {color, texture} — тогда у неё может быть текстура. */
export function colorSpec(color) {
  if (color && typeof color === 'object') {
    return { color: color.color || 0xcccccc, texture: color.texture || null };
  }
  return { color, texture: null };
}

/** Освободить видеопамять от текстур, которых больше нет на модели (сменили материал/каталог).
 *  Вызывается после пересборки сцены: то, что не запрашивали в этой сборке, выгружаем. */
export function releaseUnused() {
  cache.forEach((e, file) => {
    if (e.used) { e.used = false; return; }
    if (e.failed) return;   // запись-надгробие: файла нет, но и повторно дёргать его не будем
    e.tex?.dispose();
    cache.delete(file);
  });
}

/** Пометить начало новой сборки: всё, что не запросят заново, уйдёт в releaseUnused(). */
export function beginFrame() {
  cache.forEach(e => { e.used = false; });
}
