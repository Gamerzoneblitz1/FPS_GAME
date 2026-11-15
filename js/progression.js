// progression.js — Erfahrung (XP), Level, Skins und Waffen-Loadout, gespeichert PRO NAME.
// Lokal im Browser (localStorage, als Backup) und zusätzlich auf dem Server (siehe server.js: 'syncProgress' /
// 'saveProgress'), damit der Spielstand auch auf anderen Geräten unter demselben Namen verfügbar ist.
// Ohne eingegebenen Namen (Gast) wird nichts gespeichert.
// Hinweis: Die XP werden im Client berechnet (technisch manipulierbar) - für ein Hobby-Spiel ok.
import { SKINS, skinFits, TARGET_CHAR, rollCrate } from './skins.js';

const KEY = 'nv_progress_v3';          // { "name": { xp, skin, wskins, loadout, owned, opened } }  (v3: Skins gehören zu einer Waffe, Kisten)
const OLD_KEY = 'nv_progress_v2';
const LEGACY_KEY = 'nv_progress';      // alter Einzel-Spielstand (vor der Speicherung pro Name) -> wird einmalig übernommen
const LAST_NAME_KEY = 'nv_last_name';
export const MAX_LEVEL = Infinity; // kein Level-Limit mehr
export const XP_PER_KILL = 150;
export const XP_PER_DAMAGE = 0.25; // pro Schadenspunkt, abgerundet
export const KNIFE_TYPE_COUNT = 6; // = KNIFE_TYPES.length in weapon.js
export const WEAPON_COUNT = 7;     // Anzahl Waffen inkl. Messer (WEAPON_CONFIGS in weapon.js)
export const DEFAULT_LOADOUT = [0, 1];
const MAX_XP = 200_000_000;

// XP, die von Level L auf L+1 nötig sind: 200, 300, 400, ...
export function xpToNext(level) { return 200 + 100 * (level - 1); }

// Pro Level-Aufstieg gibt es eine Kiste (Level 2 = erste Kiste). Verfügbar = verdient - geöffnet.
export const cratesEarned = (level) => Math.max(0, level - 1);

export const nameKey = (name) => String(name || '').trim().toLowerCase().slice(0, 20);

const validSkin = (v) => Number.isInteger(v) && v >= 0 && !!SKINS[v];

// Wandelt beliebige (auch alte/kaputte) Daten in einen gültigen Stand um.
// Skins: nur gültige, zur Waffe passende Skins, die man besitzt (alte Spielstände ohne "owned" starten ohne Skins; Kisten gibt es rückwirkend).
export function sanitize(s) {
    const out = { xp: 0, skin: 0, wskins: new Array(WEAPON_COUNT).fill(0), loadout: DEFAULT_LOADOUT.slice(), owned: [], opened: 0, knife: 0 };
    if (!s) return out;
    if (Number.isFinite(s.xp) && s.xp >= 0) out.xp = Math.min(MAX_XP, Math.floor(s.xp));
    if (Array.isArray(s.owned)) {
        const set = new Set();
        for (const id of s.owned) if (validSkin(id) && id !== 0) set.add(id);
        out.owned = [...set].sort((x, y) => x - y);
    }
    const has = (id) => id === 0 || out.owned.includes(id);
    if (validSkin(s.skin) && skinFits(SKINS[s.skin], TARGET_CHAR) && has(s.skin)) out.skin = s.skin;
    out.wskins = out.wskins.map((_, i) => (Array.isArray(s.wskins) && validSkin(s.wskins[i]) && skinFits(SKINS[s.wskins[i]], i) && has(s.wskins[i])) ? s.wskins[i] : 0);
    if (Array.isArray(s.loadout) && s.loadout.length === 2) {
        const [a, b] = s.loadout;
        // Messer (letzter Index) ist keine Kaufwaffe
        if (Number.isInteger(a) && Number.isInteger(b) && a !== b && a >= 0 && b >= 0 && a < WEAPON_COUNT - 1 && b < WEAPON_COUNT - 1) out.loadout = [a, b];
    }
    if (Number.isInteger(s.knife) && s.knife >= 0 && s.knife < KNIFE_TYPE_COUNT) out.knife = s.knife;
    if (Number.isInteger(s.opened) && s.opened >= 0) out.opened = Math.min(s.opened, 1_000_000);
    return out;
}

