import { state, markStateSafe, hasUnsavedChanges } from './state.js';
import { getColor } from './materials.js';
import { fmt } from './pricing.js';
import { TYPES } from '../types/registry.js';
import { syncUIFromState } from './tabs.js';
import { renderSwatches } from './materials.js';
import { buildFurniture } from './build.js';
import { resetHistory } from './history.js';
import { supabase } from './supabaseClient.js';
import { auth } from './auth.js';
import { showToast, showChoiceDialog } from './toast.js';
import { scene, camera, renderer } from './scene.js';

// Вкладка «Прорисовки» — локальный рабочий комплект (несколько изделий/услуг), без адресного
// сохранения. Комплект целиком сохраняется одной строкой таблицы projects (см.
// SUPABASE-SETUP.md п.11): kind='project' (краткая карточка клиента, без адреса) или
// kind='order' (клиент заключает договор — расширенные поля, адрес обязателен).
let orderItems = []; // текущие прорисовки: { id, kind?: 'extra', label, total, snapshot|null }
let editingItemId = null; // id локально редактируемой прорисовки

// Открытый проект из вкладки «Проекты»: «Сохранить в проект»/«Добавить в заказ» обновляют
// именно эту строку projects, а не создают новую.
let editingProjectId = null;
let editingProjectClient = null; // { name, phone, address }
let editingProjectTitle = '';
let editingProjectKind = 'project';  // project | order — что именно открыто
let editingProjectCode = '';         // № открытого проекта/заказа (для строки-индикатора)

// Строка под типом изделия (typeBar): в каком комплекте сейчас работаем — «Новая прорисовка»
// или название/№ открытого проекта/заказа. Обновляется при каждом renderOrderCards.
function updateKitBar() {
  const bar = document.getElementById('kitBar');
  const editBar = document.getElementById('editBar');
  if (!bar) return;
  if (editingProjectId !== null) {
    const kindLabel = editingProjectKind === 'order' ? 'Заказ' : 'Проект';
    const name = editingProjectTitle || editingProjectClient?.name || '';
    bar.textContent = `${kindLabel}${editingProjectCode ? ' ' + editingProjectCode : ''}${name ? ' — ' + name : ''}`;
    bar.classList.add('kit-editing');
  } else {
    bar.textContent = 'Новая прорисовка';
    bar.classList.remove('kit-editing');
  }
  // Верхняя строка — режим правки позиции («Изменить» → «✓ Обновить позицию»), самая заметная
  if (editBar) {
    const idx = editingItemId !== null ? orderItems.findIndex(it => it.id === editingItemId) : -1;
    editBar.style.display = idx !== -1 ? 'block' : 'none';
    if (idx !== -1) editBar.textContent = `Правка позиции #${idx + 1}`;
  }
}
let itemsSavedToProject = false; // текущий комплект уже сохранён (для предупреждения при открытии другого)

let modalKind = 'project'; // какой режим открыт в модалке: project | order

export function describeConfig() {
  const type = TYPES[state.type];
  const kName = getColor('korpus').name || '';
  const fName = getColor('fasad').name  || '';
  let s = `${type?.name || state.type}, ${state.width}×${state.height}×${state.depth} мм`;
  s += `, корпус: ${kName}, фасад: ${fName}`;
  s += type.describe();
  // Спец. цвета наполнения дверей: названия вводит пользователь (задание 21.07), в смете должно
  // быть видно, какие именно материалы имелись в виду. Спеццветов может быть несколько разных —
  // глобальный (doorFill с «Фасада») и индивидуальные по секциям дверей (doorCustom.specialInfo);
  // перечисляем без повторов.
  if (type?.ctx?.fasad?.available) {
    const specials = [];
    if (state.doorFill === 'special') {
      specials.push({ name: state.specialFillName || 'без названия', price: state.specialFillPrice });
    }
    Object.values(state.doorCustom || {}).forEach(c => (c?.fills || []).forEach((f, j) => {
      if (f !== 'special') return;
      const sp = c.specialInfo?.[j];
      specials.push({
        name: sp?.name || state.specialFillName || 'без названия',
        price: sp?.price ?? state.specialFillPrice,
      });
    }));
    const seen = new Set();
    const uniq = specials.filter(x => { const k = x.name + '|' + x.price; if (seen.has(k)) return false; seen.add(k); return true; });
    if (uniq.length) s += ', спец. цвет: ' + uniq.map(x => `«${x.name}» ${x.price} ₽/м²`).join(', ');
  }
  s += `. Итого: ${fmt(state.lastTotal || 0)}`;
  return s;
}

