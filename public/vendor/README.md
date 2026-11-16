# Vendored code

`codemirror.js` is CodeMirror 6 (https://codemirror.net, MIT licence, © Marijn Haverbeke and others): the state, view, commands, language and JavaScript packages, bundled into one file with esbuild. Its licence notices are kept inside the file.

It is the only code in this project that is not written for it, and it holds no game logic. The editors built on it are in `public/js/editors.js`.

To rebuild (for example to update CodeMirror):

```sh
cd tools/vendor
npm install
npm run build
```
