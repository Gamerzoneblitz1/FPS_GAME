// map.js — "Neon Vault Megaplex (High FPS Optimized)"
// Size: 121x33 (~363m x 99m bei TILE_SIZE=3). Optimized via InstancedMesh & Light Budgeting.

const TILE_SIZE = 3.0; // von 2.0 auf 3.0 erhöht -> öffnet alle Gänge/Räume um 50%, ohne das Grid neu zu zeichnen
const WALL_HEIGHT = 5.0;

const NEON_VAULT_GRID = [
    "#".repeat(121),
    "#" + "C.......L.......#.......E.......#.......L.......C".padEnd(59, ".") + "#" + "C.......L.......#.......E.......#.......L.......C".padStart(59, ".") + "#",
    "#." + "#######G#######.#.#############.#.#######G#######".padEnd(59, ".") + "#" + ".#######G#######.#.#############.#.#######G#######.".padStart(59, ".") + "#",
    "#.#.............#.#.............#.#.............#.#" + " ".repeat(21) + "#.#.............#.#.............#.#.............#.#",
    "#.#..L...C...L..#.#..T...E...T..#.#..L...C...L..#.#" + " ".repeat(21) + "#.#..L...C...L..#.#..T...E...T..#.#..L...C...L..#.#",
    "#.#.............#.#.............#.#.............#.#" + " ".repeat(21) + "#.#.............#.#.............#.#.............#.#",
    "#.#######.#######.#.#####G#####.#.#######.#######.#" + "   #######G#######   " + "#.#######.#######.#.#####G#####.#.#######.#######.#",
    "#.......#.#.......#.....#.#.....#.......#.#.......#" + "   #.............#   " + "#.......#.#.......#.....#.#.....#.......#.#.......#",
    "#C......G.#......C#.....G.G.....#C......G.#......C#" + "   G......C......G   " + "#C......G.#......C#.....G.G.....#C......G.#......C#",
    "#.......#.#.......#.....#.#.....#.......#.#.......#" + "   #.............#   " + "#.......#.#.......#.....#.#.....#.......#.#.......#",
    "#########.#########.#####.#####.#########.#########" + "   #######.#######   " + "#########.#########.#####.#####.#########.#########",
    "#.................................................#" + ".........#.#........." + "#.................................................#",
    "#..L...E...L.......C.......T.......C.......L...E...L#" + "....T....G.G....T...." + "#..L...E...L.......C.......T.......C.......L...E...L#",
    "#.................................................#" + ".........#.#........." + "#.................................................#",
    "#.#########.#########.#####G#####.#########.#########" + "#####.#########.#####" + "#.#########.#########.#####G#####.#########.#########",
    "#.#.......#.#.......#.....#.#.....#.......#.#.......#" + ".....#.#...#...#.#....." + "#.#.......#.#.......#.....#.#.....#.......#.#.......#",
    "#LG...C...G.G...C...GL....G.G....LG...C...G.G...C...GL" + ".....G.C...E...C.G....." + "LG...C...G.G...C...GL....G.G....LG...C...G.G...C...GL#",
    "#.#.......#.#.......#.....#.#.....#.......#.#.......#" + ".....#.#...#...#.#....." + "#.#.......#.#.......#.....#.#.....#.......#.#.......#",
    "#.#########.#########.#####G#####.#########.#########" + "#####.#########.#####" + "#.#########.#########.#####G#####.#########.#########",
    "#.................................................#" + ".........#.#........." + "#.................................................#",
    "#..L...E...L.......C.......T.......C.......L...E...L#" + "....T....G.G....T...." + "#..L...E...L.......C.......T.......C.......L...E...L#",
    "#.................................................#" + ".........#.#........." + "#.................................................#",
    "#########.#########.#####.#####.#########.#########" + "   #######.#######   " + "#########.#########.#####.#####.#########.#########",
    "#.......#.#.......#.....#.#.....#.......#.#.......#" + "   #.............#   " + "#.......#.#.......#.....#.#.....#.......#.#.......#",
    "#C......G.#......C#.....G.G.....#C......G.#......C#" + "   G......C......G   " + "#C......G.#......C#.....G.G.....#C......G.#......C#",
    "#.......#.#.......#.....#.#.....#.......#.#.......#" + "   #.............#   " + "#.......#.#.......#.....#.#.....#.......#.#.......#",
    "#.#######.#######.#.#####G#####.#.#######.#######.#" + "   #######G#######   " + "#.#######.#######.#.#####G#####.#.#######.#######.#",
    "#.#.............#.#.............#.#.............#.#" + " ".repeat(21) + "#.#.............#.#.............#.#.............#.#",
    "#.#..L...C...L..#.#..T...E...T..#.#..L...C...L..#.#" + " ".repeat(21) + "#.#..L...C...L..#.#..T...E...T..#.#..L...C...L..#.#",
    "#.#.............#.#.............#.#.............#.#" + " ".repeat(21) + "#.#.............#.#.............#.#.............#.#",
    "#." + "#######G#######.#.#############.#.#######G#######".padEnd(59, ".") + "#" + ".#######G#######.#.#############.#.#######G#######.".padStart(59, ".") + "#",
    "#" + "C.......L.......#.......E.......#.......L.......C".padEnd(59, ".") + "#" + "C.......L.......#.......E.......#.......L.......C".padStart(59, ".") + "#",
    "#".repeat(121)
];

