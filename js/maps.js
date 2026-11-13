// maps.js — Karten laden. Alle Karten stehen im Ordner maps/ und sind in maps/index.json eingetragen.
// Zwei Kartentypen:
//   "grid" : eine JS-Datei mit  export function setupMap(scene)  (Textraster wie maps/neon-vault.js)
//   "glb"  : ein 3D-Modell (.glb/.gltf), siehe glbmap.js (Skalierung, Kollision, Spawns werden automatisch erzeugt)
// loadMap() baut die Karte in eine eigene Gruppe, damit sie später komplett entfernt werden kann (Kartenwechsel).
import { loadGlbMap } from './glbmap.js';

const FALLBACK_MANIFEST = { default: 'neon-vault', maps: [{ id: 'neon-vault', name: 'Neon Vault Megaplex', type: 'grid', file: 'maps/neon-vault.js' }] };

export async function fetchManifest() {
    try {
        const res = await fetch('maps/index.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const m = await res.json();
        const maps = (Array.isArray(m.maps) ? m.maps : []).filter(e => e && typeof e.id === 'string' && typeof e.file === 'string')
            .map(e => ({ ...e, name: e.name || e.id, type: e.type === 'glb' ? 'glb' : 'grid' }));
        if (!maps.length) throw new Error('keine Karten eingetragen');
        return { default: maps.some(e => e.id === m.default) ? m.default : maps[0].id, maps };
    } catch (err) {
        console.warn('maps/index.json nicht ladbar - nur die eingebaute Karte:', err.message);
        return FALLBACK_MANIFEST;
    }
}

function disposeTree(obj) {
    obj.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => {
            if (!m) return;
            for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
            m.dispose();
        });
    });
}

// Gibt { colliders, dispose() } zurück. colliders hat dieselben Zusatzfelder wie bisher
// (spawnPoints, groundMeshes, shootBlockers, skyboxGroup, portalRings) plus groundStepUp und killY.
export async function loadMap(scene, entry, onProgress = () => {}) {
    const target = new THREE.Group();
    target.name = 'map-root';
    scene.add(target);
    // Die Kartenfunktionen schreiben nur scene.add / scene.background / scene.fog -> in die Gruppe bzw. die echte Szene umleiten
    const adapter = {
        add: (...o) => target.add(...o),
        get background() { return scene.background; }, set background(v) { scene.background = v; },
        get fog() { return scene.fog; }, set fog(v) { scene.fog = v; }
    };
    let colliders;
    try {
        if (entry.type === 'glb') {
            colliders = await loadGlbMap(target, entry, adapter, onProgress);
        } else {
            const mod = await import(new URL(entry.file, document.baseURI).href);
            if (typeof mod.setupMap !== 'function') throw new Error(entry.file + ' exportiert keine setupMap()');
            colliders = mod.setupMap(adapter);
            colliders.groundStepUp = 5;
        }
    } catch (err) {
        scene.remove(target);
        disposeTree(target);
        throw err;
    }
    return {
        entry, colliders,
        dispose() {
            scene.remove(target);
            disposeTree(target);
            scene.fog = null;
            scene.background = new THREE.Color(0x000000);
        }
    };
}
