// Защита числовых полей от менеджера паролей браузера (иконка-«ключик» автозаполнения в
// Яндекс.Браузере/Chrome, когда для сайта сохранён пароль): autocomplete="off" такие браузеры
// игнорируют, менеджер эвристически цепляется к произвольным полям (замечено на полях ширины
// секций — иконка перехватывала первый клик, курсор не вставал; проявлялось хаотично, т.к.
// карточки часто перерисовываются и менеджер пересканирует DOM).
//
// Приём: держать числовые поля readonly, пока пользователь реально не взаимодействует с полем —
// readonly-поля менеджеры автозаполнения пропускают. Снимаем readonly на pointerdown (фаза
// capture, ДО того как браузер ставит фокус — клик сразу ставит курсор) и на focusin (для
// перехода по Tab), возвращаем на focusout. Новые поля из перерисовок (renderSectionsList и
// т.п.) подхватывает MutationObserver — не нужно трогать каждый шаблон.
const SEL = 'input[type="number"]';

function guardAll(root) {
  root.querySelectorAll(SEL).forEach(inp => {
    if (document.activeElement !== inp) inp.readOnly = true;
  });
}

export function initAutofillGuard() {
  guardAll(document);

  new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.matches?.(SEL) && document.activeElement !== n) n.readOnly = true;
      if (n.querySelectorAll) guardAll(n);
    }));
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('pointerdown', e => {
    const t = e.target.closest?.(SEL);
    if (t) t.readOnly = false;
  }, true);
  document.addEventListener('focusin', e => {
    const t = e.target.closest?.(SEL);
    if (t) t.readOnly = false;
  });
  document.addEventListener('focusout', e => {
    const t = e.target.closest?.(SEL);
    if (t) t.readOnly = true;
  });
}