export function setupMap(scene) {
    const colliders = [];
    const spawnPoints = [];
    const groundMeshes = [];

    // Fix: Die Grid-Zeilen sind durch die padStart/padEnd-Konstruktion unterschiedlich lang
    // (121 bis 131 Zeichen). Vorher wurde cols von Zeile 0 (121) abgeleitet, wodurch der Rest
    // jeder längeren Zeile beim Bauen stillschweigend abgeschnitten wurde (fehlende Wände/Gates/
    // Spawnpunkte am rechten Rand). Jetzt: cols = längste Zeile, kürzere Zeilen rechts mit '#'
    // auffüllen (schließt den Rand sauber, statt ein Loch in der Außenwand zu lassen).
    const rows = NEON_VAULT_GRID.length;
    const cols = Math.max(...NEON_VAULT_GRID.map(r => r.length));
    for (let i = 0; i < NEON_VAULT_GRID.length; i++) {
        if (NEON_VAULT_GRID[i].length < cols) {
            NEON_VAULT_GRID[i] = NEON_VAULT_GRID[i] + "#".repeat(cols - NEON_VAULT_GRID[i].length);
        }
    }
    // De-Clutter: viele Innenwände sind nur 1 Tile dick und erzeugen sehr viele kleine
    // Mini-Kammern ("zu viele Wände"). Entfernt genau diese dünnen Trennwände (Boden auf beiden
    // Seiten in X- ODER Z-Richtung), lässt aber dicke Wandblöcke (mehrere '#' hintereinander,
    // also echte Raumgrenzen/Außenwand) unangetastet, da deren Nachbarn selbst '#' sind.
    const gridChars = NEON_VAULT_GRID.map(r => r.split(''));
    const isOpen = (ch) => ch === '.' || ch === ' ' || ch === 'C' || ch === 'T';
    for (let r = 1; r < rows - 1; r++) {
        for (let c = 1; c < cols - 1; c++) {
            if (gridChars[r][c] !== '#') continue;
            const left = gridChars[r][c - 1];
            const right = gridChars[r][c + 1];
            const up = gridChars[r - 1][c];
            const down = gridChars[r + 1][c];
            const thinHorizontal = isOpen(left) && isOpen(right);
            const thinVertical = isOpen(up) && isOpen(down);
            if (thinHorizontal || thinVertical) {
                gridChars[r][c] = '.';
            }
        }
    }
    for (let r = 0; r < rows; r++) {
        NEON_VAULT_GRID[r] = gridChars[r].join('');
    }

    const halfWidth = (cols * TILE_SIZE) / 2;
    const halfDepth = (rows * TILE_SIZE) / 2;

    // --- Atmosphaere ---
    scene.background = new THREE.Color(0x010106);
    scene.fog = new THREE.FogExp2(0x010106, 0.006);
    scene.add(new THREE.AmbientLight(0x202844, 1.6));
    scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x0a0a12, 0.9));

    const dirLight = new THREE.DirectionalLight(0x6677aa, 1.1);
    dirLight.position.set(30, 80, 30);
    scene.add(dirLight);

    // --- Sternenhimmel + Ringplanet (Skybox-Trick: folgt der Kamera-Position, nicht der Rotation,
    // damit es aussieht wie unendlich weit entfernt statt mitzudrehen. Position wird von main.js
    // jeden Frame auf camera.position gesetzt -> siehe colliders.skyboxGroup) ---
    const skyboxGroup = new THREE.Group();

    const starCount = 3000;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        // Punkte auf einer großen Kugelschale verteilen
        const radius = 1800 + Math.random() * 400;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        starPositions[i * 3 + 1] = Math.abs(radius * Math.sin(phi) * Math.sin(theta)) + 50; // meist über dem Horizont
        starPositions[i * 3 + 2] = radius * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false });
    const starField = new THREE.Points(starGeo, starMat);
    skyboxGroup.add(starField);

    const planetGroup = new THREE.Group();
    const planetMat = new THREE.MeshStandardMaterial({
        color: 0x3a4a66, roughness: 0.9, emissive: 0x111a2e, emissiveIntensity: 0.6, fog: false
    });
    const planetMesh = new THREE.Mesh(new THREE.SphereGeometry(260, 32, 32), planetMat);
    planetGroup.add(planetMesh);

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

    // --- Boden (keine Decke mehr -> offenes Gefühl statt Tunnel) ---
    const floorGeo = new THREE.PlaneGeometry(cols * TILE_SIZE, rows * TILE_SIZE);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x06060c, roughness: 0.8, metalness: 0.2 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    groundMeshes.push(floor);

    const gridHelper = new THREE.GridHelper(Math.max(cols, rows) * TILE_SIZE, 60, 0x00f0ff, 0x0d0d22);
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

    // --- Materialien mit starken Emissive-Werten (Ersatz fuer Performance-fressende Punktlichter) ---
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x06060e, roughness: 0.8 });
    const cyanGateMat = new THREE.MeshStandardMaterial({
        color: 0x0a1018, roughness: 0.2, emissive: 0x00f0ff, emissiveIntensity: 4.0
    });
    const pinkPillarMat = new THREE.MeshStandardMaterial({
        color: 0x180a10, roughness: 0.2, emissive: 0xff0055, emissiveIntensity: 4.5
    });
    const greenPillarMat = new THREE.MeshStandardMaterial({
        color: 0x0a180a, roughness: 0.2, emissive: 0x00ff66, emissiveIntensity: 4.5
    });
    const towerMat = new THREE.MeshStandardMaterial({
        color: 0x0d0d1a, roughness: 0.3, emissive: 0x00f0ff, emissiveIntensity: 2.0
    });

    // Positions-Arrays für InstancedMeshes sammeln
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

    // --- InstancedMesh Generator Helper ---
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
        scene.add(instancedMesh);
        return instancedMesh;
    }

    // Meshes in Bündeln instanziieren (extrem schnell!)
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);

    createInstancedMesh(boxGeo, wallMat, wallPos, { x: TILE_SIZE, y: WALL_HEIGHT, z: TILE_SIZE });
    createInstancedMesh(boxGeo, cyanGateMat, gatePos, { x: TILE_SIZE * 0.9, y: WALL_HEIGHT * 0.85, z: 0.2 });

    // --- Rotierende Portal-Ringe an jedem Gate (Referenzbild-Look) ---
    const portalRings = [];
    const portalRingMat = new THREE.MeshStandardMaterial({
        color: 0x0a1018, roughness: 0.2, emissive: 0x00f0ff, emissiveIntensity: 3.0
    });
    gatePos.forEach(pos => {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(TILE_SIZE * 0.55, 0.07, 8, 24),
            portalRingMat
        );
        ring.position.set(pos.x, WALL_HEIGHT * 0.5, pos.z);
        scene.add(ring);
        portalRings.push(ring);
    });
    createInstancedMesh(boxGeo, pinkPillarMat, pinkPos, { x: TILE_SIZE * 0.5, y: WALL_HEIGHT, z: TILE_SIZE * 0.5 });
    createInstancedMesh(boxGeo, greenPillarMat, greenPos, { x: TILE_SIZE * 0.5, y: WALL_HEIGHT, z: TILE_SIZE * 0.5 });

    // Podeste/Tower
    if (towerPos.length > 0) {
        const towerMesh = createInstancedMesh(boxGeo, towerMat, towerPos, { x: TILE_SIZE * 1.2, y: 1.8, z: TILE_SIZE * 1.2 }, 0.9);
        groundMeshes.push(towerMesh);
    }

    // --- Deckungskisten als InstancedMesh ---
    const crateMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a14, roughness: 0.5, emissive: 0x9d00ff, emissiveIntensity: 0.8
    });
    const cratePositions = [];

    for (let x = -100; x <= 100; x += 16) {
        for (let z = -24; z <= 24; z += 16) {
            if (Math.abs(x) < 10 && Math.abs(z) < 10) continue;
            const cx = x + (Math.sin(x + z) * 2);
            const cz = z + (Math.cos(x * z) * 2);
            cratePositions.push({ x: cx, z: cz });
            addBox3Collider(cx, 0.7, cz, 1.4, 1.4, 1.4);
        }
    }
    createInstancedMesh(boxGeo, crateMat, cratePositions, { x: 1.4, y: 1.4, z: 1.4 }, 0.7);

    // --- Treppen & Plattformen ---
    const stepMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a16, roughness: 0.4, emissive: 0x00f0ff, emissiveIntensity: 1.5
    });

    function addStaircase(startX, z, dirX, steps = 4, stepHeight = 0.45, stepDepth = 1.0, platformDepth = 2.5) {
        for (let i = 0; i < steps; i++) {
            const h = stepHeight * (i + 1);
            const step = new THREE.Mesh(new THREE.BoxGeometry(stepDepth, h, TILE_SIZE * 1.2), stepMat);
            step.position.set(startX + dirX * stepDepth * i, h / 2, z);
            scene.add(step);
            groundMeshes.push(step);
        }

        const platformHeight = stepHeight * steps;
        const platform = new THREE.Mesh(
            new THREE.BoxGeometry(platformDepth, platformHeight, TILE_SIZE * 1.8),
            stepMat
        );
        platform.position.set(
            startX + dirX * (stepDepth * steps + platformDepth / 2 - stepDepth / 2),
            platformHeight / 2,
            z
        );
        scene.add(platform);
        groundMeshes.push(platform);
    }

    addStaircase(-104, -18, 1);
    addStaircase(-104, 18, 1);
    addStaircase(-40, -12, 1);
    addStaircase(-40, 12, 1);
    addStaircase(40, -12, -1);
    addStaircase(40, 12, -1);
    addStaircase(104, -18, -1);
    addStaircase(104, 18, -1);

    // --- Zonen-Beleuchtung: Raster über die GESAMTE Map statt nur einer Linie bei z=0,
    // sonst bleiben große Teile (die Map ist ~360x100 Einheiten breit) nur mit Ambient-Licht
    // beleuchtet und wirken dunkel.
    const zoneColors = [0xff0055, 0x00f0ff, 0x9d00ff, 0x00ff66];
    const zoneXPositions = [-150, -90, -30, 30, 90, 150];
    const zoneZPositions = [-30, 0, 30];

    let colorIdx = 0;
    zoneXPositions.forEach(x => {
        zoneZPositions.forEach(z => {
            const pLight = new THREE.PointLight(zoneColors[colorIdx % zoneColors.length], 3.0, 75.0);
            pLight.position.set(x, WALL_HEIGHT - 0.5, z);
            scene.add(pLight);
            colorIdx++;
        });
    });

    colliders.spawnPoints = spawnPoints;
    colliders.groundMeshes = groundMeshes;
    colliders.skyboxGroup = skyboxGroup;
    colliders.portalRings = portalRings;
    return colliders;
}
