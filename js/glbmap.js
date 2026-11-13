// glbmap.js — lädt eine 3D-Karte aus einer .glb/.gltf-Datei und macht sie spielbar:
//   1. Skalierung (entry.scale) und Ausrichtung (Mitte auf 0/0, tiefster Punkt auf y=0)
//   2. Kollision: Wand-artige Dreiecke werden in 0.5-m-Würfel (Voxel) umgerechnet und zu Kollisionsboxen verschmolzen.
//      Das Spiel nutzt dieselben Boxen wie bei den Raster-Karten (Gleiten an Wänden, auf Kanten landen, Stufen bis 0.5 m).
//   3. Boden: alle Meshes sind "Boden" für den Raycast nach unten (Treppen, Rampen, Dächer, Gelände).
//   4. Spawns: Objekte im Modell, deren Name mit "spawn" beginnt (z.B. spawn_1, spawn_ct_2) - sonst entry.spawns - sonst automatisch.
//   5. Große Meshes werden in Kacheln zerlegt, damit Schüsse und Bodenerkennung schnell bleiben.
// Benötigt THREE, THREE.GLTFLoader (und optional THREE.DRACOLoader) global (r128).

const EYE = 2.0; // Augenhöhe im Spiel (Spawn-Höhe = Boden + EYE)

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('Script nicht ladbar: ' + src));
        document.head.appendChild(el);
    });
}

async function loadGltf(url, onProgress) {
    // Falls index.html den Loader nicht einbindet, hier nachladen (gleiche Version wie three.js r128)
    if (typeof THREE.GLTFLoader !== 'function') {
        const bases = ['https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/', 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/js/loaders/'];
        let lastErr;
        for (const b of bases) {
            try { await loadScript(b + 'GLTFLoader.js'); if (typeof THREE.GLTFLoader === 'function') { try { await loadScript(b + 'DRACOLoader.js'); } catch (e) { /* optional */ } break; } }
            catch (e) { lastErr = e; }
        }
        if (typeof THREE.GLTFLoader !== 'function') throw new Error('GLTFLoader konnte nicht geladen werden' + (lastErr ? ' (' + lastErr.message + ')' : ''));
    }
    const loader = new THREE.GLTFLoader();
    if (typeof THREE.DRACOLoader === 'function') {
        const d = new THREE.DRACOLoader();
        d.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.4.1/');
        loader.setDRACOLoader(d);
    }
    return new Promise((resolve, reject) => {
        loader.load(url, resolve, (e) => { if (e && e.lengthComputable) onProgress(Math.min(0.9, e.loaded / e.total * 0.9)); }, reject);
    });
}

// ---------- große Meshes in Kacheln zerlegen (Weltkoordinaten) ----------
function chunkMesh(mesh, cell, targetGroup) {
    const g = mesh.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, col = g.attributes.color;
    if (!pos) return false;
    const index = g.index;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = (Array.isArray(mesh.material) && g.groups.length) ? g.groups
        : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
    mesh.updateWorldMatrix(true, false);
    const m = mesh.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const buckets = new Map();
    const idx = [0, 0, 0], wp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

    for (const grp of groups) {
        const end = Math.min(grp.start + grp.count, index ? index.count : pos.count);
        for (let i = grp.start; i + 2 < end + 0; i += 3) {
            for (let k = 0; k < 3; k++) {
                idx[k] = index ? index.getX(i + k) : i + k;
                wp[k].fromBufferAttribute(pos, idx[k]).applyMatrix4(m);
            }
            const cx = (wp[0].x + wp[1].x + wp[2].x) / 3, cz = (wp[0].z + wp[1].z + wp[2].z) / 3;
            const key = Math.floor(cx / cell) + '|' + Math.floor(cz / cell) + '|' + grp.materialIndex;
            let b = buckets.get(key);
            if (!b) { b = { mat: mats[grp.materialIndex] || mats[0], p: [], n: [], u: [], c: [] }; buckets.set(key, b); }
            for (let k = 0; k < 3; k++) {
                b.p.push(wp[k].x, wp[k].y, wp[k].z);
                if (nor) { n.fromBufferAttribute(nor, idx[k]).applyMatrix3(nm).normalize(); b.n.push(n.x, n.y, n.z); }
                if (uv) b.u.push(uv.getX(idx[k]), uv.getY(idx[k]));
                if (col) { b.c.push(col.getX(idx[k]), col.getY(idx[k]), col.getZ(idx[k])); }
            }
        }
    }
    for (const b of buckets.values()) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.p), 3));
        if (b.n.length) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.n), 3));
        else geo.computeVertexNormals();
        if (b.u.length) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.u), 2));
        if (b.c.length) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.c), 3));
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        targetGroup.add(new THREE.Mesh(geo, b.mat));
    }
    if (mesh.parent) mesh.parent.remove(mesh);
    g.dispose();
    return true;
}

