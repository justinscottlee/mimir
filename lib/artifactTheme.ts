/**
 * Base stylesheet injected into every artifact preview iframe so generated
 * web artifacts inherit the Talos look (dark workshop palette, IBM Plex,
 * bronze accents) without each artifact having to restate it. Artifacts can
 * still override anything — this is a starting layer, not a cage.
 *
 * Kept as a plain string so it can be concatenated into the iframe srcDoc.
 */
export const ARTIFACT_THEME_CSS = `
:root {
  --ink-950: #0d0f11;
  --ink-900: #121518;
  --ink-850: #171b1f;
  --ink-800: #1e2328;
  --ink-700: #2a3037;
  --bronze-300: #e8b878;
  --bronze-400: #d99f54;
  --bronze-500: #c8853a;
  --bronze-600: #a3672a;
  --parchment-100: #ece7dd;
  --parchment-400: #a9aeb5;
  --parchment-600: #6f757d;
  --ok: #7fb069;
  --err: #d06c5b;
  --radius: 8px;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  background: var(--ink-950);
  color: var(--parchment-100);
  font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.55;
}
body { padding: 16px; }
h1, h2, h3, h4 { color: var(--parchment-100); font-weight: 600; line-height: 1.25; }
h1 { font-size: 1.4rem; } h2 { font-size: 1.2rem; } h3 { font-size: 1.05rem; }
p { color: var(--parchment-400); }
a { color: var(--bronze-300); text-underline-offset: 2px; }
code, pre, kbd, samp {
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
}
code { background: var(--ink-800); padding: 0.1em 0.35em; border-radius: 4px; color: var(--bronze-300); }
pre { background: var(--ink-950); border: 1px solid var(--ink-700); border-radius: var(--radius); padding: 12px 14px; overflow: auto; }
pre code { background: none; padding: 0; color: inherit; }
button {
  font: inherit;
  cursor: pointer;
  background: var(--bronze-500);
  color: var(--ink-950);
  border: none;
  border-radius: var(--radius);
  padding: 0.5em 1em;
  font-weight: 500;
  transition: background 0.15s ease;
}
button:hover { background: var(--bronze-400); }
button.secondary { background: transparent; color: var(--parchment-400); border: 1px solid var(--ink-700); }
button.secondary:hover { background: var(--ink-800); color: var(--parchment-100); }
input, select, textarea {
  font: inherit;
  background: var(--ink-850);
  color: var(--parchment-100);
  border: 1px solid var(--ink-700);
  border-radius: var(--radius);
  padding: 0.5em 0.7em;
}
input:focus, select:focus, textarea:focus {
  outline: 2px solid var(--bronze-400);
  outline-offset: 1px;
}
label { color: var(--parchment-400); font-size: 0.9em; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid var(--ink-700); padding: 0.45em 0.7em; text-align: left; }
th { background: var(--ink-850); font-family: "IBM Plex Mono", monospace; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--parchment-400); }
hr { border: none; border-top: 1px solid var(--ink-700); margin: 1em 0; }
.card { background: var(--ink-900); border: 1px solid var(--ink-700); border-radius: var(--radius); padding: 16px; }
.accent { color: var(--bronze-400); }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--ink-700); border-radius: 999px; }
::-webkit-scrollbar-track { background: transparent; }
`.trim();

/**
 * Fonts to load inside the iframe. Pulled from Google Fonts so the artifact
 * matches the app even though the iframe is a separate document. If you
 * self-host IBM Plex later, swap this for a <style>@font-face…</style>.
 */
const ARTIFACT_FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">';

/** Wraps raw artifact markup in a themed document for the preview iframe. */
export function buildArtifactDoc(code: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${ARTIFACT_FONT_LINK}<style>${ARTIFACT_THEME_CSS}</style></head><body>${code}</body></html>`;
}
