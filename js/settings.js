// settings.js — Maus-, Sicht- und Fadenkreuz-Einstellungen: Standardwerte, Wertebereiche, Prüfung und das Zeichnen des
// Fadenkreuzes (als SVG). Reine Logik ohne THREE/DOM-Abhängigkeit, daher testbar.
// Die Werte liegen im Browser (localStorage 'fpsGameSettings', geräteabhängig - Maus/Bildschirm sind auf jedem Gerät anders).

export const DEFAULTS = {
    sens: 1,          // Mausempfindlichkeit (Faktor; 1 = wie bisher)
    adsSens: 1,       // zusätzlicher Faktor beim Zielen (die Zoom-Anpassung passiert automatisch obendrauf)
    fov: 75,          // Sichtfeld in Grad (vertikal)
    invertY: false,   // Y-Achse invertieren
    crosshair: { style: 'dot', color: '#ffffff', size: 10, thickness: 2, gap: 4, opacity: 100, outline: true }
};

export const LIMITS = {
    sens: [0.1, 4], adsSens: [0.3, 1.5], fov: [60, 110],
    size: [2, 30], thickness: [1, 6], gap: [0, 14], opacity: [30, 100]
};

export const CROSSHAIR_STYLES = [['dot', 'Punkt'], ['cross', 'Kreuz'], ['combo', 'Kreuz + Punkt'], ['circle', 'Kreis']];
export const CROSSHAIR_COLORS = ['#ffffff', '#00f0ff', '#39ff14', '#ff3355', '#ffe14d', '#ff2bd6'];

const num = (v, [min, max], def) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// Beliebige (auch alte/kaputte) gespeicherte Daten -> gültige Einstellungen. Fehlende Werte bekommen den Standard.
export function sanitizeControls(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const c = r.crosshair && typeof r.crosshair === 'object' ? r.crosshair : {};
    const D = DEFAULTS, DC = DEFAULTS.crosshair;
    return {
        sens: num(r.sens, LIMITS.sens, D.sens),
        adsSens: num(r.adsSens, LIMITS.adsSens, D.adsSens),
        fov: Math.round(num(r.fov, LIMITS.fov, D.fov)),
        invertY: r.invertY === true,
        crosshair: {
            style: CROSSHAIR_STYLES.some(([k]) => k === c.style) ? c.style : DC.style,
            color: /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color.toLowerCase() : DC.color,
            size: Math.round(num(c.size, LIMITS.size, DC.size)),
            thickness: Math.round(num(c.thickness, LIMITS.thickness, DC.thickness)),
            gap: Math.round(num(c.gap, LIMITS.gap, DC.gap)),
            opacity: Math.round(num(c.opacity, LIMITS.opacity, DC.opacity)),
            outline: c.outline === undefined ? DC.outline : c.outline === true
        }
    };
}

// Fadenkreuz als SVG-Text. Der Mittelpunkt liegt exakt in der Bildmitte (das <svg> wird um sich selbst zentriert).
// Klassen: ch-stroke / ch-fill = farbige Teile (beim Treffer per CSS rot umgefärbt), ch-outline = dunkle Umrandung.
export function renderCrosshairSVG(ch) {
    const c = sanitizeControls({ crosshair: ch }).crosshair;
    const { style, size: s, thickness: t, gap: g } = c;
    const dotR = style === 'dot' ? Math.max(1, s * 0.35) : Math.max(1, t * 0.9);
    const ext = (style === 'circle' ? s + t : style === 'dot' ? dotR : g + s) + t + 3;   // Ausdehnung vom Zentrum inkl. Umrandung
    const W = Math.ceil(ext * 2);
    const lines = [[g, 0, g + s, 0], [-g, 0, -g - s, 0], [0, g, 0, g + s], [0, -g, 0, -g - s]];
    const hasLines = style === 'cross' || style === 'combo';
    const hasDot = style === 'dot' || style === 'combo';

    const layer = (cls, color, width, grow, fillCls) => {
        let out = '';
        if (hasLines) out += lines.map(l => `<line x1="${l[0]}" y1="${l[1]}" x2="${l[2]}" y2="${l[3]}" stroke="${color}" stroke-width="${width}" class="${cls}"/>`).join('');
        if (hasDot) out += `<circle r="${dotR + grow}" fill="${color}" class="${fillCls}"/>`;
        if (style === 'circle') out += `<circle r="${s}" fill="none" stroke="${color}" stroke-width="${width}" class="${cls}"/>`;
        return out;
    };
    const outline = c.outline ? `<g class="ch-outline-layer">${layer('ch-outline', 'rgba(0,0,0,0.8)', t + 2, 1, 'ch-outline')}</g>` : '';
    const main = `<g>${layer('ch-stroke', c.color, t, 0, 'ch-fill')}</g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="${-W / 2} ${-W / 2} ${W} ${W}" ` +
        `style="position:absolute;left:${-W / 2}px;top:${-W / 2}px;overflow:visible" opacity="${c.opacity / 100}">${outline}${main}</svg>`;
}

// Winkel auf -PI..PI bringen (für Kamera-Drehungen)
export function wrapAngle(a) {
    return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}
