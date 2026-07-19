let toastTimer = null;

export function showToast(message) {
  let el = document.getElementById('appToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'appToast';
    el.className = 'app-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// Диалог с несколькими вариантами (не просто да/нет) — задание «ящики-двери 19,07», второй раунд:
// предупреждение о ящике за раздвижными дверями получило третий вариант («сузить и поставить»)
// сверх «отмена»/«поставить как есть», а нативный confirm() умеет только два. options —
// [{label, value, primary?}], клик мимо диалога или Escape — как null (эквивалент отмены).
// Возвращает Promise<value>.
export function showChoiceDialog(message, options) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'choice-dialog-overlay';
    const box = document.createElement('div');
    box.className = 'choice-dialog-box';
    const text = document.createElement('div');
    text.className = 'choice-dialog-text';
    text.textContent = message;
    box.appendChild(text);
    const btnRow = document.createElement('div');
    btnRow.className = 'choice-dialog-buttons';
    function close(value) {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve(value);
    }
    function onKeydown(e) { if (e.key === 'Escape') close(null); }
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'opt-btn' + (opt.primary ? ' btn-primary' : '');
      btn.textContent = opt.label;
      btn.addEventListener('click', () => close(opt.value));
      btnRow.appendChild(btn);
    });
    box.appendChild(btnRow);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);
  });
}
