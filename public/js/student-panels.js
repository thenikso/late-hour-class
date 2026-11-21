// The pop-up panels on the student page: hats, the questions board ("Ask")
// and the trophy shelf.

import { $, h, bump, sound, toast } from './common.js';
import { avatarCanvas, iconCanvas, trophyCanvas } from './sprites.js';
import { HATS, hatUnlocked, hatHint } from './shared/fun.js';

export function createPanels({ send }) {
  let state = null;
  const allModals = [];

  /** Wire a button to open a modal panel, a close button, and backdrop clicks. */
  function panel(id, onOpen) {
    const el = $(`#${id}`);
    allModals.push(el);
    $(`#${id}-open`).onclick = (e) => {
      el.hidden = false;
      onOpen();
      e.currentTarget.blur(); // so Space hops again instead of pressing the button
    };
    $(`#${id}-close`).onclick = () => {
      el.hidden = true;
    };
    el.addEventListener('click', (e) => {
      if (e.target === el) el.hidden = true;
    });
    return el;
  }

  function closeAll() {
    for (const el of allModals) el.hidden = true;
  }

  // ---- hats: unlocked by points over the term, or by improving an answer ----------------

  const hats = panel('hats', renderHats);
  let knownHats = null; // hat ids already unlocked, to announce new ones once

  function renderHats() {
    if (hats.hidden || !state) return;
    const me = state.me;
    const grid = $('#hat-grid');
    grid.innerHTML = '';
    const wear = (id) => send('hat', { hat: id }).catch((e) => toast(e.message));
    grid.append(
      h(
        'button',
        { type: 'button', 'aria-pressed': String(!me.hat), onclick: () => wear('') },
        avatarCanvas(me.avatar, 3, { reserveHat: true }),
        'No hat',
      ),
    );
    for (const hat of HATS) {
      const open = hatUnlocked(hat, me.term);
      grid.append(
        h(
          'button',
          { type: 'button', disabled: !open, 'aria-pressed': String(me.hat === hat.id), onclick: () => wear(hat.id) },
          avatarCanvas(me.avatar, 3, { hat: hat.id, reserveHat: true }),
          hat.name,
          open ? null : h('span', { class: 'hint' }, hatHint(hat)),
        ),
      );
    }
    $('#hat-total').textContent = `You have ${me.term.points} points so far this term.`;
  }

  function announceNewHats() {
    const open = HATS.filter((hat) => hatUnlocked(hat, state.me.term));
    const fresh = knownHats ? open.filter((hat) => !knownHats.includes(hat.id)) : [];
    for (const hat of fresh) {
      toast(`New hat: ${hat.name}! Open Hats to wear it.`, { icon: iconCanvas('hat', hat.id, 2) });
    }
    if (fresh.length) {
      sound.tune('hat');
      bump($('#hats-open'));
    }
    knownHats = open.map((hat) => hat.id);
  }

  // ---- the questions board ------------------------------------------------------------------

  const asks = panel('asks', () => {
    renderAsks();
    $('#ask-text').focus();
  });

  function openAsks() {
    asks.hidden = false;
    renderAsks();
    $('#ask-text').focus();
  }

  $('#ask-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#ask-text');
    const note = $('#ask-note');
    try {
      const r = await send('ask', { text: input.value });
      input.value = '';
      note.className = 'ok';
      note.textContent = r.status === 'posted' ? 'On the board.' : 'Sent to the teacher.';
    } catch (err) {
      note.className = 'err';
      note.textContent = err.message;
    }
  };

  function renderAsks() {
    const list = state?.asks || [];
    $('#asks-open').textContent = list.length ? `Ask (${list.length})` : 'Ask';
    if (asks.hidden) return;
    const ul = $('#ask-list');
    ul.innerHTML = '';
    if (!list.length) ul.append(h('li', { class: 'quiet' }, 'No questions yet. Be the first.'));
    for (const it of list) {
      const held = it.status === 'held';
      const vote = h(
        'button',
        {
          class: `btn small ${it.voted ? 'on' : ''}`,
          type: 'button',
          disabled: it.mine,
          title: it.mine ? 'Your question' : 'I was wondering that too',
          onclick: () => send('vote', { id: it.id }).catch(() => {}),
        },
        `▲ ${it.votes}`,
      );
      ul.append(
        h(
          'li',
          {},
          held ? h('span', { class: 'chip info' }, 'with the teacher') : vote,
          h('span', { class: 'grow' }, it.slide ? h('span', { class: 'chip info' }, `s${it.slide}`) : '', it.text),
          h('span', { class: 'quiet small' }, it.mine ? 'you' : it.name),
        ),
      );
    }
  }

  // ---- trophies: what the class has learned so far ----------------------------------------------

  const trophies = panel('trophies', () => renderTrophies([]));

  /** The list of trophy cards; `focus` is the slot index (or list of indices) the student walked under. */
  function renderTrophies(focus) {
    const focused = new Set(Array.isArray(focus) ? focus : focus >= 0 ? [focus] : []);
    const scrollTarget = Array.isArray(focus) ? focus.at(-1) : focus;
    const list = state?.trophies || [];
    const box = $('#trophy-list');
    box.innerHTML = '';
    list.forEach((t, i) => {
      const card = h(
        'div',
        { class: `trophy ${focused.has(i) ? 'focus' : ''}` },
        trophyCanvas(t.sprite, 3),
        h(
          'div',
          {},
          h('b', {}, t.name),
          h('span', { class: 'quiet small' }, ` · ${t.lesson}`),
          h('p', {}, t.text),
          t.example ? h('p', { class: 'quiet' }, `For example: ${t.example}`) : '',
          t.url ? h('a', { href: t.url, target: '_blank', rel: 'noopener' }, `Slide ${t.slide} ↗`) : '',
        ),
      );
      box.append(card);
      if (i === scrollTarget) setTimeout(() => card.scrollIntoView({ block: 'nearest' }));
    });
  }

  function openTrophies(focus) {
    trophies.hidden = false;
    renderTrophies(focus);
  }

  function render(s) {
    state = s;
    announceNewHats();
    renderHats();
    renderAsks();
    const count = s.trophies.length;
    $('#trophies-open').hidden = !count;
    $('#trophies-open').textContent = `Trophies (${count})`;
  }

  return { render, openTrophies, openAsks, closeAll };
}