let db = {};
let legacy = null;
try { db = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { db = {}; }
// Einmalig: XP aus dem alten Format (v2) übernehmen (alte Skin-IDs gelten nicht mehr -> Kisten statt Skins)
try {
    const old = JSON.parse(localStorage.getItem(OLD_KEY)) || {};
    for (const k of Object.keys(old)) if (!db[k] && old[k] && Number.isFinite(old[k].xp)) db[k] = sanitize({ xp: old[k].xp });
} catch (e) { /* ignorieren */ }
try { const l = JSON.parse(localStorage.getItem(LEGACY_KEY)); if (l && Number.isFinite(l.xp)) legacy = sanitize(l); } catch (e) { legacy = null; }

// Test-Konto: Der Spielername "Tester" besitzt automatisch alle Skins (zum Ausprobieren). Gilt nur für diesen Namen.
const TESTER_KEY = 'tester';
function grantTesterSkins() {
    if (activeKey !== TESTER_KEY) return;
    state.owned = Object.keys(SKINS).map(Number).filter(id => id > 0 && SKINS[id]).sort((a, b) => a - b);
}

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
    grantTesterSkins();
    if (commit) {
        db[key] = state;
        save();
        try { localStorage.setItem(LAST_NAME_KEY, String(name).trim().slice(0, 20)); } catch (e) { /* ignorieren */ }
    }
}

export function isPersistent() { return activeKey !== null; }
export function getState() { return { xp: state.xp, skin: state.skin, wskins: state.wskins.slice(), loadout: state.loadout.slice(), owned: state.owned.slice(), opened: state.opened, knife: state.knife }; }

// Stand vom Server übernehmen (Server hat das Maximum aus Server- und Client-Stand gebildet)
export function applyServer(s) {
    const clean = sanitize(s);
    state.xp = clean.xp;
    state.skin = clean.skin;
    state.wskins = clean.wskins;
    state.loadout = clean.loadout;
    // Besitz nie verlieren: Vereinigung aus lokalem und Server-Stand, geöffnete Kisten = Maximum
    state.owned = [...new Set([...state.owned, ...clean.owned])].sort((x, y) => x - y);
    state.opened = Math.max(state.opened, clean.opened);
    // Messertyp: nur lokal gespeichert (state.knife bleibt unverändert)
    state.wskins = clean.wskins.map((v, i) => v || (state.wskins[i] && state.owned.includes(state.wskins[i]) ? state.wskins[i] : 0));
    grantTesterSkins();
    save();
}

export function getProgress() {
    let level = 1, rem = state.xp;
    while (rem >= xpToNext(level)) { rem -= xpToNext(level); level++; }
    return { level, xpInLevel: rem, need: xpToNext(level), totalXp: state.xp, max: false };
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

// ---------- Skins (Besitz) ----------
// Ein Skin gehört zu genau einer Waffe (oder dem Soldaten). ID 0 = Standard, gehört immer allen.
export const hasSkin = (id) => id === 0 || state.owned.includes(id);
export function getOwned() { return state.owned.slice(); }

// Charakter-Skin (so sehen dich andere). Nicht im Besitz -> Standard.
export function getSkinId() { return hasSkin(state.skin) ? state.skin : 0; }
export function setSkinId(id) {
    if (!validSkin(id) || !hasSkin(id) || !skinFits(SKINS[id], TARGET_CHAR)) return false;
    state.skin = id; save(); return true;
}

// Skin pro Waffe (Index 0..6)
export function getWeaponSkin(i) { return hasSkin(state.wskins[i]) && skinFits(SKINS[state.wskins[i]], i) ? state.wskins[i] : 0; }
export function setWeaponSkin(i, id) {
    if (!(i >= 0 && i < WEAPON_COUNT) || !validSkin(id) || !hasSkin(id) || !skinFits(SKINS[id], i)) return false;
    state.wskins[i] = id; save(); return true;
}

// ---------- Kisten ----------
export const getCrates = () => Math.max(0, cratesEarned(getProgress().level) - state.opened);
export const getOpened = () => state.opened;
// Kiste öffnen: gibt { skin, dupe } zurück oder null (keine Kiste). Bevorzugt Skins, die man noch nicht hat.
export function openCrate(rng = Math.random) {
    if (getCrates() <= 0) return null;
    let skin = null, dupe = false;
    for (let tries = 0; tries < 40; tries++) {
        const s = rollCrate(rng);
        if (!state.owned.includes(s.id)) { skin = s; break; }
        if (!skin) skin = s;
    }
    if (state.owned.includes(skin.id)) dupe = true;
    else { state.owned.push(skin.id); state.owned.sort((x, y) => x - y); }
    state.opened += 1;
    save();
    return { skin, dupe };
}

// ---------- Waffen-Loadout (2 Waffen, Kaufmenü mit Taste B) ----------
// Gespeichert wird die letzte Wahl (Vorauswahl im Kaufmenü). Alle Waffen sind frei verfügbar; im Spiel startet man nur mit dem Messer.
export function getLoadout() { return state.loadout.slice(); }
export function setLoadout(pair) {
    const clean = sanitize({ loadout: pair }).loadout;
    if (!(Array.isArray(pair) && pair[0] === clean[0] && pair[1] === clean[1])) return false; // ungültig (gleiche Waffe/außerhalb)
    state.loadout = clean; save(); return true;
}

// ---------- Messertyp (Aussehen des Messers, nur lokal) ----------
export const getKnifeType = () => state.knife || 0;
export function setKnifeType(i) {
    if (!Number.isInteger(i) || i < 0 || i >= KNIFE_TYPE_COUNT) return false;
    state.knife = i; save(); return true;
}
