// preview.js — 3D-Vorschau fürs Inventar (wie die Inspect-Ansicht in CS2): zeigt Waffe oder Charakter mit dem
// gewählten Skin, dreht sich langsam und lässt sich mit der Maus/dem Finger drehen.
// Eigener kleiner Renderer (eigenes Canvas), wird erst beim ersten Öffnen erzeugt und rendert nur, solange das Canvas sichtbar ist.
// Alle Materialien sind ungelittet (MeshBasicMaterial) -> keine Lichter nötig. Benötigt THREE global (r128).
import { buildPreviewWeapon, getKnifeVariant, KNIFE_INDEX } from './weapon.js';
// Messer gibt es in mehreren Typen: Cache-Schlüssel enthält den gewählten Typ
const wkey = (target) => target === KNIFE_INDEX ? target + '.' + getKnifeVariant() : target;
import { createPlayerMesh, applySkin, updatePlayerAnimations } from './player.js';
import { SKINS } from './skins.js';
import { scrollSkinTextures } from './skintex.js';

export function createPreview(canvas) {
    let renderer = null, scene = null, camera = null, failed = false;
    let pivot = null;                 // dreht sich; enthält das aktuell gezeigte Objekt
    const weapons = new Map();        // Waffenindex -> { group, setSkin, ... } (einmal gebaut, dann wiederverwendet)
    let charMesh = null;
    let current = null;               // { kind: 'weapon'|'char', obj }
    let yaw = Math.PI / 2, dragging = false, lastX = 0, lastT = 0, rafId = 0, hue = 0;

    function init() {
        if (renderer || failed) return !failed;
        try {
            renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        } catch (e) { failed = true; return false; }
        renderer.setClearColor(0x000000, 0);
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
        pivot = new THREE.Group();
        scene.add(pivot);

        canvas.style.touchAction = 'none';
        canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
        canvas.addEventListener('pointermove', (e) => { if (dragging) { yaw += (e.clientX - lastX) * 0.012; lastX = e.clientX; } });
        const up = () => { dragging = false; };
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', up);
        return true;
    }

    function resize() {
        if (!renderer) return;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        const pr = Math.min(window.devicePixelRatio || 1, 1.5);
        if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) {
            renderer.setPixelRatio(pr);
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            frame();
        }
    }

    // Kamera so setzen, dass das Objekt (Seitenansicht) das Bild gut füllt
    function frame() {
        if (!current || !renderer) return;
        const box = new THREE.Box3().setFromObject(current.obj);
        const size = box.getSize(new THREE.Vector3());
        const tanV = Math.tan(camera.fov * Math.PI / 360), tanH = tanV * camera.aspect;
        const wide = Math.max(size.x, size.z);               // größte Ausdehnung beim Drehen (Breite)
        const d = Math.max((wide / 2 * 1.25) / tanH, (size.y / 2 * 1.35) / tanV, 0.3) + wide * 0.35;
        camera.position.set(0, 0, d);
        camera.lookAt(0, 0, 0);
    }

    function setObject(obj, kind) {
        if (current) pivot.remove(current.wrap);
        // Mittelpunkt in den Ursprung legen, damit die Drehung um die Mitte geht
        obj.position.set(0, 0, 0);
        obj.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(obj);
        const c = box.getCenter(new THREE.Vector3());
        const wrap = new THREE.Group();
        obj.position.sub(c);
        wrap.add(obj);
        pivot.add(wrap);
        current = { kind, obj: wrap, wrap };
        frame();
    }

    // target: 'char' oder Waffenindex; skinId: Skin, der gezeigt werden soll
    function show(target, skinId) {
        if (!init()) return false;
        const skin = SKINS[skinId] || SKINS[0];
        if (target === 'char') {
            if (!charMesh) charMesh = createPlayerMesh('preview', skinId);
            else applySkin(charMesh, skinId);
            if (!current || current.kind !== 'char') {
                charMesh.rotation.set(0, Math.PI, 0);          // Soldat schaut sonst nach -Z (von hinten gesehen)
                setObject(charMesh, 'char');
                yaw = 0;                                       // Vorderseite zur Kamera
            }
            current.skinId = skinId;
        } else {
            const wk = wkey(target);
            let w = weapons.get(wk);
            if (!w) { w = buildPreviewWeapon(target); weapons.set(wk, w); }
            w.setSkin(skin);
            if (!current || current.kind !== 'weapon' || current.weaponKey !== wk) {
                const wasWeapon = current && current.kind === 'weapon';
                setObject(w.group, 'weapon');
                current.weaponIndex = target; current.weaponKey = wk;
                if (!wasWeapon) yaw = Math.PI / 2;             // Seitenansicht, Mündung nach links
            }
            current.w = w;
        }
        resize();
        return true;
    }

    function tick(now) {
        rafId = requestAnimationFrame(tick);
        if (!renderer || !current || canvas.offsetParent === null) { lastT = now; return; } // Menü zu: nichts rendern
        const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016);
        lastT = now;
        resize();
        if (!dragging) yaw += dt * 0.45;
        pivot.rotation.set(current.kind === 'weapon' ? 0.12 : 0, yaw, 0);
        scrollSkinTextures(dt);                                   // bewegte Muster (Hyper, Plasma ...)
        if (current.kind === 'weapon' && current.w && current.w.rainbow) {
            hue = (hue + dt * 0.35) % 1;
            const col = new THREE.Color().setHSL(hue, 1, 0.55);
            current.w.setAccent(col.getHex());
        }
        if (current.kind === 'char') updatePlayerAnimations([charMesh], dt); // Regenbogen-Akzent
        renderer.render(scene, camera);
    }

    return {
        show,
        start() { if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(tick); } },
        stop() { cancelAnimationFrame(rafId); rafId = 0; },
        get failed() { return failed; }
    };
}