export function addCurrentToOrder() {
  const snap = JSON.parse(JSON.stringify(state));
  if (editingItemId !== null) {
    const idx = orderItems.findIndex(it => it.id === editingItemId);
    if (idx !== -1) {
      orderItems[idx].label    = describeConfig();
      orderItems[idx].total    = state.lastTotal || 0;
      orderItems[idx].snapshot = snap;
    }
    editingItemId = null;
    document.getElementById('addItemBtn').textContent = '+ Добавить в прорисовки';
  } else {
    orderItems.push({ id: Date.now(), label: describeConfig(), total: state.lastTotal || 0, snapshot: snap });
  }
  itemsSavedToProject = false;
  markStateSafe();
  renderOrderCards();
}

// Доп. элемент/услуга (вкладка «Добавить к заказу») — без 3D-снапшота, только строка с ценой.
export function addExtraItem(label, total) {
  orderItems.push({ id: Date.now(), kind: 'extra', label, total, snapshot: null });
  itemsSavedToProject = false;
  renderOrderCards();
}

export function loadItemForEdit(id) {
  const item = orderItems.find(it => it.id === id);
  if (!item || !item.snapshot) return;
  editingItemId = id;
  Object.assign(state, JSON.parse(JSON.stringify(item.snapshot)));
  syncUIFromState();
  ['korpus', 'fasad', 'fill'].forEach(g => {
    document.getElementById(g + 'Producer').value = state[g + 'Producer'];
    renderSwatches(g, g + 'Swatches');
  });
  buildFurniture();
  document.getElementById('addItemBtn').textContent = '✓ Обновить позицию';
  // Остаёмся на вкладке «Прорисовки»: карточка получает статус «Редактируется сейчас…»,
  // в kitBar видно «правка позиции #N» — понятно, где находишься; на вкладки настроек
  // пользователь перейдёт сам, когда надо (раньше насильно перекидывало на «Тип»).
  renderOrderCards();
  markStateSafe();
  resetHistory(); // другая прорисовка — не откатываться в историю прежней (см. history.js)
}

// Продолжение, отложенное до успешного сохранения (задание «сохранение заказа 21,07»): guard
// ниже предлагает сохранить несохранённые прорисовки перед действием, которое их затирает
// (открытие проекта/заказа, новый комплект). Выбрал «Сохранить» → открывается обычная модалка
// сохранения, а само действие выполняется после успешного «Сохранить» в ней (см. orderSubmit);
// закрыл модалку без сохранения — действие отменяется.
let pendingAfterSave = null;

async function guardUnsavedItems(discardLabel, proceed) {
  const dirtyItems = orderItems.length > 0 && !itemsSavedToProject;
  // Правки текущей 3D-прорисовки, не добавленные в комплект — в т.ч. правка открытого проекта
  // БЕЗ кнопки «Изменить» и прорисовка «с нуля», которую вообще ни разу не сохраняли — тоже
  // несохранённая работа (задание «сохранение заказа 21,07», часть 2): при сохранении она
  // добавляется в комплект как новая прорисовка.
  const dirtyState = hasUnsavedChanges();
  if (!dirtyItems && !dirtyState) { proceed(); return; }
  const choice = await showChoiceDialog(
    'Текущая прорисовка не сохранена.',
    [
      { label: 'Отмена', value: null },
      { label: discardLabel, value: 'discard' },
      { label: 'Сохранить в проект', value: 'project', primary: true },
      { label: 'Сохранить в заказ', value: 'order' },
    ],
  );
  if (choice === 'discard') { proceed(); return; }
  if (choice === 'project' || choice === 'order') {
    if (dirtyState) addCurrentToOrder(); // текущая работа — в комплект как новая прорисовка
    renderOrderCards();
    pendingAfterSave = proceed;
    openSaveModal(choice);
  }
}

