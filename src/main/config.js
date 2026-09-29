'use strict';
const fs = require('fs');
const path = require('path');

// AKP153_CONFIG lets a test (or an agent) point at a copy instead of the live
// file - writing the real one while the app is running is a race we'd rather
// avoid in tests.
const FILE = process.env.AKP153_CONFIG
  ? path.resolve(process.env.AKP153_CONFIG)
  : path.join(__dirname, '..', '..', 'config.json');

const clone = (o) => JSON.parse(JSON.stringify(o));

const DEFAULT_STRIPS = {
  '0': { type: 'clock', label: '', color: '#263238' },
  '1': { type: 'text', label: '', color: '#1a237e' },
  '2': { type: 'page', label: '', color: '#263238' },
};

const DEFAULT_GRADIENT = {
  enabled: false,
  from: '#1565c0',
  to: '#6a1b9a',
  angle: 135,
};

const DEFAULTS = {
  version: 2,
  brightness: 80,
  idleSleepMinutes: 5,
  // Which command order actually cuts this panel's backlight.
  // Measured on the AKP153 with host/sniff-sleep.js: only the two orders that
  // END with HAN+sleep go fully dark. 'vendor' (Companion's order, brightness
  // zeros last) left the backlight at a faint glow - those trailing LBLIG/LIG
  // writes re-light it. 'zeros-last' is the same idea done correctly.
  sleepMode: 'zeros-last',
  openAtLogin: true,
  // Device shell colour in the editor: 'light' (default) or 'dark'.
  theme: 'light',
  // Remembered window geometry - the layout needs >=1000px or the inspector
  // gets squeezed into an unusable sliver.
  window: null,
  // Page tree. Each page: {id, name, parent, buttons, strips}
  //   parent = null  -> top level page
  //   parent = <id>  -> sub page ("folder"); the device grows a back key
  // There is a single current page: the editor and the device always show the
  // same one, so what you edit is what you see.
  pages: [],
  currentPage: null,
  // Saved button presets. Each entry: {id, name, savedAt, spec}
  library: [],
};

let cache = null;
let lastRaw = null;      // the exact file text we last read or wrote

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'config.default.json');

function readRaw() {
  try {
    if (fs.existsSync(FILE)) return fs.readFileSync(FILE, 'utf8');
    if (fs.existsSync(DEFAULT_FILE)) {
      const def = fs.readFileSync(DEFAULT_FILE, 'utf8');
      try { fs.writeFileSync(FILE, def, 'utf8'); } catch (_) {}
      return def;
    }
  } catch (e) { return null; }
  return null;
}

function newPageId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function load() {
  if (cache) return cache;
  const raw = readRaw();
  lastRaw = raw;
  let saved = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch (e) { /* first run, or a half-written file */ }

  cache = Object.assign({}, DEFAULTS, saved);

  // --- migrate the flat single-page layout (v1: top-level buttons/strips) ---
  if (!Array.isArray(cache.pages) || !cache.pages.length) {
    cache.pages = [{
      id: 'p1',
      name: '主页面',
      parent: null,
      buttons: cache.buttons || {},
      strips: cache.strips || clone(DEFAULT_STRIPS),
    }];
  }
  delete cache.buttons;
  delete cache.strips;

  for (const p of cache.pages) {
    if (!p.id) p.id = newPageId();
    if (!p.name) p.name = '未命名页';
    if (p.parent === undefined) p.parent = null;
    p.buttons = (p.buttons && typeof p.buttons === 'object') ? p.buttons : {};
    p.strips = Object.assign(clone(DEFAULT_STRIPS), p.strips || {});
    p.gradient = Object.assign(
      clone(DEFAULT_GRADIENT),
      (p.gradient && typeof p.gradient === 'object') ? p.gradient : {}
    );
    // a page action without a mode is a key that does nothing - default it
    for (const s of Object.values(p.buttons)) {
      if (s && s.type === 'page' && !s.mode) s.mode = 'next';
    }
  }
  // a page whose parent vanished becomes a top-level page
  const ids = new Set(cache.pages.map((p) => p.id));
  for (const p of cache.pages) if (p.parent && !ids.has(p.parent)) p.parent = null;

  if (!cache.pages.some((p) => p.id === cache.currentPage)) {
    cache.currentPage = cache.pages[0].id;
  }
  if (!Array.isArray(cache.library)) cache.library = [];
  for (const e of cache.library) {
    if (!e.id) e.id = 'L' + Math.random().toString(36).slice(2, 10);
    if (!Array.isArray(e.tags)) e.tags = normalizeTags(e.tags || e.tag);
    if (typeof e.name !== 'string') e.name = (e.spec && e.spec.label) || '未命名';
  }
  cache.version = DEFAULTS.version;
  return cache;
}

function normalizeTags(v) {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean);
  return [];
}

/** Drop the in-memory copy so the next load() re-reads the file. */
function invalidate() {
  cache = null;
}

/**
 * Has the file been changed by somebody other than us?
 *
 * Compares the raw text against what we last read/wrote. This replaces the
 * earlier "ignore events within 900ms of our own save" heuristic, which was
 * wrong: a 4-second mtime poll would still see the mtime change made by our own
 * save(), find msSinceSave() == 4000ms, and fire a bogus "external change"
 * reload - which repaints all 18 keys over HID and makes the panel feel dead
 * for a few seconds. Comparing content is exact, and it also skips the harmless
 * case of an external rewrite with identical content.
 */
function changedOnDisk() {
  const raw = readRaw();
  if (raw == null) return false;
  if (lastRaw != null && raw === lastRaw) return false;
  return true;
}

/** The page the device and the editor are both showing. */
function currentPage() {
  const cfg = load();
  return cfg.pages.find((p) => p.id === cfg.currentPage) || cfg.pages[0];
}

/** Pages that can be reached from `id`: its children, or the top level for null. */
function childPages(id) {
  return load().pages.filter((p) => p.parent === id);
}

/** Top-level pages in order, then their children depth-first.
 *  Shape matches the renderer's pageTree(): [{page, depth}] */
function pageTree() {
  const cfg = load();
  const out = [];
  const walk = (parent, depth) => {
    for (const p of cfg.pages.filter((x) => x.parent === parent)) {
      out.push({ page: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function save(cfg) {
  cache = cfg;
  const text = JSON.stringify(cfg, (key, value) => key.startsWith('_') ? undefined : value, 2);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, FILE);
  lastRaw = text;          // remember exactly what we wrote - see changedOnDisk()
  return true;
}

function get(key) {
  const cfg = load();
  return key ? cfg[key] : cfg;
}

function set(key, value) {
  const cfg = load();
  cfg[key] = value;
  save(cfg);
  return cfg;
}

module.exports = {
  load, save, get, set, DEFAULTS, FILE,
  currentPage, childPages, pageTree, newPageId, DEFAULT_STRIPS, DEFAULT_GRADIENT,
  invalidate, changedOnDisk, normalizeTags, readRaw,
};
