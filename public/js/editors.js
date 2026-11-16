// The two answer editors, built on CodeMirror 6 (the one bundled library, in
// public/vendor/codemirror.js):
//
//   proseEditor  written answers. Part marks like ==①given== are shown the way
//                Obsidian shows markdown: tinted, with the ==① and == hidden
//                until the cursor is on them.
//   codeEditor   JavaScript for the code bench: line numbers, colours, Tab indents.
//
// Both keep the answer as plain text, exactly what a plain text box would hold,
// so nothing else in the game knows which editor wrote it.

import {
  EditorState, RangeSetBuilder, EditorView, keymap, lineNumbers, placeholder, drawSelection, Decoration, ViewPlugin, WidgetType,
  defaultKeymap, history, historyKeymap, indentWithTab,
  syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, indentUnit, javascript, tags,
} from '../vendor/codemirror.js';
import { CIRCLED } from './world.js';

// ---- the look, shared by both (colours come from game.css) -------------------------------

const look = EditorView.theme(
  {
    '&': { backgroundColor: '#120d22', border: '2px solid var(--quiet)', borderRadius: '4px', fontSize: 'inherit' },
    '&.cm-focused': { outline: 'none', borderColor: 'var(--gold)' },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.5' },
    '.cm-content': { padding: '6px 2px', caretColor: 'var(--gold)' },
    '.cm-cursor': { borderLeftColor: 'var(--gold)', borderLeftWidth: '2px' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#45367a' },
    '.cm-gutters': { backgroundColor: '#120d22', color: 'var(--quiet)', border: 'none' },
    '.cm-placeholder': { color: 'var(--quiet)' },
  },
  { dark: true },
);

/** What every editor needs: undo, the usual keys, and a call to `onChange(text)` after each edit. */
function basics({ label, onChange, onKey, onPaste }) {
  return [
    look,
    history(),
    drawSelection(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.contentAttributes.of({ 'aria-label': label }),
    EditorView.updateListener.of((update) => update.docChanged && onChange(update.state.doc.toString())),
    EditorView.domEventHandlers({
      keydown: () => void onKey?.(),
      paste: (e) => void onPaste?.((e.clipboardData?.getData('text') || '').length),
    }),
  ];
}

function mount(extensions, value) {
  const el = document.createElement('div');
  const view = new EditorView({ parent: el, state: EditorState.create({ doc: value, extensions }) });
  return { el, view };
}

// ---- written answers with part marks --------------------------------------------------------

const MARK = /==([①-⑨])([\s\S]*?)==/g;

/** The small numbered badge that stands in for a hidden "==①". */
class Badge extends WidgetType {
  constructor(circled) {
    super();
    this.circled = circled;
  }
  eq(other) {
    return other.circled === this.circled;
  }
  toDOM() {
    const b = document.createElement('b');
    b.textContent = this.circled;
    b.className = 'mark-badge';
    return b;
  }
}

/** Tint every marked part; hide its ==① and == unless the cursor is inside the mark. */
function markDecorations(view) {
  const builder = new RangeSetBuilder();
  const text = view.state.doc.toString();
  const cursors = view.state.selection.ranges;
  for (const m of text.matchAll(MARK)) {
    const from = m.index;
    const to = from + m[0].length;
    const tint = Decoration.mark({ class: `mark m${CIRCLED.indexOf(m[1]) + 1}` });
    const editing = view.hasFocus && cursors.some((r) => r.from <= to && r.to >= from);
    const oneLine = !m[0].includes('\n'); // hidden pieces must not span a line break
    if (editing || !oneLine) builder.add(from, to, tint);
    else {
      builder.add(from, from + 3, Decoration.replace({ widget: new Badge(m[1]) }));
      if (to - 2 > from + 3) builder.add(from + 3, to - 2, tint);
      builder.add(to - 2, to, Decoration.replace({}));
    }
  }
  return builder.finish();
}

const liveMarks = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = markDecorations(view);
    }
    update(update) {
      if (update.docChanged || update.selectionSet || update.focusChanged) this.decorations = markDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * An editor for a written answer. Returns { el, mark(n), focus() }:
 * `mark(n)` wraps the selected text as required part n, the way the ①②③ buttons do.
 */
export function proseEditor({ value = '', label = 'Your answer', onChange, onKey, onPaste }) {
  const { el, view } = mount([...basics({ label, onChange, onKey, onPaste }), EditorView.lineWrapping, placeholder(label), liveMarks], value);
  el.className = 'editor prose';
  return {
    el,
    focus: () => view.focus(),
    mark(n) {
      const { from, to } = view.state.selection.main;
      const inner = view.state.sliceDoc(from, to);
      const marked = `==${CIRCLED[n - 1]}${inner}==`;
      // the cursor goes after the mark, or inside an empty one ready to type
      const cursor = inner ? from + marked.length : from + 3;
      view.dispatch({ changes: { from, to, insert: marked }, selection: { anchor: cursor } });
      view.focus();
    },
  };
}

// ---- code ----------------------------------------------------------------------------------------

const codeColours = HighlightStyle.define([
  { tag: tags.keyword, color: '#ff8ad8' },
  { tag: [tags.string, tags.special(tags.string)], color: '#5ee08a' },
  { tag: [tags.number, tags.bool, tags.null], color: '#ffcf4a' },
  { tag: tags.comment, color: '#b5a8d6', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#4cb3ff' },
  { tag: tags.definition(tags.variableName), color: '#c39bff' },
  { tag: tags.operator, color: '#ff9f5a' },
]);

/** An editor for JavaScript. Returns { el, focus() }. */
export function codeEditor({ value = '', label = 'Your code', onChange, onPaste }) {
  const { el, view } = mount(
    [...basics({ label, onChange, onPaste }), keymap.of([indentWithTab]), lineNumbers(), javascript(), syntaxHighlighting(codeColours), bracketMatching(), indentOnInput(), indentUnit.of('  ')],
    value,
  );
  el.className = 'editor code';
  return { el, focus: () => view.focus() };
}