// Открыть сохранённый комплект из вкладки «Проекты». Если в «Прорисовках» лежит несохранённый
// комплект — предложение сохранить (не просто предупреждение о потере).
export function openProject(project) {
  guardUnsavedItems('Открыть без сохранения', () => doOpenProject(project));
}

function doOpenProject(project) {
  editingProjectId = project.id;
  editingProjectClient = {
    name: project.client_name || '', phone: project.client_phone || '', address: project.client_address || '',
  };
  editingProjectTitle = project.title || '';
  editingProjectKind = project.kind || 'project';
  editingProjectCode = project.project_code || '';
  orderItems = (project.items || []).map(it => ({ ...it, id: it.id || Date.now() + Math.random() }));
  itemsSavedToProject = true;
  editingItemId = null;
  renderOrderCards();
  // первую прорисовку с 3D сразу показываем на модели
  const first = orderItems.find(it => it.snapshot);
  if (first) {
    Object.assign(state, JSON.parse(JSON.stringify(first.snapshot)));
    syncUIFromState();
    ['korpus', 'fasad', 'fill'].forEach(g => {
      document.getElementById(g + 'Producer').value = state[g + 'Producer'];
      renderSwatches(g, g + 'Swatches');
    });
    buildFurniture();
    resetHistory(); // другой проект — не откатываться в историю прежнего (см. history.js)
  }
  // Свежая точка отсчёта несохранённых правок ВСЕГДА (не только при наличии снапшота): иначе
  // после открытия пустого проекта guard считал бы «грязными» правки, сделанные ещё до открытия.
  markStateSafe();
  document.querySelector('[data-tab="order"]').click();
  showToast(`Проект${project.project_code ? ' № ' + project.project_code : ''} открыт — комплект в «Прорисовках».`);
}

function updateEditingProjectNote() {
  const note = document.getElementById('editingProjectNote');
  if (!note) return;
  if (editingProjectId !== null) {
    const c = editingProjectClient?.name ? ` (${editingProjectClient.name})` : '';
    note.textContent = `Открыт сохранённый проект${c} — «Сохранить в проект» обновит его же.`;
    note.style.display = 'block';
  } else {
    note.style.display = 'none';
  }
}

export function renderOrderCards() {
  const list    = document.getElementById('orderCardsList');
  const empty   = document.getElementById('orderEmptyNote');
  const grandRow = document.getElementById('orderGrandRow');
  const grandEl  = document.getElementById('orderGrandTotal');
  const badge    = document.getElementById('orderBadge');
  const counter  = document.getElementById('orderCounterRow');
  const counterTxt = document.getElementById('orderCounterText');

  list.innerHTML = '';
  updateEditingProjectNote();
  updateKitBar();

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
      ${item.kind === 'extra' ? '' : `
      <button class="order-card-edit ${isEditing ? 'editing' : ''}" data-id="${item.id}">
        ${isEditing ? '✏️ Редактируется сейчас...' : 'Изменить'}
      </button>`}
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.order-card-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const item = orderItems.find(it => it.id === id);
      if (!window.confirm(`Удалить «${(item?.label || '').slice(0, 60)}…»?`)) return;
      orderItems = orderItems.filter(it => it.id !== id);
      itemsSavedToProject = false;
      if (editingItemId === id) {
        editingItemId = null;
        document.getElementById('addItemBtn').textContent = '+ Добавить в прорисовки';
      }
      renderOrderCards();
    });
  });

  list.querySelectorAll('.order-card-edit').forEach(btn => {
    btn.addEventListener('click', () => loadItemForEdit(Number(btn.dataset.id)));
  });

  grandEl.textContent = fmt(grand);
  counterTxt.textContent = `Прорисовок: ${orderItems.length} • ${fmt(grand)}`;
}

