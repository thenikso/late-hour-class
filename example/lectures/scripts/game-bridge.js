// Optional bridge for game-ready decks. A deck that loads this file can be
// driven from the class game when it sits inside the game's screen iframe:
// the game sends { type: 'cge:cue' } to reveal the next step (like pressing E).
// Outside the game it does nothing.
(() => {
  if (window.parent === window) return;
  addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'cge:cue') dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
  });
  // The other way round: the deck can ask the game for a few things. It only works on
  // the projector, where the teacher's page listens; everywhere else nothing happens.
  //   classGame.open('g')       open the question with that key
  //   classGame.trophy('m')     award a trophy
  //   classGame.timer(120)      show a two minute countdown
  //   classGame.room('lab')     open the door to another room
  const command = (action, fields) => window.parent.postMessage({ type: 'cge:command', action, ...fields }, '*');
  window.classGame = {
    open: (key) => command('open', { key }),
    trophy: (id) => command('trophy', { id }),
    timer: (seconds) => command('timer', { seconds }),
    room: (room) => command('room', { room }),
  };
  // Inside the game, slide jumps are instant: a long smooth scroll (say from slide 1
  // to 25) would show every slide in between on the screen.
  const mm = window.matchMedia.bind(window);
  window.matchMedia = (q) =>
    /prefers-reduced-motion:\s*reduce/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q);
  document.documentElement.style.scrollBehavior = 'auto';
  document.documentElement.classList.add('in-game');
})();
