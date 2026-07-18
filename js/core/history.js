import { state } from './state.js';
import { buildFurniture } from './build.js';

// Отмена последних изменений («шаг назад») — задание пользователя: хранить в памяти несколько
// состояний, минимум 3, с возможностью откатиться. state — единый плоский объект, JSON-клон уже
// используется в другом месте для сравнения (см. hasUnsavedChanges в state.js) — тот же приём
// тут для снимков истории: JSON.stringify(state) достаточно дёшево, чтобы хранить их пачкой.
const MAX_HISTORY = 15; // с запасом сверх «хотя бы 3» из задания
const DEBOUNCE_MS = 500; // непрерывный слайдер/драг шлёт buildFurniture() много раз подряд —
                          // пишем в историю только когда пользователь на секунду остановился,
                          // иначе один жест слайдера превратится в десятки шагов истории.

const stack = []; // JSON-снимки state, старые слева, stack[stack.length-1] — текущее состояние
let debounceTimer = null;
let isRestoring = false; // подавляет запись истории во время самого отката (restore тоже дёргает buildFurniture)
let onChangeCb = null; // UI (кнопка «Назад») подписывается через onHistoryChange, чтобы знать, когда есть куда откатываться

function pushSnapshotNow() {
  debounceTimer = null;
  if (isRestoring) return;
  const snap = JSON.stringify(state);
  if (stack.length && stack[stack.length - 1] === snap) return; // ничего не изменилось — не дублируем
  stack.push(snap);
  if (stack.length > MAX_HISTORY) stack.shift();
  onChangeCb?.(stack.length);
}

function noteChange() {
  if (isRestoring) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(pushSnapshotNow, DEBOUNCE_MS);
}

// Полный сброс истории — вызывается при переключении на другое «изделие» (смена типа, загрузка
// пресета/сохранённой прорисовки): откатываться в чужой, уже не открытый дизайн не нужно, это
// скорее собьёт с толку, чем поможет. Следующее settled-состояние снова станет точкой отсчёта.
export function resetHistory() {
  clearTimeout(debounceTimer);
  debounceTimer = null;
  stack.length = 0;
  onChangeCb?.(0);
}

export function undo() {
  if (debounceTimer) pushSnapshotNow(); // не терять недописанное последнее изменение перед откатом
  if (stack.length < 2) return; // некуда откатываться — только текущее состояние и есть
  stack.pop(); // текущее
  const prev = stack[stack.length - 1];
  isRestoring = true;
  const restored = JSON.parse(prev);
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, restored);
  buildFurniture();
  window.dispatchEvent(new CustomEvent('history-restored'));
  isRestoring = false;
  onChangeCb?.(stack.length);
}

export function canUndo() {
  return stack.length > 1;
}

export function onHistoryChange(cb) {
  onChangeCb = cb;
  cb(stack.length);
}

export function initHistory() {
  window.addEventListener('furniture-rebuilt', noteChange);
}
