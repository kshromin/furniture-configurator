import { fmt } from './pricing.js';
import { supabase } from './supabaseClient.js';
import { showToast } from './toast.js';

const STATUSES = [
  ['new', 'Новая'],
  ['confirmed', 'Подтверждена'],
  ['production', 'В производстве'],
  ['done', 'Готово'],
];

export async function renderAdminOrders() {
  const empty = document.getElementById('adminOrdersEmpty');
  const table = document.getElementById('adminOrdersTable');
  const body  = document.getElementById('adminOrdersBody');

  const { data, error } = await supabase
    .from('orders')
    .select('*, profiles(email)')
    .order('created_at', { ascending: false });

  body.innerHTML = '';
  if (error || !data || data.length === 0) {
    empty.style.display = 'block';
    table.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  table.style.display = 'table';

  data.forEach(order => {
    const tr = document.createElement('tr');
    const date = new Date(order.created_at).toLocaleString('ru-RU');
    const options = STATUSES.map(([val, label]) =>
      `<option value="${val}" ${order.status === val ? 'selected' : ''}>${label}</option>`).join('');
    tr.innerHTML = `
      <td>${date}</td>
      <td>${order.profiles?.email || '—'}<br><span class="admin-contact">${order.contact_name || ''} · ${order.contact_phone || ''}</span></td>
      <td>${order.summary.replace(/\n/g, '<br>')}</td>
      <td>${fmt(order.total)}</td>
      <td><select class="mini-select mini-select-wide" data-id="${order.id}">${options}</select></td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const { error } = await supabase.from('orders')
        .update({ status: sel.value })
        .eq('id', Number(sel.dataset.id));
      if (error) { showToast('Не удалось обновить статус'); return; }
      showToast('Статус обновлён');
    });
  });
}