export function orderSummaryFull() {
  if (orderItems.length === 0) return describeConfig();
  const lines = orderItems.map((it, i) => `${i + 1}. ${it.label}`);
  const grand = orderItems.reduce((s, it) => s + it.total, 0);
  return lines.join('\n') + `\n\nИтого по комплекту: ${fmt(grand)}`;
}

// Сброс рабочего комплекта — начать с чистого листа (новый клиент/новый проект).
export function startNewKit() {
  guardUnsavedItems('Не сохранять', doStartNewKit);
}

function doStartNewKit() {
  orderItems = [];
  editingItemId = null;
  editingProjectId = null;
  editingProjectClient = null;
  editingProjectTitle = '';
  editingProjectKind = 'project';
  editingProjectCode = '';
  itemsSavedToProject = false;
  document.getElementById('addItemBtn').textContent = '+ Добавить в прорисовки';
  renderOrderCards();
  markStateSafe(); // новая точка отсчёта — текущее 3D остаётся, но «грязным» больше не считается
  showToast('Новый комплект — прорисовки очищены.');
}

// Маленькая превьюшка текущего вида 3D-модели (задание «Проекты» — большое окно с превью,
// сессия 37) — сохраняется вместе со строкой проекта, показывается в списке без загрузки
// самого снапшота. Форсируем свежий рендер прямо перед снятием кадра — WebGL-канвас без
// preserveDrawingBuffer не гарантирует, что в буфере лежит валидная картинка к моменту клика
// (тот приходит асинхронно относительно цикла рендера в scene.js). Даунскейлим через offscreen-
// канвас — веса не для полноразмерного скриншота, а для строки в базе (единицы КБ).
function captureThumbnail() {
  try {
    renderer.render(scene, camera);
    const src = renderer.domElement;
    if (!src.width || !src.height) return null;
    // 100px/качество 0.5 — список может разрастись до сотен проектов (см. пагинация в
    // projects.js), суммарный вес важнее детализации превью.
    const w = 100, h = Math.max(1, Math.round(w * src.height / src.width));
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    off.getContext('2d').drawImage(src, 0, 0, w, h);
    return off.toDataURL('image/jpeg', 0.5);
  } catch {
    return null; // не критично — проект всё равно сохранится, просто без картинки
  }
}

function openSaveModal(kind) {
  modalKind = kind;
  const overlay = document.getElementById('orderOverlay');
  document.getElementById('orderModalTitle').textContent =
    kind === 'order' ? 'Добавить в заказ' : 'Сохранить в проект';
  document.getElementById('orderAddressField').style.display = kind === 'order' ? 'block' : 'none';
  // Если открыт сохранённый комплект — даём выбор: обновить его или сохранить как новый
  document.getElementById('saveAsNewField').style.display = editingProjectId !== null ? 'block' : 'none';
  document.getElementById('saveAsNew').checked = false;
  document.getElementById('orderSummary').textContent = orderSummaryFull();
  document.getElementById('orderResult').textContent = '';
  document.getElementById('orderTitle').value   = editingProjectTitle || '';
  document.getElementById('orderName').value    = editingProjectClient?.name    || '';
  document.getElementById('orderPhone').value   = editingProjectClient?.phone   || '';
  document.getElementById('orderAddress').value = editingProjectClient?.address || '';
  overlay.classList.add('visible');
}