function triCount(mesh) {
    const g = mesh.geometry;
    return g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
}

// ---------- Kollision: Wand-Dreiecke -> Voxel -> verschmolzene Boxen ----------
function buildColliders(meshes, bbox, size, wallNy) {
    const ox = bbox.min.x - 1, oy = bbox.min.y - 1, oz = bbox.min.z - 1;
    const DX = Math.ceil((bbox.max.x - bbox.min.x + 2) / size) + 2;
    const DY = Math.ceil((bbox.max.y - bbox.min.y + 2) / size) + 2;
    const voxels = new Set();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const step = size * 0.5;

    for (const mesh of meshes) {
        const g = mesh.geometry, pos = g.attributes.position;
        if (!pos) continue;
        const index = g.index;
        const n = index ? index.count : pos.count;
        const m = mesh.matrixWorld;
        for (let i = 0; i + 2 < n; i += 3) {
            a.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m);
            b.fromBufferAttribute(pos, index ? index.getX(i + 1) : i + 1).applyMatrix4(m);
            c.fromBufferAttribute(pos, index ? index.getX(i + 2) : i + 2).applyMatrix4(m);
            e1.subVectors(b, a); e2.subVectors(c, a);
            const nx = e1.y * e2.z - e1.z * e2.y, ny = e1.z * e2.x - e1.x * e2.z, nz = e1.x * e2.y - e1.y * e2.x;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len < 1e-9) continue;
            if (Math.abs(ny) / len > wallNy) continue;           // fast waagerecht: Boden/Dach -> das macht der Boden-Raycast
            const longest = Math.max(e1.length(), e2.length(), b.distanceTo(c));
            const steps = Math.min(400, Math.max(1, Math.ceil(longest / step)));
            for (let s = 0; s <= steps; s++) {
                for (let t = 0; t <= steps - s; t++) {
                    const fs = s / steps, ft = t / steps;
                    const x = a.x + e1.x * fs + e2.x * ft, y = a.y + e1.y * fs + e2.y * ft, z = a.z + e1.z * fs + e2.z * ft;
                    const ix = Math.floor((x - ox) / size), iy = Math.floor((y - oy) / size), iz = Math.floor((z - oz) / size);
                    voxels.add(ix + iy * DX + iz * DX * DY);
                }
            }
        }
    }
    if (voxels.size > 2500000 && size < 2) return buildColliders(meshes, bbox, size * 1.5, wallNy); // zu fein -> gröber

    // 1) Läufe entlang X, 2) Läufe entlang Z zu Platten, 3) Platten entlang Y zu Boxen
    const rows = new Map(); // "iy,iz" -> [ix...]
    for (const k of voxels) {
        const ix = k % DX, rest = (k - ix) / DX, iy = rest % DY, iz = (rest - iy) / DY;
        const rk = iy + ',' + iz;
        let r = rows.get(rk);
        if (!r) { r = []; rows.set(rk, r); }
        r.push(ix);
    }
    const slabsByY = new Map(); // iy -> Map("x0,x1" -> [{z0,z1}])
    for (const [rk, xs] of rows) {
        const [iy, iz] = rk.split(',').map(Number);
        xs.sort((p, q) => p - q);
        let x0 = xs[0], prev = xs[0];
        const flush = (x1) => {
            let ym = slabsByY.get(iy);
            if (!ym) { ym = new Map(); slabsByY.set(iy, ym); }
            const key = x0 + ',' + x1;
            let list = ym.get(key);
            if (!list) { list = []; ym.set(key, list); }
            list.push(iz);
        };
        for (let i = 1; i < xs.length; i++) {
            if (xs[i] !== prev + 1) { flush(prev); x0 = xs[i]; }
            prev = xs[i];
        }
        flush(prev);
    }
    const rectsByY = new Map(); // iy -> [{x0,x1,z0,z1}]
    for (const [iy, ym] of slabsByY) {
        const rects = [];
        for (const [key, zs] of ym) {
            const [x0, x1] = key.split(',').map(Number);
            zs.sort((p, q) => p - q);
            let z0 = zs[0], prev = zs[0];
            for (let i = 1; i <= zs.length; i++) {
                if (i === zs.length || zs[i] !== prev + 1) { rects.push({ x0, x1, z0, z1: prev }); if (i < zs.length) z0 = zs[i]; }
                if (i < zs.length) prev = zs[i];
            }
        }
        rectsByY.set(iy, rects);
    }
    const boxes = [];
    const open = new Map(); // "x0,x1,z0,z1" -> {y0, y1}
    const ys = [...rectsByY.keys()].sort((p, q) => p - q);
    const pad = 0.03;
    const emit = (key, o) => {
        const [x0, x1, z0, z1] = key.split(',').map(Number);
        const box = new THREE.Box3(
            new THREE.Vector3(ox + x0 * size - pad, oy + o.y0 * size, oz + z0 * size - pad),
            new THREE.Vector3(ox + (x1 + 1) * size + pad, oy + (o.y1 + 1) * size, oz + (z1 + 1) * size + pad));
        boxes.push(box);
    };
    let prevY = null;
    for (const iy of ys) {
        const keysNow = new Set();
        for (const r of rectsByY.get(iy)) {
            const key = r.x0 + ',' + r.x1 + ',' + r.z0 + ',' + r.z1;
            keysNow.add(key);
            const o = open.get(key);
            if (o && prevY === iy - 1) o.y1 = iy; else { if (o) emit(key, o); open.set(key, { y0: iy, y1: iy }); }
        }
        for (const [key, o] of open) if (!keysNow.has(key)) { emit(key, o); open.delete(key); }
        prevY = iy;
    }
    for (const [key, o] of open) emit(key, o);
    boxes.voxelSize = size;
    boxes.voxelCount = voxels.size;
    return boxes;
}

