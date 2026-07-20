import { signOut } from './auth.js';
import { renderOrders } from './projects.js';

// Кабинет = большое окно «Заказы» (сессия 38) — то же решение, что и у «Проекты»
// (js/core/projects.js): вместо узкой вкладки в сайдбаре, модал поверх текущей вкладки, тот же
// .projects-modal-* CSS. Список заказов — renderOrders() из projects.js (kind='order').
//
// Старые блоки кабинета удалены как устаревшая логика сохранения:
// - «Мои заказы» (таблица orders, заявки с формы) — убраны ещё в сессии 38;
// - «Мои сохранённые конфигурации» (таблица saved_configs, личные снапшоты одной конфигурации)
//   — убраны в сессии 39, вытеснены моделью Прорисовки → Проекты/Заказы (таблица projects).
// Сами таблицы в Supabase и админ-панель не тронуты (архив).
export function openCabinetModal() {
  document.getElementById('cabinetModalOverlay').classList.add('visible');
  renderOrders();
}
export function closeCabinetModal() {
  document.getElementById('cabinetModalOverlay').classList.remove('visible');
}

export function bindCabinetControls() {
  document.getElementById('logoutBtn').addEventListener('click', () => signOut());

  const overlay = document.getElementById('cabinetModalOverlay');
  document.getElementById('cabinetModalClose').addEventListener('click', closeCabinetModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeCabinetModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) closeCabinetModal();
  });
}
