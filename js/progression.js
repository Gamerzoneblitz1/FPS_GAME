// progression.js — Erfahrung (XP), Level und gewählter Skin, gespeichert PRO NAME.
// Lokal im Browser (localStorage, als Backup) und zusätzlich auf dem Server (siehe server.js: 'syncProgress' /
// 'saveProgress'), damit der Spielstand auch auf anderen Geräten unter demselben Namen verfügbar ist.
// Ohne eingegebenen Namen (Gast) wird nichts gespeichert.
// Hinweis: Die XP werden im Client berechnet (technisch manipulierbar) - für ein Hobby-Spiel ok.
import { SKINS } from './skins.js';

const KEY = 'nv_progress_v2';          // { "name": { xp, skin } }
const LEGACY_KEY = 'nv_progress';      // alter Einzel-Spielstand (vor der Speicherung pro Name) -> wird einmalig übernommen
const LAST_NAME_KEY = 'nv_last_name';
export const MAX_LEVEL = 30;
export const XP_PER_KILL = 150;
export const XP_PER_DAMAGE = 0.25; // pro Schadenspunkt, abgerundet
const MAX_XP = 10_000_000;

// XP, die von Level L auf L+1 nötig sind: 200, 300, 400, ...
export function xpToNext(level) { return 200 + 100 * (level - 1); }

export const nameKey = (name) => String(name || '').trim().toLowerCase().slice(0, 20);

function sanitize(s) {
    const out = { xp: 0, skin: 0 };
    if (s && Number.isFinite(s.xp) && s.xp >= 0) out.xp = Math.min(MAX_XP, Math.floor(s.xp));
    if (s && Number.isInteger(s.skin) && SKINS[s.skin]) out.skin = s.skin;
    return out;
}

let db = {};
let legacy = null;
try { db = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { db = {}; }
try { const l = JSON.parse(localStorage.getItem(LEGACY_KEY)); if (l && Number.isFinite(l.xp)) legacy = sanitize(l); } catch (e) { legacy = null; }

let activeKey = null;                  // null = Gast: nichts wird gespeichert
let state = { xp: 0, skin: 0 };

function save() {
    if (activeKey === null) return;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignorieren */ }
}

export function getLastName() {
    try { return localStorage.getItem(LAST_NAME_KEY) || ''; } catch (e) { return ''; }
}

// Spielstand für einen Namen laden (leer = Gast). Beim ersten Mal wird ein alter Einzel-Spielstand übernommen.
export function setActiveName(name) {
    const key = nameKey(name);
    if (!key) { activeKey = null; state = { xp: 0, skin: 0 }; return; }
    activeKey = key;
    let s = db[key];
    if (!s && legacy) {
        s = legacy; legacy = null;
        try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignorieren */ }
    }
    state = sanitize(s);
    db[key] = state;
    save();
    try { localStorage.setItem(LAST_NAME_KEY, String(name).trim().slice(0, 20)); } catch (e) { /* ignorieren */ }
}

export function isPersistent() { return activeKey !== null; }
export function getState() { return { xp: state.xp, skin: state.skin }; }

// Stand vom Server übernehmen (Server hat das Maximum aus Server- und Client-Stand gebildet)
export function applyServer(s) {
    const clean = sanitize(s);
    state.xp = clean.xp;
    state.skin = clean.skin;
    save();
}

export function getProgress() {
    let level = 1, rem = state.xp;
    while (level < MAX_LEVEL && rem >= xpToNext(level)) { rem -= xpToNext(level); level++; }
    const max = level >= MAX_LEVEL;
    return { level, xpInLevel: rem, need: max ? 0 : xpToNext(level), totalXp: state.xp, max };
}

// Gibt zurück, ob dabei ein Level-Aufstieg passiert ist (und von/zu welchem Level)
export function addXp(amount) {
    if (!(amount > 0)) return { levelUp: false };
    const from = getProgress().level;
    state.xp = Math.min(MAX_XP, state.xp + Math.floor(amount));
    save();
    const to = getProgress().level;
    return { levelUp: to > from, from, to };
}

export function getSkinId() {
    // Falls der gespeicherte Skin (noch) nicht freigeschaltet ist, auf Standard zurückfallen
    return SKINS[state.skin] && getProgress().level >= SKINS[state.skin].unlockLevel ? state.skin : 0;
}

export function setSkinId(id) {
    if (!SKINS[id] || getProgress().level < SKINS[id].unlockLevel) return false;
    state.skin = id;
    save();
    return true;
}