// ---------- Spawns automatisch finden ----------
function autoSpawns(meshes, bbox, colliders) {
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
    const out = [];
    const height = bbox.max.y - bbox.min.y;
    const maxY = bbox.min.y + Math.max(3, height * 0.1);
    const player = new THREE.Box3();
    const nrm = new THREE.Vector3();
    for (let spacing = 25; spacing >= 0 && out.length < 12; spacing -= 12) {
        for (let tries = 0; tries < 2500 && out.length < 16; tries++) {
            const x = bbox.min.x + 3 + Math.random() * (bbox.max.x - bbox.min.x - 6);
            const z = bbox.min.z + 3 + Math.random() * (bbox.max.z - bbox.min.z - 6);
            ray.set(new THREE.Vector3(x, bbox.max.y + 5, z), down);
            ray.far = height + 20;
            const hit = ray.intersectObjects(meshes, false)[0];
            if (!hit || hit.point.y > maxY || !hit.face) continue;
            nrm.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
            if (nrm.y < 0.9) continue;
            const p = hit.point;
            if (out.some(s => Math.hypot(s.x - p.x, s.z - p.z) < spacing)) continue;
            player.min.set(p.x - 0.6, p.y + 0.5, p.z - 0.6);
            player.max.set(p.x + 0.6, p.y + 2.5, p.z + 0.6);
            if (colliders.some(bx => bx.intersectsBox(player))) continue;
            ray.set(new THREE.Vector3(p.x, p.y + 0.1, p.z), up);
            ray.far = 3.5;
            if (ray.intersectObjects(meshes, false).length) continue;      // Decke/Dach direkt darüber
            out.push({ x: p.x, y: p.y + EYE, z: p.z });
        }
    }
    if (!out.length) out.push({ x: 0, y: bbox.max.y + EYE, z: 0 });
    return out;
}

