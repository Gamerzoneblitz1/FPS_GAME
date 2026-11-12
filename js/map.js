// map.js — "Neon Vault Italy" (Nachbau von CS2 Italy im Neon-Look)
// Portrait-Karte: T-Spawn oben, CT-Spawn unten. Zonen: T Stairs, Long, Mid, Cellars, Left/Right Street,
// Below Stairs, Roof/Bedroom, House, Tunnel, Market, CT Left / CT Right.
// Hoehen: Podeste (P), Daecher/Emporen (R) und Rampen (< > ^ v) – siehe Legende.

const TILE_SIZE = 3.0;
const WALL_HEIGHT = 6.0;   // hoeher als Daecher + Sprunghoehe, damit man nicht ueber Waende huepfen kann
const PLAT_H = 1.4;        // Podest (per Sprung erreichbar: Mid Boost, Green Boxes ...)
const ROOF_H = 2.8;        // Dach/Empore (Zugang ueber Rampen)

// Grid-Legende (70 x 96 Tiles = 210m x 288m, jede Zeile exakt 70 Zeichen — server.js liest die 'C' als Spawns):
// # = Wand | . = Boden | B = Kiste (Deckung) | L = Pinker Pfeiler | E = Gruener Pfeiler | C = Spawn
// P = Podest 1.4 m | R = Dach/Empore 2.8 m | < > ^ v = Rampe, steigt in Pfeilrichtung (muss an P/R enden)
const NEON_VAULT_GRID = [
    "######################################################################",
    "################################.......##########..........###########",
    "################################.......##########..........###########",
    "################################.......##########..........###########",
    "################################...........................###########",
    "################################...........................###########",
    "################################........C.......C..........###########",
    "################################...........................###########",
    "################################....C.......C....PPPPPPPPP..##########",
    "################################...............>>PPPPPPPPP..##########",
    "################################...............>>PPPPPPPPP..##########",
    "####################.............................PPPPPPPPP..##########",
    "####################...L..B.........C...C.....B.CPPPPPPPPP..##########",
    "####################.............................PPPPPPPPP..##########",
    "####################........................C.............B.##########",
    "####################....###########....##########.........############",
    "####################....#.........#....###########.......#############",
    "####################....#.........#....###########.......#############",
    "####################....#.........#....###########.......#############",
    "####################....#.........#....###########.......#############",
    "####################....#B.............###########.......#############",
    "####################....#..............###########.......#############",
    "####################...................###########.......#############",
    "####################..............#....###########.......#############",
    "####################..............#....###########.......#############",
    "####################....#.........#....###########.......#############",
    "#######RRRRRRRRRRRRR....#.........#....###########.......#############",
    "#######RRRRRRRRRRRRR....#.........#....###########.......#############",
    "#######RRRRRRRRRRRRR....#.........#....###########.......#############",
    "#######RRRRRRRRRRRRR....#.........#....###########.......#############",
    "#######RRRRRRRRRRRRR...E###########....###########.......#############",
    "#######.^^^............................###########.......#############",
    "#######.^^^............................###########.......#############",
    "#######.^^^............................###########.......#############",
    "#######.^^^............................###########.......#############",
    "#######................................###########.......#############",
    "#######......###RRRRR<<<<........................#.......#############",
    "#######......###RRRRR<<<<........................#.......#############",
    "#######......###RRRRR<<<<........................#.......#############",
    "#######......###RRRRR<<<<........................#.......#############",
    "#######..B...##########.....###########B.PPPPP...#.......#############",
    "#######......##########.....###########..PPPPP...#.......#############",
    "#######......##########.....###########..........#.......#############",
    "#######......##########........########..........#.......#############",
    "#######......##########........##########........PPPP.......##########",
    "#######......##########........##########........PPPP.......##########",
    "#######......##########........##########......B............##########",
    "#######......##########........############......#####################",
    "#######......##########........############......#####################",
    "#######......############...###############......#####################",
    "#######....B.......######...###############......#####################",
    "#######............######...###############......#####################",
    "#######............######...###############......#######........######",
    "#######................##...###############......#######........######",
    "##################..........#############.......................######",
    "##################..........#############.......................######",
    "##################..........####...######.......................######",
    "##################..........####...######................PPPP...######",
    "##################..........####...######..............>>PPPP...######",
    "##################..........####...######..............>>PPPP...######",
    "##################.....#########....................L....PPPP...######",
    "##################.....#########................................######",
    "##################.....########...........................BB....######",
    "##################.....#######.....######.............BB..BB....######",
    "##################.....#######.....######.............BB........######",
    "##################.....######......######...................##########",
    "##################.....######......######...............BB..##########",
    "##################.....#####......#######........BB.....BB..##########",
    "##################......####......#######........BB.........##########",
    "##################......####.....#####################################",
    "###################.....###......#####################################",
    "###################......##......#####################################",
    "###################......#......######################################",
    "####################............######################################",
    "####################...........#######################################",
    "#####################..........#######################################",
    "#####################.........########################################",
    "#####################.........########################################",
    "#####################........#########################################",
    "#####################........#########################################",
    "#####################.....L..#########################################",
    "#####################........#########################################",
    "################..............########################################",
    "################..............########################################",
    "################..............########################################",
    "################..C..C..C..C..########################################",
    "################..............########################################",
    "################..............########################################",
    "################...B......B...########################################",
    "################..............########################################",
    "################..C..C..C..C..########################################",
    "################.......B......########################################",
    "################..............########################################",
    "######################################################################",
    "######################################################################",
    "######################################################################"
];

