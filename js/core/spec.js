import { getPrintData } from './order.js';

// Спецификация заказа в Excel (.xlsx) — кнопка «Выгрузить спецификацию» на вкладке «Прорисовки»
// (план «первым делом», Этап 4). Пока КЛИЕНТСКИЙ вид: шапка (заказ/проект, клиент, дата) + таблица
// позиций (№ · наименование · цена) + итого. Данные — из getPrintData() (те же, что печать сметы).
// Разбивка по компонентам (2-й вид, для проверки расчёта) — следующий шаг.
// SheetJS грузим лениво (import 'xlsx' по клику) — при обычной работе не тянем библиотеку.

export function bindSpecExport() {
  const btn = document.getElementById('specBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const d = getPrintData();
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Готовим…';
    try {
      const XLSX = await import('xlsx');
      const kindLabel = d.kind === 'order' ? 'Заказ' : 'Проект';
      const aoa = [];
      aoa.push([`Спецификация — ${kindLabel}${d.code ? ' № ' + d.code : ''}`]);
      aoa.push([new Date().toLocaleDateString('ru-RU')]);
      if (d.title) aoa.push(['Название', d.title]);
      if (d.client) {
        aoa.push(['Клиент', d.client.name || '']);
        if (d.client.phone) aoa.push(['Телефон', d.client.phone]);
        if (d.client.address) aoa.push(['Адрес', d.client.address]);
      }
      aoa.push([]);
      aoa.push(['№', 'Наименование', 'Цена, ₽']);
      d.items.forEach((it, i) => aoa.push([i + 1, it.label, it.total]));
      aoa.push([]);
      aoa.push(['', 'Итого', d.grandTotal]);

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 5 }, { wch: 72 }, { wch: 14 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Спецификация');

      // 2-й лист — разбивка по категориям (для проверки расчёта). Суммы = те же, что в панели
      // цены приложения. У позиций, сохранённых до появления разбивки, ячейки пустые.
      const CATS = [['korpus', 'Корпус'], ['fasad', 'Фасады'], ['fill', 'Наполнение'],
        ['backWall', 'Задняя стенка'], ['fittings', 'Фурнитура'],
        ['swingHw', 'Фурн. распашных'], ['kromka', 'Кромка']];
      const bd = [['№', 'Наименование', ...CATS.map(c => c[1]), 'Итого']];
      d.items.forEach((it, i) => {
        const b = it.breakdown;
        bd.push([i + 1, it.label, ...CATS.map(c => (b ? Math.round(b[c[0]] || 0) : '')), it.total]);
      });
      const wsB = XLSX.utils.aoa_to_sheet(bd);
      wsB['!cols'] = [{ wch: 5 }, { wch: 50 }, ...CATS.map(() => ({ wch: 13 })), { wch: 13 }];
      XLSX.utils.book_append_sheet(wb, wsB, 'Разбивка');
      const base = d.code || d.client?.name || 'спецификация';
      XLSX.writeFile(wb, `Спецификация_${base}.xlsx`);
    } catch (e) {
      console.error('spec export failed:', e);
      window.alert('Не удалось сформировать спецификацию: ' + (e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  });
}
