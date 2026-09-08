(function () {
  'use strict';

  const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';

  async function loadTaste() {
    try {
      const res = await fetch(API + '/api/taste', { credentials: 'include' });
      if (!res.ok) return null;
      return (await res.json()).taste;
    } catch (_) {
      return null;
    }
  }

  async function saveTaste(patch) {
    const res = await fetch(API + '/api/taste', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('Could not save your taste right now.');
    return (await res.json()).taste;
  }

  function escapeText(value) {
    const node = document.createElement('div');
    node.textContent = value == null ? '' : String(value);
    return node.innerHTML;
  }

  // Chip/tag editor. opts: { items, placeholder, label, list, max, onChange }
  function tagEditor(container, opts) {
    opts = opts || {};
    const state = { items: (opts.items || []).slice() };
    container.classList.add('tag-editor');
    container.innerHTML =
      '<div class="tag-list" role="list"></div>' +
      '<input class="tag-input" type="text" autocomplete="off" maxlength="80"' +
      ' placeholder="' + escapeText(opts.placeholder || 'Type a name, press Enter') + '"' +
      (opts.list ? ' list="' + escapeText(opts.list) + '"' : '') +
      ' aria-label="' + escapeText(opts.label || 'Add item') + '">';

    const list = container.querySelector('.tag-list');
    const input = container.querySelector('.tag-input');

    function emit() { if (opts.onChange) opts.onChange(state.items.slice()); }

    function render() {
      list.innerHTML = state.items.map(function (item, index) {
        return '<span class="tag" role="listitem">' + escapeText(item) +
          '<button type="button" data-index="' + index + '" aria-label="Remove ' + escapeText(item) + '">×</button></span>';
      }).join('');
    }

    function add(value) {
      const clean = String(value || '').trim().toLowerCase();
      if (!clean || state.items.indexOf(clean) !== -1) return;
      if (opts.max && state.items.length >= opts.max) return;
      state.items.push(clean);
      render();
      emit();
    }

    function removeAt(index) {
      state.items.splice(index, 1);
      render();
      emit();
    }

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        add(input.value);
        input.value = '';
      } else if (event.key === 'Backspace' && !input.value && state.items.length) {
        removeAt(state.items.length - 1);
      }
    });
    input.addEventListener('blur', function () {
      if (input.value.trim()) { add(input.value); input.value = ''; }
    });
    list.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-index]');
      if (button) removeAt(Number(button.dataset.index));
    });

    render();
    return {
      get items() { return state.items.slice(); },
      set: function (items) { state.items = (items || []).slice(); render(); },
      focus: function () { input.focus(); },
    };
  }

  window.QuaverTaste = { load: loadTaste, save: saveTaste, tagEditor: tagEditor };
}());
