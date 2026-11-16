// The pieces of CodeMirror 6 (MIT licence, codemirror.net) that the game's
// editors use, gathered into one file: public/vendor/codemirror.js.
//
// This is the only bundled code in the project. It holds no game logic: how
// the editors behave is in public/js/editors.js, which students can read.
// To rebuild after changing this list:  cd tools/vendor && npm install && npm run build

export { EditorState, RangeSetBuilder } from '@codemirror/state';
export { EditorView, keymap, lineNumbers, placeholder, drawSelection, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
export { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
export { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
export { javascript } from '@codemirror/lang-javascript';
export { tags } from '@lezer/highlight';
