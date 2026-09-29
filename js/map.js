// map.js — "Neon Vault Megaplex (Open Sniper Arena Layout)"
// Basiert exakt auf der Vogelperspektive: Freie Sichtlinien, 4 erhoehte Sniper-Tuerme (T),
// Spawn-Zonen (C) an den Raendern und Portal-Tore (G).

const TILE_SIZE = 3.0;
const WALL_HEIGHT = 5.0;

// Grid-Legende (121 x 33 Tiles ~ 363m x 99m, jede Zeile exakt 121 Zeichen breit — sonst fehlen
// Wände am Rand und die Spawns liegen ausserhalb der Karte):
// # = Aussenwand | . = Offenes Spielfeld | G = Portal-Tor
// L = Pinker Pfeiler | E = Gruener Pfeiler | C = Spawn-Punkt | T = Erhoehte Sniper-Plattform
const NEON_VAULT_GRID = [
    "#".repeat(121),
    "#" + "C...L...C.....................................................................................................C...L...C" + "#",
    "#" + ".........#.......#######.......G.......#######.............T.............#######.......G.......#######.......#........." + "#",
    "#" + "..L...E..#.......#.....#...............#.....#...........................#.....#...............#.....#.......#..E...L.." + "#",
    "#" + ".........#.......#.....#...............#.....#...........................#.....#...............#.....#.......#........." + "#",
    "#" + "C........G.......#.....#...............#.....#.............T.............#.....#...............#.....#.......G........C" + "#",
    "#" + ".........#.......#######...............#######...........................#######...............#######.......#........." + "#",
    "#" + "......................................................................................................................." + "#",
    "#" + "....E........................G.............................G.............................G........................E...." + "#",
    "#" + "......................................................................................................................." + "#",
    "#" + "##########.......#######.......................................................................#######.......##########" + "#",
    "#" + "#........#.......#.....#.......................................................................#.....#.......#........#" + "#",
    "#" + "#..C..L..G.......G..T..#...................T...................................T...............#..T..G.......G..L..C..#" + "#",
    "#" + "#........#.......#.....#.......................................................................#.....#.......#........#" + "#",
    "#" + "##########.......#######.......................................................................#######.......##########" + "#",
    "#" + "......................................................................................................................." + "#",
    "#" + "C.......L........G...................................................................................G........L.......C" + "#",
    "#" + "......................................................................................................................." + "#",
    "#" + "##########.......#######.......................................................................#######.......##########" + "#",
    "#" + "#........#.......#.....#.......................................................................#.....#.......#........#" + "#",
    "#" + "#..C..L..G.......G..T..#...................T...................................T...............#..T..G.......G..L..C..#" + "#",
    "#" + "#........#.......#.....#.......................................................................#.....#.......#........#" + "#",
    "#" + "##########.......#######.......................................................................#######.......##########" + "#",
    "#" + "......................................................................................................................." + "#",
    "#" + "....E........................G.............................G.............................G........................E...." + "#",
    "#" + "......................................................................................................................." + "#",
    "#" + ".........#.......#######...............#######...........................#######...............#######.......#........." + "#",
    "#" + "C........G.......#.....#...............#.....#.............T.............#.....#...............#.....#.......G........C" + "#",
    "#" + ".........#.......#.....#...............#.....#...........................#.....#...............#.....#.......#........." + "#",
    "#" + "..L...E..#.......#.....#...............#.....#...........................#.....#...............#.....#.......#..E...L.." + "#",
    "#" + ".........#.......#######.......G.......#######.............T.............#######.......G.......#######.......#........." + "#",
    "#" + "C...L...C.....................................................................................................C...L...C" + "#",
    "#".repeat(121)
];