// ---------- Vorschaubilder ("Waffe mit Skin" wie die Inventarbilder in CS2) ----------
// Rendert Waffe/Soldat mit einem Skin einmal in ein Bild (PNG, transparent) und merkt es sich. Eigener kleiner Renderer.
export function createThumbMaker(W = 320, H = 200) {
    let renderer = null, scene = null, camera = null, pivot = null, failed = false, charMesh = null;
    const weapons = new Map(), cache = new Map();

    function init() {
        if (renderer || failed) return !failed;
        try {
            const c = document.createElement('canvas');
            renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
        } catch (e) { failed = true; return false; }
        renderer.setPixelRatio(1);
        renderer.setSize(W, H, false);
        renderer.setClearColor(0x000000, 0);
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 60);
        pivot = new THREE.Group();
        scene.add(pivot);
        return true;
    }

    // target: 0..6 (Waffe) oder 'char'; skinId: Skin (0 = Standard). Gibt eine data-URL zurück oder null.
    function make(target, skinId) {
        const key = (target === 'char' ? target : wkey(target)) + ':' + skinId;
        if (cache.has(key)) return cache.get(key);
        if (!init()) return null;
        const skin = SKINS[skinId] || SKINS[0];
        let obj, yaw;
        if (target === 'char') {
            if (!charMesh) charMesh = createPlayerMesh('thumb', skinId); else applySkin(charMesh, skinId);
            charMesh.rotation.set(0, Math.PI, 0);
            obj = charMesh; yaw = 0.35;
        } else {
            const wk = wkey(target);
            let w = weapons.get(wk);
            if (!w) { w = buildPreviewWeapon(target); weapons.set(wk, w); }
            w.setSkin(skin);
            if (skin.rainbow) w.setAccent(new THREE.Color().setHSL(0.55, 1, 0.55).getHex());
            obj = w.group; yaw = Math.PI / 2 + 0.3;
        }
        obj.position.set(0, 0, 0);
        obj.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(obj);
        const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
        const wrap = new THREE.Group();
        obj.position.sub(c);
        wrap.add(obj);
        pivot.add(wrap);
        pivot.rotation.set(target === 'char' ? 0 : 0.14, yaw, 0);
        const tanV = Math.tan(camera.fov * Math.PI / 360), tanH = tanV * camera.aspect;
        const wide = Math.max(size.x, size.z);
        const d = Math.max((wide / 2 * 1.2) / tanH, (size.y / 2 * 1.35) / tanV, 0.3) + wide * 0.35;
        camera.position.set(0, 0, d);
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
        let url = null;
        try { url = renderer.domElement.toDataURL('image/png'); } catch (e) { url = null; }
        pivot.remove(wrap);
        wrap.remove(obj);
        obj.position.set(0, 0, 0);
        if (url) cache.set(key, url);
        return url;
    }
    return { make, has: (target, skinId) => cache.has((target === 'char' ? target : wkey(target)) + ':' + skinId), get failed() { return failed; } };
}
