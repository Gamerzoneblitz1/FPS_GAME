// progression.js — Erfahrung (XP), Level, Skins und Waffen-Loadout, gespeichert PRO NAME.
// Lokal im Browser (localStorage, als Backup) und zusätzlich auf dem Server (siehe server.js: 'syncProgress' /
// 'saveProgress'), damit der Spielstand auch auf anderen Geräten unter demselben Namen verfügbar ist.
// Ohne eingegebenen Namen (Gast) wird nichts gespeichert.
// Hinweis: Die XP werden im Client berechnet (technisch manipulierbar) - für ein Hobby-Spiel ok.
import { SKINS, skinFits, TARGET_CHAR, rollCrate, CRATES, CRATE_POOLS } from './skins.js';

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
    const out = { xp: 0, skin: 0, wskins: new Array(WEAPON_COUNT).fill(0), loadout: DEFAULT_LOADOUT.slice(), owned: [], opened: 0, knife: 0, extra: {} };
    if (!s) return out;
    if (Number.isFinite(s.xp) && s.xp >= 0) out.xp = Math.min(MAX_XP, Math.floor(s.xp));
    if (Array.isArray(s.owned)) {
        const set = new Set();
        for (const id of s.owned) if (validSkin(id) && id !== 0) set.add(id);
        out.owned = [...set].sort((x, y) => x - y);
    }
    if (s.extra && typeof s.extra === 'object') {          // Zusatzkopien (Duplikate): Anzahl über die erste Kopie hinaus
        for (const k of Object.keys(s.extra)) {
            const id = Number(k), n = Math.floor(Number(s.extra[k]));
            if (validSkin(id) && id !== 0 && out.owned.includes(id) && n > 0) out.extra[id] = Math.min(n, 9999);
        }
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
export function getState() { return { xp: state.xp, skin: state.skin, wskins: state.wskins.slice(), loadout: state.loadout.slice(), owned: state.owned.slice(), opened: state.opened, knife: state.knife, extra: { ...state.extra } }; }

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
    for (const k of Object.keys(clean.extra)) state.extra[k] = Math.max(state.extra[k] || 0, clean.extra[k]);
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

// ---------- Duplikate & Trade-up ----------
// Man kann einen Skin mehrfach besitzen. state.owned enthält jede ID einmal, state.extra[id] = weitere Kopien.
export const getCount = (id) => (id !== 0 && state.owned.includes(id) ? 1 + (state.extra[id] || 0) : 0);
function addCopy(id) {
    if (state.owned.includes(id)) state.extra[id] = (state.extra[id] || 0) + 1;
    else { state.owned.push(id); state.owned.sort((x, y) => x - y); }
}
function removeCopy(id) {
    if (!state.owned.includes(id)) return;
    if (state.extra[id] > 0) { state.extra[id] -= 1; if (!state.extra[id]) delete state.extra[id]; return; }
    state.owned = state.owned.filter(x => x !== id);                 // letzte Kopie weg -> Besitz und Ausrüstung entfernen
    if (state.skin === id) state.skin = 0;
    state.wskins = state.wskins.map(v => (v === id ? 0 : v));
}
export const TRADE_COUNT = 10;
export const NEXT_RARITY = { m: 'r', r: 'c', c: 'v', v: 'g' };
// Trade-up-Vertrag: 10 Skins (Liste von IDs, Wiederholung = mehrere Kopien) der gleichen Seltenheit -> 1 Skin der nächsten Stufe.
// Der Ausgang kommt aus der Kiste (Sammlung) eines zufällig gewählten Eingangs-Skins. Gibt { skin, dupe } oder null zurück.
export function tradeUp(ids, rng = Math.random) {
    if (!Array.isArray(ids) || ids.length !== TRADE_COUNT) return null;
    const need = {};
    for (const id of ids) { if (!validSkin(id) || id === 0) return null; need[id] = (need[id] || 0) + 1; }
    const rar = SKINS[ids[0]].rarity;
    if (!NEXT_RARITY[rar]) return null;
    for (const id of Object.keys(need)) if (SKINS[id].rarity !== rar || getCount(Number(id)) < need[id]) return null;
    const src = SKINS[ids[Math.floor(rng() * ids.length)]];
    const coll = CRATE_POOLS[src.crate || 'neon'] || CRATE_POOLS.neon;
    const list = coll[NEXT_RARITY[rar]] || CRATE_POOLS.neon[NEXT_RARITY[rar]];
    if (!list || !list.length) return null;
    const skin = list[Math.floor(rng() * list.length)];
    for (const id of ids) removeCopy(id);
    const dupe = state.owned.includes(skin.id);
    addCopy(skin.id);
    save();
    return { skin, dupe };
}

// ---------- Kisten ----------
export const getCrates = () => Math.max(0, cratesEarned(getProgress().level) - state.opened);
export const getOpened = () => state.opened;
// Kiste öffnen: gibt { skin, dupe } zurück oder null (keine Kiste). Bevorzugt Skins, die man noch nicht hat.
export function openCrate(crateKey = 'neon', rng = Math.random) {
    const crate = CRATES[crateKey] || CRATES.neon;
    if (getCrates() <= 0) return null;
    const skin = rollCrate(rng, crate.key);
    const dupe = state.owned.includes(skin.id);
    addCopy(skin.id);
    state.opened += 1;
    save();
    return { skin, dupe, crate };
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