export function setupMap(scene) {
    const colliders = [];
    const spawnPoints = [];
    const groundMeshes = [];

    const rows = NEON_VAULT_GRID.length;
    const cols = NEON_VAULT_GRID[0].length;

    const halfWidth = (cols * TILE_SIZE) / 2;
    const halfDepth = (rows * TILE_SIZE) / 2;

    // --- Atmosphaere & Beleuchtung ---
    scene.background = new THREE.Color(0x010106);
    scene.fog = new THREE.FogExp2(0x010106, 0.005);
    scene.add(new THREE.AmbientLight(0x202844, 1.8));
    scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x0a0a12, 1.0));

    const dirLight = new THREE.DirectionalLight(0x6677aa, 1.2);
    dirLight.position.set(30, 90, 30);
    scene.add(dirLight);

    // --- Sternenhimmel & Ringplanet (Skybox) ---
    const skyboxGroup = new THREE.Group();

    const starCount = 3000;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        const radius = 1800 + Math.random() * 400;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        starPositions[i * 3 + 1] = Math.abs(radius * Math.sin(phi) * Math.sin(theta)) + 50;
        starPositions[i * 3 + 2] = radius * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false });
    skyboxGroup.add(new THREE.Points(starGeo, starMat));

    const planetGroup = new THREE.Group();
    const planetMat = new THREE.MeshStandardMaterial({
        color: 0x3a4a66, roughness: 0.9, emissive: 0x111a2e, emissiveIntensity: 0.6, fog: false
    });
    planetGroup.add(new THREE.Mesh(new THREE.SphereGeometry(260, 32, 32), planetMat));

    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x8fd6ff, side: THREE.DoubleSide, transparent: true, opacity: 0.45, fog: false
    });
    const ringMesh = new THREE.Mesh(new THREE.RingGeometry(360, 520, 64), ringMat);
    ringMesh.rotation.x = Math.PI * 0.55;
    ringMesh.rotation.z = 0.3;
    planetGroup.add(ringMesh);

    planetGroup.position.set(1200, 650, -2000);
    skyboxGroup.add(planetGroup);
    scene.add(skyboxGroup);

    // --- Boden & Raster ---
    const floorGeo = new THREE.PlaneGeometry(cols * TILE_SIZE, rows * TILE_SIZE);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x06060c, roughness: 0.95, metalness: 0.1 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    groundMeshes.push(floor);

    const gridHelper = new THREE.GridHelper(Math.max(cols, rows) * TILE_SIZE, 80, 0x00f0ff, 0x0d0d22);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    function worldPos(col, row) {
        return {
            x: (col * TILE_SIZE) - halfWidth + TILE_SIZE / 2,
            z: (row * TILE_SIZE) - halfDepth + TILE_SIZE / 2
        };
    }

    const COLLIDER_PADDING = 0.15;
    function addBox3Collider(x, y, z, width, height, depth) {
        const box = new THREE.Box3();
        box.setFromCenterAndSize(
            new THREE.Vector3(x, y, z),
            new THREE.Vector3(width + COLLIDER_PADDING * 2, height, depth + COLLIDER_PADDING * 2)
        );
        colliders.push(box);
    }

    // --- Materialien ---
    // Die Körper der Blöcke sind matt und dunkel, es leuchten nur die KANTEN (siehe addEdgeBeams).
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x06060e, roughness: 0.8 });
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x0a1018, roughness: 0.9 });
    const pinkPillarMat = new THREE.MeshStandardMaterial({ color: 0x180a10, roughness: 0.9 });
    const greenPillarMat = new THREE.MeshStandardMaterial({ color: 0x0a180a, roughness: 0.9 });
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x0d0d1a, roughness: 0.9 });

    // Leuchtende Kanten: MeshBasicMaterial = ungelitten (billig zu rendern, unabhängig von Lichtern),
    // der Bloom-Effekt lässt sie trotzdem schön glühen.
    const beamCyan = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const beamPink = new THREE.MeshBasicMaterial({ color: 0xff0055 });
    const beamGreen = new THREE.MeshBasicMaterial({ color: 0x00ff66 });
    const beamPurple = new THREE.MeshBasicMaterial({ color: 0x9d00ff });

    const wallPos = [], gatePos = [], pinkPos = [], greenPos = [], towerPos = [];

    for (let r = 0; r < rows; r++) {
        const line = NEON_VAULT_GRID[r];
        for (let c = 0; c < cols; c++) {
            const char = line[c];
            const { x, z } = worldPos(c, r);

            if (char === '#') {
                wallPos.push({ x, z });
                addBox3Collider(x, WALL_HEIGHT / 2, z, TILE_SIZE, WALL_HEIGHT, TILE_SIZE);
            } else if (char === 'G') {
                gatePos.push({ x, z });
            } else if (char === 'L') {
                pinkPos.push({ x, z });
                addBox3Collider(x, WALL_HEIGHT / 2, z, TILE_SIZE * 0.5, WALL_HEIGHT, TILE_SIZE * 0.5);
            } else if (char === 'E') {
                greenPos.push({ x, z });
                addBox3Collider(x, WALL_HEIGHT / 2, z, TILE_SIZE * 0.5, WALL_HEIGHT, TILE_SIZE * 0.5);
            } else if (char === 'C') {
                spawnPoints.push({ x, y: 2, z });
            } else if (char === 'T') {
                towerPos.push({ x, z });
            }
        }
    }

    // --- InstancedMeshes ---
    const dummy = new THREE.Object3D();
    function createInstancedMesh(geometry, material, positions, scale = { x: 1, y: 1, z: 1 }, yPos = WALL_HEIGHT / 2) {
        if (positions.length === 0) return;
        const instancedMesh = new THREE.InstancedMesh(geometry, material, positions.length);
        positions.forEach((pos, idx) => {
            dummy.position.set(pos.x, yPos, pos.z);
            dummy.scale.set(scale.x, scale.y, scale.z);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(idx, dummy.matrix);
        });
        instancedMesh.instanceMatrix.needsUpdate = true;
        // Wichtig: Culling nutzt sonst nur die Bounding-Sphere EINER Instanz am Weltursprung -> ganze
        // Wand-/Turm-Gruppen würden verschwinden, sobald man vom Kartenmittelpunkt wegschaut.
        instancedMesh.frustumCulled = false;
        scene.add(instancedMesh);
        return instancedMesh;
    }

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);

    // Leuchtende Kanten für Blöcke: 12 dünne Balken pro Block, als InstancedMesh (ein Draw-Call je Farbe).
    function addEdgeBeams(positions, size, yCenter, material, t = 0.1) {
        if (positions.length === 0) return;
        const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2;
        const beams = [];
        positions.forEach(p => {
            for (const sy of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    beams.push({ x: p.x, y: yCenter + sy * hy, z: p.z + sz * hz, sx: size.x + t, sy: t, sz: t }); // entlang X
                }
            }
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    beams.push({ x: p.x + sx * hx, y: yCenter, z: p.z + sz * hz, sx: t, sy: size.y + t, sz: t }); // senkrecht
                }
            }
            for (const sx of [-1, 1]) {
                for (const sy of [-1, 1]) {
                    beams.push({ x: p.x + sx * hx, y: yCenter + sy * hy, z: p.z, sx: t, sy: t, sz: size.z + t }); // entlang Z
                }
            }
        });
        const mesh = new THREE.InstancedMesh(boxGeo, material, beams.length);
        beams.forEach((b, i) => {
            dummy.position.set(b.x, b.y, b.z);
            dummy.scale.set(b.sx, b.sy, b.sz);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        scene.add(mesh);
    }

    createInstancedMesh(boxGeo, wallMat, wallPos, { x: TILE_SIZE, y: WALL_HEIGHT, z: TILE_SIZE });
    createInstancedMesh(boxGeo, gateMat, gatePos, { x: TILE_SIZE * 0.9, y: WALL_HEIGHT * 0.85, z: 0.2 });
    createInstancedMesh(boxGeo, pinkPillarMat, pinkPos, { x: TILE_SIZE * 0.5, y: WALL_HEIGHT, z: TILE_SIZE * 0.5 });
    createInstancedMesh(boxGeo, greenPillarMat, greenPos, { x: TILE_SIZE * 0.5, y: WALL_HEIGHT, z: TILE_SIZE * 0.5 });

    addEdgeBeams(gatePos, { x: TILE_SIZE * 0.9, y: WALL_HEIGHT * 0.85, z: 0.2 }, WALL_HEIGHT / 2, beamCyan, 0.08);
    addEdgeBeams(pinkPos, { x: TILE_SIZE * 0.5, y: WALL_HEIGHT, z: TILE_SIZE * 0.5 }, WALL_HEIGHT / 2, beamPink, 0.07);
    addEdgeBeams(greenPos, { x: TILE_SIZE * 0.5, y: WALL_HEIGHT, z: TILE_SIZE * 0.5 }, WALL_HEIGHT / 2, beamGreen, 0.07);

    // --- Portal-Ringe an Gates ---
    const portalRings = [];
    const portalRingMat = new THREE.MeshStandardMaterial({
        color: 0x0a1018, roughness: 0.75, emissive: 0x00f0ff, emissiveIntensity: 3.0
    });
    gatePos.forEach(pos => {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(TILE_SIZE * 0.6, 0.1, 8, 24),
            portalRingMat
        );
        ring.position.set(pos.x, WALL_HEIGHT * 0.5, pos.z);
        scene.add(ring);
        portalRings.push(ring);
    });

    // --- Erhoehte Sniper-Tuerme (T) ---
    // Tuerme sind hoch (Höhe = 6.0 Einheiten), damit man als Sniper das gesamte Feld überblicken kann
    const TOWER_HEIGHT = 6.0;
    if (towerPos.length > 0) {
        const towerMesh = createInstancedMesh(
            boxGeo,
            towerMat,
            towerPos,
            { x: TILE_SIZE * 1.8, y: TOWER_HEIGHT, z: TILE_SIZE * 1.8 },
            TOWER_HEIGHT / 2
        );
        groundMeshes.push(towerMesh);

        // Kollsion fuer die Turmseiten hinzufügen
        towerPos.forEach(pos => {
            addBox3Collider(pos.x, TOWER_HEIGHT / 2, pos.z, TILE_SIZE * 1.8, TOWER_HEIGHT, TILE_SIZE * 1.8);
        });

        addEdgeBeams(towerPos, { x: TILE_SIZE * 1.8, y: TOWER_HEIGHT, z: TILE_SIZE * 1.8 }, TOWER_HEIGHT / 2, beamCyan, 0.16);
    }

    // --- Deckungskisten im Zentrum ---
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x0a0a14, roughness: 0.9 });
    const cratePositions = [];
    for (let x = -110; x <= 110; x += 22) {
        for (let z = -30; z <= 30; z += 18) {
            if (Math.abs(x) < 15 && Math.abs(z) < 15) continue;
            const cx = x + (Math.sin(x + z) * 3);
            const cz = z + (Math.cos(x * z) * 3);

            // Kisten, die in einer Wand/einem Turm/Pfeiler (oder einer anderen Kiste) stecken würden, weglassen
            const crateBox = new THREE.Box3();
            crateBox.setFromCenterAndSize(
                new THREE.Vector3(cx, 0.7, cz),
                new THREE.Vector3(1.8 + COLLIDER_PADDING * 2, 1.4, 1.8 + COLLIDER_PADDING * 2)
            );
            if (colliders.some(c => c.intersectsBox(crateBox))) continue;

            cratePositions.push({ x: cx, z: cz });
            addBox3Collider(cx, 0.7, cz, 1.8, 1.4, 1.8);
        }
    }
    createInstancedMesh(boxGeo, crateMat, cratePositions, { x: 1.8, y: 1.4, z: 1.8 }, 0.7);
    addEdgeBeams(cratePositions, { x: 1.8, y: 1.4, z: 1.8 }, 0.7, beamPurple, 0.07);

    // --- Rampen zu den Sniper-Türmen (statt Treppen) ---
    // Jeder Turm bekommt automatisch eine Rampe, die oben exakt auf Turmhöhe endet. Die Rampe wird
    // an einer freien Seite platziert (bevorzugt Richtung Kartenmitte, nie in Wänden/Kisten/Pfeilern).
    // Sie hat keinen Collider: der Bodenraycast in main.js lässt den Spieler die Schräge hochlaufen.
    const RAMP_WIDTH = TILE_SIZE * 1.5;
    const TOWER_HALF = (TILE_SIZE * 1.8) / 2;

    // Keil-Geometrie (Einheitsgröße: Länge 1 entlang +X, Höhe 1, Breite 1), wird per Instanz skaliert
    function createRampGeometry() {
        const A = [0, 0, -0.5], B = [0, 0, 0.5], C = [1, 0, -0.5];
        const D = [1, 0, 0.5], E = [1, 1, -0.5], F = [1, 1, 0.5];
        const tris = [
            [A, B, F], [A, F, E],   // Schräge (Oberseite)
            [C, E, F], [C, F, D],   // Rückwand am Turm
            [B, D, F], [A, E, C],   // Seiten
            [A, C, D], [A, D, B]    // Unterseite
        ];
        const arr = [];
        tris.forEach(t => t.forEach(v => arr.push(v[0], v[1], v[2])));
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
        g.computeVertexNormals();
        return g;
    }

    // out = Richtung, in die sich die Rampe vom Turm weg erstreckt; rotY dreht den Keil so, dass er zum Turm hin ansteigt
    const RAMP_DIRS = [
        { out: { x: -1, z: 0 }, rotY: 0 },
        { out: { x: 1, z: 0 }, rotY: Math.PI },
        { out: { x: 0, z: -1 }, rotY: -Math.PI / 2 },
        { out: { x: 0, z: 1 }, rotY: Math.PI / 2 }
    ];

    // Grundfläche der Rampe (ohne die letzten 0.6 direkt am Turm, dort liegt dessen eigener Collider an,
    // dafür mit 1.5 Einheiten freiem Platz vor dem Rampenfuß, damit dort keine Kiste/Wand im Weg steht)
    function rampFootprint(t, out, len) {
        const near = TOWER_HALF + 0.6;
        const far = TOWER_HALF + len + 1.5;
        const along = (near + far) / 2;
        const extent = far - near;
        const box = new THREE.Box3();
        box.setFromCenterAndSize(
            new THREE.Vector3(t.x + out.x * along, 1.5, t.z + out.z * along),
            new THREE.Vector3(out.x !== 0 ? extent : RAMP_WIDTH, 2, out.z !== 0 ? extent : RAMP_WIDTH)
        );
        return box;
    }

    const rampInstances = [];
    const placedRampBoxes = [];
    const unreachableTowers = [];

    towerPos.forEach(t => {
        // Richtungen sortieren: zuerst die, deren Rampe Richtung Kartenmitte zeigt
        const towardCenter = (d) => d.out.x * -t.x + d.out.z * -t.z;
        const dirs = RAMP_DIRS.slice().sort((d1, d2) => towardCenter(d2) - towardCenter(d1));

        for (const len of [16, 12]) { // 16 lang = ca. 20° Steigung, sonst steilere 12er-Rampe
            for (const d of dirs) {
                const box = rampFootprint(t, d.out, len);
                if (colliders.some(c => c.intersectsBox(box))) continue;
                if (placedRampBoxes.some(b => b.intersectsBox(box))) continue;

                placedRampBoxes.push(box);
                const reach = TOWER_HALF + len - 0.05; // Rampenende ragt 5 cm in den Turm (keine Lücke)
                rampInstances.push({ x: t.x + d.out.x * reach, z: t.z + d.out.z * reach, rotY: d.rotY, len });
                return;
            }
        }
        unreachableTowers.push(t);
    });

    if (rampInstances.length > 0) {
        // Matt und dunkel: kein Glanz, kein Leuchten
        const rampMat = new THREE.MeshStandardMaterial({ color: 0x1b1b28, roughness: 1.0, metalness: 0.0 });
        const rampMesh = new THREE.InstancedMesh(createRampGeometry(), rampMat, rampInstances.length);
        rampInstances.forEach((r, i) => {
            dummy.position.set(r.x, 0, r.z);
            dummy.rotation.set(0, r.rotY, 0);
            dummy.scale.set(r.len, TOWER_HEIGHT, RAMP_WIDTH);
            dummy.updateMatrix();
            rampMesh.setMatrixAt(i, dummy.matrix);
        });
        dummy.rotation.set(0, 0, 0);
        rampMesh.instanceMatrix.needsUpdate = true;
        rampMesh.frustumCulled = false;
        scene.add(rampMesh);
        groundMeshes.push(rampMesh);
    }
    if (unreachableTowers.length > 0) {
        console.warn(`${unreachableTowers.length} Turm/Türme ohne freie Rampen-Seite:`, unreachableTowers);
    }

    // --- Zonen-Beleuchtung ---
    const zoneColors = [0xff0055, 0x00f0ff, 0x9d00ff, 0x00ff66];
    const zoneXPositions = [-120, -40, 40, 120];
    const zoneZPositions = [-25, 25];

    let colorIdx = 0;
    zoneXPositions.forEach(x => {
        zoneZPositions.forEach(z => {
            const pLight = new THREE.PointLight(zoneColors[colorIdx % zoneColors.length], 5.0, 120.0);
            pLight.position.set(x, WALL_HEIGHT, z);
            scene.add(pLight);
            colorIdx++;
        });
    });

    colliders.spawnPoints = spawnPoints;
    colliders.groundMeshes = groundMeshes;
    colliders.skyboxGroup = skyboxGroup;
    colliders.portalRings = portalRings;
    colliders.rampStats = { placed: rampInstances.length, total: towerPos.length };
    colliders.ramps = rampInstances;
    return colliders;
}
