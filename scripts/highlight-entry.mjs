// Entry point for the vendored webview highlighter bundle.
//
// The chat webview is hand-authored, unbundled ES5 loaded straight from
// `media/`, so it cannot `import` anything. highlight.js v11 ships only CJS and
// ESM builds on npm — the browser bundle lives on a CDN, and the panel's CSP
// forbids reaching one. So the bundle is built here from the pinned dependency
// instead of a downloaded blob: the input is reviewable, the version is in
// `package.json`, and Dependabot can see it.
//
// `lib/common` rather than the full package: ~40 languages instead of ~190,
// which is every language that realistically appears in a chat answer at a third
// of the size.
import hljs from 'highlight.js/lib/common';

window.hljs = hljs;
