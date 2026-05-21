// Eagerly bundle every product SVG under src/runtime-icons/*.svg as a URL
// keyed by provider slug (claude.svg → 'claude'). Vite inlines the import
// map at build time, so lookup is O(1) and missing entries fall back to the
// letter avatar at the call site.
const URL_MAP = (() => {
  const modules = import.meta.glob('./*.svg', {
    eager: true,
    query: '?url',
    import: 'default',
  });
  const out = {};
  for (const [path, url] of Object.entries(modules)) {
    const slug = path.replace('./', '').replace('.svg', '');
    out[slug] = url;
  }
  return out;
})();

export function runtimeIconUrl(runtime) {
  if (!runtime) return null;
  return URL_MAP[runtime.provider] || URL_MAP[runtime.id] || null;
}
