// progression.js — Erfahrung (XP), Level, Skins und Waffen-Loadout, gespeichert PRO NAME.
// Lokal im Browser (localStorage, als Backup) und zusätzlich auf dem Server (siehe server.js: 'syncProgress' /
// 'saveProgress'), damit der Spielstand auch auf anderen Geräten unter demselben Namen verfügbar ist.
// Ohne eingegebenen Namen (Gast) wird nichts gespeichert.
// Hinweis: Die XP werden im Client berechnet (technisch manipulierbar) - für ein Hobby-Spiel ok.
import { SKINS } from './skins.js';

const KEY = 'nv_progress_v2';          // { "name": { xp, skin, wskins, loadout } }
const LEGACY_KEY = 'nv_progress';      // alter Einzel-Spielstand (vor der Speicherung pro Name) -> wird einmalig übernommen
const LAST_NAME_KEY = 'nv_last_name';
export const MAX_LEVEL = 30;
export const XP_PER_KILL = 150;
export const XP_PER_DAMAGE = 0.25; // pro Schadenspunkt, abgerundet
export const WEAPON_COUNT = 6;     // Anzahl Waffen (WEAPON_CONFIGS in weapon.js)
export const DEFAULT_LOADOUT = [0, 1];
const MAX_XP = 10_000_000;

// XP, die von Level L auf L+1 nötig sind: 200, 300, 400, ...
export function xpToNext(level) { return 200 + 100 * (level - 1); }

export const nameKey = (name) => String(name || '').trim().toLowerCase().slice(0, 20);

const validSkin = (v) => Number.isInteger(v) && v >= 0 && !!SKINS[v];

// Wandelt beliebige (auch alte/kaputte) Daten in einen gültigen Stand um.
// Alter Stand mit nur "skin": der Skin galt für alles -> wird für Charakter und alle Waffen übernommen.
export function sanitize(s) {
    const out = { xp: 0, skin: 0, wskins: new Array(WEAPON_COUNT).fill(0), loadout: DEFAULT_LOADOUT.slice() };
    if (!s) return out;
    if (Number.isFinite(s.xp) && s.xp >= 0) out.xp = Math.min(MAX_XP, Math.floor(s.xp));
    if (validSkin(s.skin)) out.skin = s.skin;
    out.wskins = out.wskins.map((_, i) => (Array.isArray(s.wskins) && validSkin(s.wskins[i])) ? s.wskins[i] : (Array.isArray(s.wskins) ? 0 : out.skin));
    if (Array.isArray(s.loadout) && s.loadout.length === 2) {
        const [a, b] = s.loadout;
        if (Number.isInteger(a) && Number.isInteger(b) && a !== b && a >= 0 && b >= 0 && a < WEAPON_COUNT && b < WEAPON_COUNT) out.loadout = [a, b];
    }
    return out;
}

let db = {};
let legacy = null;
try { db = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { db = {}; }
try { const l = JSON.parse(localStorage.getItem(LEGACY_KEY)); if (l && Number.isFinite(l.xp)) legacy = sanitize(l); } catch (e) { legacy = null; }

let activeKey = null;                  // null = Gast: nichts wird gespeichert
let state = sanitize(null);

function save() {
    if (activeKey === null) return;
    db[activeKey] = state; // (bei einer Namens-Vorschau existiert der Eintrag erst ab der ersten echten Änderung)
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignorieren */ }
}

export function getLastName() {
    try { return localStorage.getItem(LAST_NAME_KEY) || ''; } catch (e) { return ''; }
}

// Spielstand für einen Namen laden (leer = Gast). Beim ersten Mal wird ein alter Einzel-Spielstand übernommen.
// commit=false: nur ansehen (z.B. während man im Login-Feld tippt) - legt keinen Eintrag an und merkt sich den Namen nicht
export function setActiveName(name, commit = true) {
    const key = nameKey(name);
    if (!key) { activeKey = null; state = sanitize(null); return; }
    activeKey = key;
    let s = db[key];
    if (!s && legacy && commit) {
        s = legacy; legacy = null;
        try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignorieren */ }
    }
    state = sanitize(s || (legacy && !commit ? null : null));
    if (commit) {
        db[key] = state;
        save();
        try { localStorage.setItem(LAST_NAME_KEY, String(name).trim().slice(0, 20)); } catch (e) { /* ignorieren */ }
    }
}

export function isPersistent() { return activeKey !== null; }
export function getState() { return { xp: state.xp, skin: state.skin, wskins: state.wskins.slice(), loadout: state.loadout.slice() }; }

// Stand vom Server übernehmen (Server hat das Maximum aus Server- und Client-Stand gebildet)
export function applyServer(s) {
    const clean = sanitize(s);
    state.xp = clean.xp;
    state.skin = clean.skin;
    state.wskins = clean.wskins;
    state.loadout = clean.loadout;
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

// ---------- Skins ----------
export const isSkinUnlocked = (id) => !!SKINS[id] && getProgress().level >= SKINS[id].unlockLevel;

// Charakter-Skin (so sehen dich andere). Noch nicht freigeschaltet -> Standard.
export function getSkinId() { return isSkinUnlocked(state.skin) ? state.skin : 0; }
export function setSkinId(id) {
    if (!isSkinUnlocked(id)) return false;
    state.skin = id; save(); return true;
}

// Skin pro Waffe (Index 0..5)
export function getWeaponSkin(i) { return isSkinUnlocked(state.wskins[i]) ? state.wskins[i] : 0; }
export function setWeaponSkin(i, id) {
    if (!(i >= 0 && i < WEAPON_COUNT) || !isSkinUnlocked(id)) return false;
    state.wskins[i] = id; save(); return true;
}
export function setAllWeaponSkins(id) {
    if (!isSkinUnlocked(id)) return false;
    state.wskins = state.wskins.map(() => id); save(); return true;
}

// ---------- Waffen-Loadout (2 Waffen) ----------
// Die Auswahl wird gespeichert, gilt im Spiel aber erst beim nächsten Spawn (Start oder nach dem Tod).
export function getLoadout() { return state.loadout.slice(); }
export function setLoadout(pair) {
    const clean = sanitize({ loadout: pair }).loadout;
    if (!(Array.isArray(pair) && pair[0] === clean[0] && pair[1] === clean[1])) return false; // ungültig (gleiche Waffe/außerhalb)
    state.loadout = clean; save(); return true;
}
