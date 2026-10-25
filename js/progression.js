// progression.js — Erfahrung (XP), Level und gewählter Skin. Wird im Browser (localStorage) gespeichert,
// bleibt also nach dem Neuladen erhalten. (Hinweis: client-seitig, d.h. technisch manipulierbar – für ein
// Hobby-Spiel ok; für echtes Ranking müsste der Server die XP führen.)
import { SKINS } from './skins.js';

const KEY = 'nv_progress';
export const MAX_LEVEL = 30;
export const XP_PER_KILL = 150;
export const XP_PER_DAMAGE = 0.25; // pro Schadenspunkt, aufgerundet nach unten

// XP, die von Level L auf L+1 nötig sind: 200, 300, 400, ...
export function xpToNext(level) { return 200 + 100 * (level - 1); }

let state = { xp: 0, skin: 0 };
try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved) {
        if (Number.isFinite(saved.xp) && saved.xp >= 0) state.xp = Math.floor(saved.xp);
        if (Number.isInteger(saved.skin) && SKINS[saved.skin]) state.skin = saved.skin;
    }
} catch (e) { /* kein localStorage -> Start bei Level 1 */ }

function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignorieren */ }
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
    state.xp += Math.floor(amount);
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