const RAMP_DIRS = { '<': { dx: -1, dz: 0 }, '>': { dx: 1, dz: 0 }, '^': { dx: 0, dz: -1 }, 'v': { dx: 0, dz: 1 } };

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
    scene.fog = new THREE.FogExp2(0x010106, 0.012);
    scene.add(new THREE.AmbientLight(0x202844, 2.2));
    scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x0a0a12, 1.2));
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
    skyboxGroup.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false })));

    const planetGroup = new THREE.Group();
    planetGroup.add(new THREE.Mesh(new THREE.SphereGeometry(260, 32, 32), new THREE.MeshStandardMaterial({
        color: 0x3a4a66, roughness: 0.9, emissive: 0x111a2e, emissiveIntensity: 0.6, fog: false
    })));
    const ringMesh = new THREE.Mesh(new THREE.RingGeometry(360, 520, 64), new THREE.MeshBasicMaterial({
        color: 0x8fd6ff, side: THREE.DoubleSide, transparent: true, opacity: 0.45, fog: false
    }));
    ringMesh.rotation.x = Math.PI * 0.55;
    ringMesh.rotation.z = 0.3;
    planetGroup.add(ringMesh);
    planetGroup.position.set(1200, 650, -2000);
    skyboxGroup.add(planetGroup);
    scene.add(skyboxGroup);

    // --- Boden & Raster ---
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(cols * TILE_SIZE, rows * TILE_SIZE),
        new THREE.MeshStandardMaterial({ color: 0x06060c, roughness: 0.95, metalness: 0.1 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    groundMeshes.push(floor);

    const gridHelper = new THREE.GridHelper(Math.max(cols, rows) * TILE_SIZE, 96, 0x00f0ff, 0x0d0d22);
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

    // --- Unsichtbare Grenzwände (verhindert Rausspringen über die Außenwand) ---
    const BOUNDARY_HEIGHT = 60;
    addBox3Collider(0, BOUNDARY_HEIGHT / 2, -halfDepth, cols * TILE_SIZE + 4, BOUNDARY_HEIGHT, 1);
    addBox3Collider(0, BOUNDARY_HEIGHT / 2, halfDepth, cols * TILE_SIZE + 4, BOUNDARY_HEIGHT, 1);
    addBox3Collider(-halfWidth, BOUNDARY_HEIGHT / 2, 0, 1, BOUNDARY_HEIGHT, rows * TILE_SIZE + 4);
    addBox3Collider(halfWidth, BOUNDARY_HEIGHT / 2, 0, 1, BOUNDARY_HEIGHT, rows * TILE_SIZE + 4);

    // --- Materialien ---
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0b0b16, roughness: 0.8 });
    const pinkPillarMat = new THREE.MeshStandardMaterial({ color: 0x180a10, roughness: 0.9 });
    const greenPillarMat = new THREE.MeshStandardMaterial({ color: 0x0a180a, roughness: 0.9 });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x0a0a14, roughness: 0.9 });
    const beamCyan = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const beamPink = new THREE.MeshBasicMaterial({ color: 0xff0055 });
    const beamGreen = new THREE.MeshBasicMaterial({ color: 0x00ff66 });
    const beamPurple = new THREE.MeshBasicMaterial({ color: 0x9d00ff });
    const beamOrange = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

    const wallPos = [], pinkPos = [], greenPos = [], cratePos = [], platPos = [], roofPos = [], rampTiles = [];
    const CRATE = TILE_SIZE * 0.6, CRATE_H = 1.5;

    for (let r = 0; r < rows; r++) {
        const line = NEON_VAULT_GRID[r];
        for (let c = 0; c < cols; c++) {
            const char = line[c];
            const { x, z } = worldPos(c, r);
            if (char === '#') {
                // Nur Wände zeichnen, die an begehbaren Boden grenzen (spart tausende unsichtbare Instanzen)
                const near = (dr, dc) => { const rw = NEON_VAULT_GRID[r + dr]; return rw && rw[c + dc] !== undefined && rw[c + dc] !== '#'; };
                let visible = false;
                for (let dr = -1; dr <= 1 && !visible; dr++) for (let dc = -1; dc <= 1; dc++) if (near(dr, dc)) { visible = true; break; }
                if (!visible) continue;
                wallPos.push({ x, z });
                addBox3Collider(x, WALL_HEIGHT / 2, z, TILE_SIZE, WALL_HEIGHT, TILE_SIZE);
            } else if (char === 'L') {
                pinkPos.push({ x, z });
                addBox3Collider(x, WALL_HEIGHT / 2, z, TILE_SIZE * 0.5, WALL_HEIGHT, TILE_SIZE * 0.5);
            } else if (char === 'E') {
                greenPos.push({ x, z });
                addBox3Collider(x, WALL_HEIGHT / 2, z, TILE_SIZE * 0.5, WALL_HEIGHT, TILE_SIZE * 0.5);
            } else if (char === 'B') {
                cratePos.push({ x, z });
                addBox3Collider(x, CRATE_H / 2, z, CRATE, CRATE_H, CRATE);
            } else if (char === 'C') {
                spawnPoints.push({ x, y: 2, z });
            } else if (char === 'P' || char === 'R') {
                const h = char === 'P' ? PLAT_H : ROOF_H;
                (char === 'P' ? platPos : roofPos).push({ x, z });
                // Collider endet 0.4 unter der Oberkante (wie bei den alten Tuermen): Rampenende und Landung ruckeln nicht
                addBox3Collider(x, (h - 0.4) / 2, z, TILE_SIZE, h - 0.4, TILE_SIZE);
            } else if (RAMP_DIRS[char]) {
                rampTiles.push({ r, c, x, z, ch: char });
            }
        }
    }

    // --- InstancedMeshes ---
    const dummy = new THREE.Object3D();
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    function createInstancedMesh(geometry, material, positions, scale, yPos) {
        if (positions.length === 0) return null;
        const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
        positions.forEach((pos, idx) => {
            dummy.position.set(pos.x, yPos, pos.z);
            dummy.scale.set(scale.x, scale.y, scale.z);
            dummy.updateMatrix();
            mesh.setMatrixAt(idx, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        scene.add(mesh);
        return mesh;
    }

    // Leuchtende Kanten (12 dünne Balken pro Block, ein Draw-Call je Farbe)
    function addEdgeBeams(positions, size, yCenter, material, t = 0.1) {
        if (positions.length === 0) return;
        const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2;
        const beams = [];
        positions.forEach(p => {
            for (const sy of [-1, 1]) for (const sz of [-1, 1]) beams.push({ x: p.x, y: yCenter + sy * hy, z: p.z + sz * hz, sx: size.x + t, sy: t, sz: t });
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) beams.push({ x: p.x + sx * hx, y: yCenter, z: p.z + sz * hz, sx: t, sy: size.y + t, sz: t });
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) beams.push({ x: p.x + sx * hx, y: yCenter + sy * hy, z: p.z, sx: t, sy: t, sz: size.z + t });
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

    const shootBlockers = [];
    const pillarSize = { x: TILE_SIZE * 0.5, y: WALL_HEIGHT, z: TILE_SIZE * 0.5 };
    const wallMesh = createInstancedMesh(boxGeo, wallMat, wallPos, { x: TILE_SIZE, y: WALL_HEIGHT, z: TILE_SIZE }, WALL_HEIGHT / 2);
    const pinkMesh = createInstancedMesh(boxGeo, pinkPillarMat, pinkPos, pillarSize, WALL_HEIGHT / 2);
    const greenMesh = createInstancedMesh(boxGeo, greenPillarMat, greenPos, pillarSize, WALL_HEIGHT / 2);
    const crateSize = { x: CRATE, y: CRATE_H, z: CRATE };
    const crateMesh = createInstancedMesh(boxGeo, crateMat, cratePos, crateSize, CRATE_H / 2);
    [wallMesh, pinkMesh, greenMesh, crateMesh].forEach(m => { if (m) shootBlockers.push(m); });
    if (crateMesh) groundMeshes.push(crateMesh); // draufstehen moeglich

    // Wand-Kanten: nur die Oberkante als leuchtender Streifen (guenstig, gibt Zonen-Look)
    addEdgeBeams(wallPos, { x: TILE_SIZE, y: WALL_HEIGHT, z: TILE_SIZE }, WALL_HEIGHT / 2, beamCyan, 0.05);
    addEdgeBeams(pinkPos, pillarSize, WALL_HEIGHT / 2, beamPink, 0.07);
    addEdgeBeams(greenPos, pillarSize, WALL_HEIGHT / 2, beamGreen, 0.07);
    addEdgeBeams(cratePos, crateSize, CRATE_H / 2, beamPurple, 0.06);

    // --- Podeste & Daecher ---
    const platMat = new THREE.MeshStandardMaterial({ color: 0x10101c, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x140c18, roughness: 0.9 });
    const platSize = { x: TILE_SIZE, y: PLAT_H, z: TILE_SIZE };
    const roofSize = { x: TILE_SIZE, y: ROOF_H, z: TILE_SIZE };
    const platMesh = createInstancedMesh(boxGeo, platMat, platPos, platSize, PLAT_H / 2);
    const roofMesh = createInstancedMesh(boxGeo, roofMat, roofPos, roofSize, ROOF_H / 2);
    [platMesh, roofMesh].forEach(m => { if (m) { groundMeshes.push(m); shootBlockers.push(m); } });
    addEdgeBeams(platPos, platSize, PLAT_H / 2, beamOrange, 0.07);
    addEdgeBeams(roofPos, roofSize, ROOF_H / 2, beamPink, 0.08);

    // --- Rampen ---
    // Eine Kette gleicher Pfeile in einer Reihe bildet EINE gleichmaessige Schraege vom Boden (Fuss) bis zur
    // Hoehe des Podests/Dachs, an dem sie endet. Kein Collider auf der Schraege: der Bodenraycast in main.js
    // laesst den Spieler hochlaufen. Seitlich zu offenem Boden gibt es Gelaender (Collider), sonst koennte man
    // von der Seite in die Schraege laufen und wuerde nach oben gesnappt.
    const rampPos = [];
    const railList = [];
    const rampIndex = {};
    rampTiles.forEach(t => { rampIndex[t.r + ',' + t.c] = t; });
    const cellCh = (r, c) => { const row = NEON_VAULT_GRID[r]; return row ? row[c] : undefined; };
    const rampTris = [];
    const quad = (a, b, c, d) => { rampTris.push(a, b, c, a, c, d); };

    rampTiles.forEach(t => {
        const d = RAMP_DIRS[t.ch];
        // Kette entgegen der Richtung bis zum Fuss, dann nach vorn bis zum Ziel zaehlen
        let k = 0, rr = t.r, cc = t.c;
        while (cellCh(rr - d.dz, cc - d.dx) === t.ch) { rr -= d.dz; cc -= d.dx; k++; }
        let n = k + 1; rr = t.r; cc = t.c;
        while (cellCh(rr + d.dz, cc + d.dx) === t.ch) { rr += d.dz; cc += d.dx; n++; }
        const dest = cellCh(rr + d.dz, cc + d.dx);
        const H = dest === 'R' ? ROOF_H : dest === 'P' ? PLAT_H : 0;
        if (H === 0) { console.warn('Rampe ohne Ziel bei', t.r, t.c); return; }
        const a = (k / n) * H, b = ((k + 1) / n) * H;
        t.b = b;

        const hs = TILE_SIZE / 2, px = -d.dz, pz = d.dx; // px/pz = seitliche Richtung
        const P = (along, side, y) => ({ x: t.x + d.dx * along + px * side, y, z: t.z + d.dz * along + pz * side });
        const L1 = P(-hs, -hs, a), L2 = P(-hs, hs, a), H1 = P(hs, -hs, b), H2 = P(hs, hs, b);
        const L1g = { ...L1, y: 0 }, L2g = { ...L2, y: 0 }, H1g = { ...H1, y: 0 }, H2g = { ...H2, y: 0 };
        quad(L1, L2, H2, H1);       // Schraege
        quad(L1, H1, H1g, L1g);     // Seiten
        quad(L2, H2, H2g, L2g);
        quad(L1, L2, L2g, L1g);     // Stirnseiten
        quad(H1, H2, H2g, H1g);

        // Gelaender an offenen Seiten
        [-1, 1].forEach(sd => {
            const nr = t.r + pz * sd, nc = t.c + px * sd;
            const nch = cellCh(nr, nc);
            if (nch === undefined || nch === '#' || nch === 'P' || nch === 'R' || RAMP_DIRS[nch]) return;
            const RAIL_T = 0.15, RAIL_TOP = 1.2;
            const cx = t.x + px * sd * (hs - RAIL_T / 2), cz = t.z + pz * sd * (hs - RAIL_T / 2);
            const alongX = d.dx !== 0;
            railList.push({ x: cx, z: cz, sx: alongX ? TILE_SIZE : RAIL_T, sz: alongX ? RAIL_T : TILE_SIZE, top: b + RAIL_TOP });
        });
    });

    if (rampTris.length > 0) {
        const arr = new Float32Array(rampTris.length * 3);
        rampTris.forEach((v, i) => { arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; });
        const rampGeo = new THREE.BufferGeometry();
        rampGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        rampGeo.computeVertexNormals();
        const rampMat = new THREE.MeshStandardMaterial({
            color: 0x1b1b28, roughness: 1.0, metalness: 0.0, emissive: 0x06202c, emissiveIntensity: 1.0, side: THREE.DoubleSide
        });
        const rampMesh = new THREE.Mesh(rampGeo, rampMat);
        scene.add(rampMesh);
        groundMeshes.push(rampMesh);
        shootBlockers.push(rampMesh);
    }

    if (railList.length > 0) {
        const railMat = new THREE.MeshStandardMaterial({ color: 0x1b1b28, roughness: 1.0 });
        const railMesh = new THREE.InstancedMesh(boxGeo, railMat, railList.length);
        railList.forEach((rl, i) => {
            dummy.position.set(rl.x, rl.top / 2, rl.z);
            dummy.scale.set(rl.sx, rl.top, rl.sz);
            dummy.updateMatrix();
            railMesh.setMatrixAt(i, dummy.matrix);
            addBox3Collider(rl.x, rl.top / 2, rl.z, rl.sx, rl.top, rl.sz);
        });
        railMesh.instanceMatrix.needsUpdate = true;
        railMesh.frustumCulled = false;
        scene.add(railMesh);
        shootBlockers.push(railMesh);
    }

    // --- Zonen-Beleuchtung (Position in Grid-Koordinaten: col,row) ---
    const zones = [
        [44, 8, 0x00ff66],   // T Spawn
        [29, 20, 0xff0055],  // Long
        [38, 28, 0x00f0ff],  // Mid
        [24, 38, 0x9d00ff],  // Left Street / Cellars
        [10, 45, 0x00f0ff],  // Below Stairs
        [26, 41, 0xff0055],  // Roof / Bedroom
        [56, 25, 0xffaa00],  // Tunnel
        [46, 42, 0x00f0ff],  // Right Street
        [55, 65, 0xff0055],  // Market
        [22, 60, 0x9d00ff],  // CT Left
        [31, 70, 0x00ff66],  // CT Right
        [23, 88, 0x00ff66]   // CT Spawn
    ];
    zones.forEach(([c, r, color]) => {
        const p = worldPos(c, r);
        const light = new THREE.PointLight(color, 5.0, 60.0);
        light.position.set(p.x, WALL_HEIGHT - 0.5, p.z);
        scene.add(light);
    });

    colliders.spawnPoints = spawnPoints;
    colliders.groundMeshes = groundMeshes;
    colliders.skyboxGroup = skyboxGroup;
    colliders.portalRings = [];
    colliders.shootBlockers = shootBlockers;
    colliders.rampStats = { placed: rampTiles.length, total: rampTiles.length };
    colliders.towers = [];
    colliders.ramps = [];
    return colliders;
}
