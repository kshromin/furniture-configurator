import { materials } from './state.js';
import { fmt } from './pricing.js';
import { addExtraItem } from './order.js';

// Вкладка «Добавить к заказу» — доп. элементы и услуги (доставка, подъём, монтаж, индивидуальные
// детали). Не рисуются в 3D, только попадают в проект строкой с ценой. Каталог — materials.extras.

function currentCategory() {
  const catId = document.getElementById('extraCategory').value;
  return (materials.extras || []).find(c => c.id === catId);
}

function currentItem() {
  const cat = currentCategory();
  const itemId = document.getElementById('extraItem').value;
  return cat?.items.find(i => i.id === itemId);
}

function renderItems() {
  const cat = currentCategory();
  const sel = document.getElementById('extraItem');
  sel.innerHTML = '';
  (cat?.items || []).forEach(i => {
    const opt = document.createElement('option');
    opt.value = i.id;
    opt.textContent = `${i.name} — ${fmt(i.price)}`;
    sel.appendChild(opt);
  });
  updatePriceRow();
}

function updatePriceRow() {
  const item = currentItem();
  const qty = Math.max(1, Number(document.getElementById('extraQty').value) || 1);
  document.getElementById('extraPrice').textContent = item ? fmt(item.price * qty) : '0 ₽';
}

export function renderExtras() {
  const catSel = document.getElementById('extraCategory');
  catSel.innerHTML = '';
  (materials.extras || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    catSel.appendChild(opt);
  });
  renderItems();
}

export function bindExtras() {
  document.getElementById('extraCategory').addEventListener('change', renderItems);
  document.getElementById('extraItem').addEventListener('change', updatePriceRow);
  document.getElementById('extraQty').addEventListener('input', updatePriceRow);

  document.getElementById('extraAddBtn').addEventListener('click', () => {
    const item = currentItem();
    if (!item) return;
    const qty = Math.max(1, Number(document.getElementById('extraQty').value) || 1);
    const label = qty > 1 ? `${item.name} × ${qty}` : item.name;
    addExtraItem(label, item.price * qty);

    const result = document.getElementById('extraResult');
    result.textContent = `Добавлено: ${label} — ${fmt(item.price * qty)}`;
    setTimeout(() => { result.textContent = ''; }, 3000);
    document.getElementById('extraQty').value = 1;
    updatePriceRow();
  });
}
