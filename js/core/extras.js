import { materials } from './state.js';
import { fmt } from './pricing.js';
import { addExtraItem } from './order.js';

// Вкладка «Добавить к заказу» — доп. элементы и услуги (доставка, подъём, монтаж, индивидуальные
// детали). Не рисуются в 3D, только попадают в проект строкой с ценой. Каталог — materials.extras.
//
// Три уровня выбора (решение пользователя 7.08):
//   1) ВИД      — услуги или доп. элементы (extras[].kind, проставляется загрузкой каталога);
//   2) КАТЕГОРИЯ — группа внутри вида: у услуг «Доставка/Монтаж/Подъём», у доп. элементов
//      «Ручки/Ножки/Корзины…» (в выгрузке это колонка «От чего зависит»);
//   3) НАИМЕНОВАНИЕ — сама позиция.
// Плюс необязательный фильтр по производителю: показывается, ТОЛЬКО если у позиций категории
// он заполнен (пока каталог без производителей — поля нет и оно не мешает).
// Цены нигде не показываем — они видны только в спецификации.

const $ = id => document.getElementById(id);
const KINDS = [['extra', 'Доп. элементы'], ['service', 'Услуги']];

const groupKind = g => g.kind || 'extra';
const producerOf = it => String(it.producer || '').trim();

function groupsOfKind(kind) {
  return (materials.extras || []).filter(g => groupKind(g) === kind);
}

function currentCategory() {
  const kind = $('extraKind').value;
  const groups = groupsOfKind(kind);
  return groups.find(g => g.id === $('extraCategory').value) || groups[0] || null;
}

function itemsOfCategory() {
  const cat = currentCategory();
  if (!cat) return [];
  const prod = $('extraProducer').value;
  const items = cat.items || [];
  return prod ? items.filter(i => producerOf(i) === prod) : items;
}

function currentItem() {
  return itemsOfCategory().find(i => i.id === $('extraItem').value) || null;
}

function fill(sel, options, keep) {
  const prev = keep && options.some(o => o.value === sel.value) ? sel.value : (options[0]?.value ?? '');
  sel.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  sel.value = prev;
}

function renderKinds() {
  fill($('extraKind'), KINDS.filter(([k]) => groupsOfKind(k).length).map(([k, label]) => ({ value: k, label })), true);
  renderCategories();
}

function renderCategories() {
  const groups = groupsOfKind($('extraKind').value);
  fill($('extraCategory'), groups.map(g => ({ value: g.id, label: g.name })), true);
  renderProducers();
}

// Производитель — необязательный фильтр: поле показывается, только когда в категории реально
// есть заполненные производители (пользователь заполнит колонку — фильтр появится сам).
function renderProducers() {
  const cat = currentCategory();
  const list = [...new Set((cat?.items || []).map(producerOf).filter(Boolean))].sort();
  const field = $('extraProducerField');
  const sel = $('extraProducer');
  field.style.display = list.length ? '' : 'none';
  fill(sel, [{ value: '', label: 'Все' }, ...list.map(p => ({ value: p, label: p }))], true);
  if (!list.length) sel.value = '';
  renderItems();
}

function renderItems() {
  fill($('extraItem'), itemsOfCategory().map(i => ({ value: i.id, label: i.name })), true);
  updatePriceRow();
}

function updatePriceRow() {
  const item = currentItem();
  const manual = !!item?.manual; // «заказная» позиция — цену и имя вводит пользователь
  $('extraManualFields').style.display = manual ? '' : 'none';
  const qty = Math.max(1, Number($('extraQty').value) || 1);
  const price = manual ? (Number($('extraManualPrice').value) || 0) : (item ? item.price : 0);
  $('extraPrice').textContent = fmt(price * qty);   // скрытый элемент: цена нужна кнопке, не глазам
}

export function renderExtras() {
  renderKinds();
}

export function bindExtras() {
  $('extraKind').addEventListener('change', renderCategories);
  $('extraCategory').addEventListener('change', renderProducers);
  $('extraProducer').addEventListener('change', renderItems);
  $('extraItem').addEventListener('change', updatePriceRow);
  $('extraQty').addEventListener('input', updatePriceRow);
  $('extraManualPrice').addEventListener('input', updatePriceRow);

  $('extraAddBtn').addEventListener('click', () => {
    const item = currentItem();
    if (!item) return;
    const qty = Math.max(1, Number($('extraQty').value) || 1);
    const result = $('extraResult');
    let name = item.name, price = item.price;
    if (item.manual) { // «заказная» позиция — берём название и цену из полей
      name = $('extraManualName').value.trim();
      price = Number($('extraManualPrice').value) || 0;
      if (!name) { result.textContent = 'Укажите название заказной позиции'; return; }
      if (price <= 0) { result.textContent = 'Укажите цену (больше 0)'; return; }
    }
    addExtraItem(name, price * qty, qty, price); // чистое имя + кол-во/цена отдельно (в свои столбцы)

    result.textContent = `Добавлено: ${name}${qty > 1 ? ' × ' + qty : ''}`;
    setTimeout(() => { result.textContent = ''; }, 3000);
    $('extraQty').value = 1;
    if (item.manual) { $('extraManualName').value = ''; $('extraManualPrice').value = 0; }
    updatePriceRow();
  });
}