export function bindOrderForm() {
  const overlay = document.getElementById('orderOverlay');
  document.getElementById('saveProjectBtn').addEventListener('click', () => openSaveModal('project'));
  document.getElementById('saveOrderBtn').addEventListener('click', () => openSaveModal('order'));
  document.getElementById('newKitBtn').addEventListener('click', startNewKit);
  document.getElementById('newKitTopBtn').addEventListener('click', startNewKit);
  // Закрытие модалки без сохранения отменяет и отложенное действие (см. guardUnsavedItems) —
  // прорисовки не сохранены, затирать их молча нельзя.
  document.getElementById('orderCancel').addEventListener('click', () => {
    pendingAfterSave = null;
    overlay.classList.remove('visible');
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) { pendingAfterSave = null; overlay.classList.remove('visible'); }
  });

  document.getElementById('orderSubmit').addEventListener('click', async () => {
    const title   = document.getElementById('orderTitle').value.trim();
    const name    = document.getElementById('orderName').value.trim();
    const phone   = document.getElementById('orderPhone').value.trim();
    const address = document.getElementById('orderAddress').value.trim();
    const result = document.getElementById('orderResult');
    if (!name)  { result.style.color = 'red'; result.textContent = 'Укажите имя';     return; }
    if (!phone) { result.style.color = 'red'; result.textContent = 'Укажите телефон'; return; }
    if (modalKind === 'order' && !address) {
      result.style.color = 'red'; result.textContent = 'Для заказа укажите адрес'; return;
    }
    if (modalKind === 'order' && !title) {
      result.style.color = 'red'; result.textContent = 'Для заказа укажите название'; return;
    }
    if (!auth.session) {
      result.style.color = 'red';
      result.textContent = 'Сохранение недоступно без входа.';
      return;
    }

    result.style.color = '#555';
    result.textContent = 'Сохранение...';

    // Комплект: текущие прорисовки (если пусто — текущая открытая модель одной прорисовкой)
    const items = orderItems.length ? orderItems
      : [{ id: Date.now(), label: describeConfig(), total: state.lastTotal || 0, snapshot: JSON.parse(JSON.stringify(state)) }];
    const total = items.reduce((s, it) => s + it.total, 0);
    const row = {
      kind: modalKind,
      title,
      client_name: name, client_phone: phone, client_address: address,
      items: items.map(({ id, ...rest }) => rest), // локальные id не сохраняем
      total,
      item_count: items.length,
      thumbnail: captureThumbnail(),
      updated_at: new Date().toISOString(),
    };

    const saveAsNew = document.getElementById('saveAsNew').checked;
    let error;
    if (editingProjectId !== null && !saveAsNew) {
      ({ error } = await supabase.from('projects').update(row).eq('id', editingProjectId));
    } else {
      let data;
      ({ data, error } = await supabase.from('projects')
        .insert({ ...row, user_id: auth.session.user.id })
        .select('id, project_code').single());
      if (!error && data) {
        editingProjectId = data.id; // повторное сохранение обновит эту же строку
        editingProjectCode = data.project_code || '';
      }
    }

    if (error) {
      console.error('projects save failed:', error);
      result.style.color = 'red';
      result.textContent = 'Ошибка сохранения: ' + error.message;
      return;
    }

    editingProjectClient = { name, phone, address };
    editingProjectTitle = title;
    editingProjectKind = modalKind;
    itemsSavedToProject = true;
    result.style.color = 'green';
    result.textContent = modalKind === 'order' ? 'Заказ сохранён.' : 'Проект сохранён.';
    markStateSafe();
    renderOrderCards();
    // обновить список на вкладке «Проекты» (projects.js слушает; прямой импорт дал бы цикл)
    window.dispatchEvent(new CustomEvent('projects-changed'));
    setTimeout(() => {
      overlay.classList.remove('visible');
      // Сохранение было шагом перед другим действием (открытие проекта/новый комплект,
      // см. guardUnsavedItems) — теперь прорисовки в безопасности, выполняем его.
      if (pendingAfterSave) {
        const go = pendingAfterSave;
        pendingAfterSave = null;
        go();
      }
    }, 1200);
  });
}