export async function loadGlbMap(target, entry, adapter, onProgress = () => {}) {
    const url = new URL(entry.file, document.baseURI).href;
    const gltf = await loadGltf(url, onProgress);
    onProgress(0.9);
    await new Promise(r => setTimeout(r, 0)); // UI darf die Fortschrittsanzeige zeichnen

    const root = gltf.scene;
    const params = new URLSearchParams(location.search);
    const scale = parseFloat(params.get('mapscale')) || entry.scale || 1;
    root.scale.setScalar(scale);
    if (entry.rotationY) root.rotation.y = entry.rotationY * Math.PI / 180;
    target.add(root);
    root.updateMatrixWorld(true);

    // Ausrichten: Mitte auf x=0/z=0, tiefster Punkt auf y=0 (abschaltbar mit autoCenter:false)
    let bbox = new THREE.Box3().setFromObject(root);
    if (entry.autoCenter !== false) {
        const c = bbox.getCenter(new THREE.Vector3());
        root.position.set(-c.x, -bbox.min.y, -c.z);
    }
    if (Array.isArray(entry.offset)) root.position.add(new THREE.Vector3(entry.offset[0] || 0, entry.offset[1] || 0, entry.offset[2] || 0));
    root.updateMatrixWorld(true);

    // Spawn-Objekte einsammeln (Namen "spawn…") und aus der Szene nehmen
    const spawnFromNodes = [];
    const spawnNodes = [];
    root.traverse((o) => { if (/^spawn/i.test(o.name || '')) spawnNodes.push(o); });
    const wp = new THREE.Vector3();
    for (const o of spawnNodes) { o.getWorldPosition(wp); spawnFromNodes.push({ x: wp.x, y: wp.y + (o.isMesh ? 0 : 0), z: wp.z }); o.visible = false; }

    // Materialien: Rückseiten sichtbar (Modelle aus Spielen haben oft Löcher in der Rückseite)
    root.traverse((o) => {
        if (!o.isMesh) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        if (entry.doubleSide !== false) ms.forEach(m => { m.side = THREE.DoubleSide; });
        // Helligkeit: Der Renderer gibt linear aus (kein sRGB), die glTF-Texturen werden aber als sRGB gelesen -> alles wirkt zu dunkel.
        // Lösung: Texturen unverändert (linear) durchreichen = so hell wie im Original. Zusätzlich "brightness" pro Karte (Standard 1).
        ms.forEach(m => {
            if (!m) return;
            if (entry.srgbFix !== false) for (const k in m) { const t = m[k]; if (t && t.isTexture && t.encoding !== THREE.LinearEncoding) { t.encoding = THREE.LinearEncoding; t.needsUpdate = true; } }
            if (m.color && entry.brightness && entry.brightness !== 1) m.color.multiplyScalar(entry.brightness);
            m.needsUpdate = true;
        });
    });

    // Große Meshes in Kacheln teilen
    const CELL = entry.chunk || 16;
    const big = [];
    root.traverse((o) => { if (o.isMesh && o.visible && triCount(o) > 1500) big.push(o); });
    if (big.length) {
        const chunks = new THREE.Group();
        chunks.name = 'map-chunks';
        target.add(chunks);
        for (const mesh of big) chunkMesh(mesh, CELL, chunks);
    }
    target.updateMatrixWorld(true);

    const meshes = [];
    target.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
    bbox = new THREE.Box3();
    meshes.forEach(m => { m.geometry.computeBoundingBox(); bbox.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); });
    onProgress(0.93);
    await new Promise(r => setTimeout(r, 0));

    // Kollision
    const t0 = performance.now();
    const colliders = buildColliders(meshes, bbox, entry.voxel || 0.5, entry.wallSlope || 0.7);
    const size3 = bbox.getSize(new THREE.Vector3());
    // Unsichtbare Außengrenze (hoch und dick), damit man nicht aus der Karte läuft
    const T = 3, H = 150, y0 = bbox.min.y - 20;
    const B = (x0, z0, x1, z1) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y0 + H, z1));
    colliders.push(
        B(bbox.min.x - T - 1, bbox.min.z - T - 1, bbox.max.x + T + 1, bbox.min.z - 1),
        B(bbox.min.x - T - 1, bbox.max.z + 1, bbox.max.x + T + 1, bbox.max.z + T + 1),
        B(bbox.min.x - T - 1, bbox.min.z - 1, bbox.min.x - 1, bbox.max.z + 1),
        B(bbox.max.x + 1, bbox.min.z - 1, bbox.max.x + T + 1, bbox.max.z + 1));
    onProgress(0.97);
    await new Promise(r => setTimeout(r, 0));

    // Spawns: Objekte im Modell > entry.spawns > automatisch
    let spawns = spawnFromNodes.map(s => ({ x: s.x, y: s.y + EYE, z: s.z }));
    if (!spawns.length && Array.isArray(entry.spawns) && entry.spawns.length) spawns = entry.spawns.map(a => ({ x: a[0], y: a[1], z: a[2] }));
    let spawnSource = spawns.length ? 'Modell/Manifest' : 'automatisch';
    if (!spawns.length) spawns = autoSpawns(meshes, bbox, colliders);

    // Licht + Himmel (das Modell bringt meist keins mit)
    if (entry.lighting !== 'none') {
        adapter.add(new THREE.AmbientLight(0xffffff, entry.ambient ?? 0.8));
        adapter.add(new THREE.HemisphereLight(0xcfe3ff, 0x6a5a48, entry.hemisphere ?? 0.9));
        const sun = new THREE.DirectionalLight(0xfff1d8, entry.sun ?? 1.1);
        sun.position.set(60, 120, 40);
        adapter.add(sun);
    }
    const bg = new THREE.Color(entry.background || '#9fc5e8');
    adapter.background = bg;
    adapter.fog = entry.fog === false ? null : new THREE.FogExp2(bg.getHex(), entry.fogDensity ?? 0.0022);

    colliders.spawnPoints = spawns;
    colliders.groundMeshes = meshes;
    colliders.shootBlockers = meshes;
    colliders.skyboxGroup = null;
    colliders.portalRings = [];
    colliders.groundStepUp = 0.6;               // Boden-Raycast startet nur knapp über den Füßen (sonst steht man in Gebäuden auf dem Dach)
    colliders.killY = bbox.min.y - 40;
    colliders.info = {
        name: entry.name, scale, size: [size3.x, size3.y, size3.z],
        meshes: meshes.length, colliders: colliders.length, voxel: colliders.voxelSize, spawns: spawns.length, spawnSource,
        ms: Math.round(performance.now() - t0)
    };
    console.info('[Karte]', entry.name, colliders.info);
    onProgress(1);
    return colliders;
}
