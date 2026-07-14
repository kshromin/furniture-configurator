import { fmt } from './pricing.js';
import { supabase } from './supabaseClient.js';
import { auth } from './auth.js';
import { openProject } from './order.js';

// Вкладка «Проекты» — сохранённые комплекты прорисовок (таблица projects, одна строка =
// один комплект с клиентом; kind: project | order). «Открыть» загружает комплект в
// «Прорисовки» (с предупреждением, если там несохранённое — см. order.js openProject).

const KIND_LABELS = { project: 'Проект', order: 'Заказ' };

export async function renderProjects() {
  const list  = document.getElementById('projectsList');
  const empty = document.getElementById('projectsEmpty');
  if (!auth.session) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = 'Проекты недоступны без входа.';
    return;
  }

  const filter = document.getElementById('projectsFilterSelect').value;
  const sortByClient = document.getElementById('projectsSortSelect').value === 'client';

  let q = supabase.from('projects').select('*').eq('user_id', auth.session.user.id);
  if (filter !== 'all') q = q.eq('kind', filter);
  const { data, error } = await q.order(sortByClient ? 'client_name' : 'created_at', { ascending: sortByClient });

  list.innerHTML = '';
  if (error) {
    empty.style.display = 'block';
    empty.textContent = 'Ошибка загрузки: ' + error.message;
    return;
  }
  if (!data || data.length === 0) {
    empty.style.display = 'block';
    empty.textContent = 'Сохранённых проектов пока нет.';
    return;
  }
  empty.style.display = 'none';

  data.forEach(p => {
    const date = new Date(p.created_at).toLocaleDateString('ru-RU');
    const client = [p.client_name, p.client_phone].filter(Boolean).join(', ') || 'Без клиента';
    const n = (p.items || []).length;
    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-card-num">${p.project_code ? `№ ${p.project_code} · ` : ''}${date}</span>
        <span class="order-card-name"><b>${client}</b><br>Прорисовок: ${n}</span>
        <button class="order-card-remove" data-id="${p.id}" title="Удалить">×</button>
      </div>
      <div class="order-card-price">${fmt(p.total)}</div>
      <span class="status-pill status-${p.kind === 'order' ? 'confirmed' : 'new'}">${KIND_LABELS[p.kind] || p.kind}</span>
      <button class="order-card-edit" data-id="${p.id}">Открыть</button>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.order-card-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = data.find(x => x.id === Number(btn.dataset.id));
      const who = p ? ([p.client_name, p.project_code && '№ ' + p.project_code].filter(Boolean).join(', ') || 'без клиента') : '';
      if (!window.confirm(`Удалить ${p?.kind === 'order' ? 'заказ' : 'проект'} (${who})? Действие необратимо.`)) return;
      await supabase.from('projects').delete().eq('id', Number(btn.dataset.id));
      renderProjects();
    });
  });

  list.querySelectorAll('.order-card-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = data.find(x => x.id === Number(btn.dataset.id));
      if (p) openProject(p);
    });
  });
}

export function bindProjectsControls() {
  document.getElementById('projectsFilterSelect').addEventListener('change', renderProjects);
  document.getElementById('projectsSortSelect').addEventListener('change', renderProjects);
  window.addEventListener('projects-changed', renderProjects);
}
