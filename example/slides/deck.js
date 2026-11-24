// A tiny slide engine for the sample deck. Any deck works with the game as long as:
//   - each slide is a <section class="slide" id="N"> (N from 1), so `deck.html#N` lands on it
//   - E reveals the next hidden step on the current slide (elements with data-cue, or data-cue="2"…)
//   - with ?view=notes it shows the speaker notes (<div class="sn">) instead of the slides
// Keys: arrows / Page Up / Page Down / Space move between slides, E reveals the next step.
(() => {
  const slides = [...document.querySelectorAll('.slide')];
  if (new URLSearchParams(location.search).get('view') === 'notes') document.documentElement.classList.add('notes-view');

  const fromHash = () => {
    const n = Number(location.hash.slice(1));
    return n >= 1 && n <= slides.length ? n - 1 : 0;
  };
  let current = fromHash();

  const smooth = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
  function go(i, instant = false) {
    current = Math.max(0, Math.min(slides.length - 1, i));
    slides[current].scrollIntoView({ behavior: smooth() && !instant ? 'smooth' : 'instant' });
    history.replaceState(null, '', `#${current + 1}`);
  }

  // Each press of E shows the next step: first data-cue / data-cue="1", then "2", and so on.
  function cue() {
    const hidden = [...slides[current].querySelectorAll('[data-cue]:not(.shown)')];
    if (!hidden.length) return;
    const step = Math.min(...hidden.map((el) => Number(el.dataset.cue) || 1));
    for (const el of hidden) if ((Number(el.dataset.cue) || 1) === step) el.classList.add('shown');
  }

  addEventListener('keydown', (e) => {
    if (e.key === 'e' || e.key === 'E') cue();
    else if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)) go(current + 1);
    else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) go(current - 1);
    else return;
    e.preventDefault();
  });
  addEventListener('hashchange', () => go(fromHash()));
  go(current, true); // on load, land on the slide straight away
})();
