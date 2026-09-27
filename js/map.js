// map.js — "Neon Vault Megaplex (Open Sniper Arena Layout)"
// Basiert exakt auf der Vogelperspektive: Freie Sichtlinien, 4 erhoehte Sniper-Tuerme (T),
// Spawn-Zonen (C) an den Raendern und Portal-Tore (G).

const TILE_SIZE = 3.0;
const WALL_HEIGHT = 5.0;

// Grid-Legende (121 x 33 Tiles ~ 363m x 99m):
// # = Aussenwand | . = Offenes Spielfeld | G = Portal-Tor
// L = Pinker Pfeiler | E = Gruener Pfeiler | C = Spawn-Punkt | T = Erhoehte Sniper-Plattform
const NEON_VAULT_GRID = [
    "#".repeat(121),
    "#" + "C...L...C...............................................................................................C...L...C" + "#",
    "#" + ".........#.......#######.......G.......#######.......T.......#######.......G.......#######.......#........." + "#",
    "#" + "..L...E..#.......#.....#...............#.....#...............#.....#...............#.....#.......#..E...L.." + "#",
    "#" + ".........#.......#.....#...............#.....#...............#.....#...............#.....#.......#........." + "#",
    "#" + "C........G.......#.....#...............#.....#.......T.......#.....#...............#.....#.......G........C" + "#",
    "#" + ".........#.......#######...............#######...............#######...............#######.......#........." + "#",
    "#" + "..........................................................................................................." + "#",
    "#" + "....E........................G...................G...................G........................E...." + "#",
    "#" + "..........................................................................................................." + "#",
    "#" + "##########.......#######...................................................#######.......##########" + "#",
    "#" + "#........#.......#.....#...................................................#.....#.......#........#" + "#",
    "#" + "#..C..L..G.......G..T..#...................T...............T...............#..T..G.......G..L..C..#" + "#",
    "#" + "#........#.......#.....#...................................................#.....#.......#........#" + "#",
    "#" + "##########.......#######...................................................#######.......##########" + "#",
    "#" + "..........................................................................................................." + "#",
    "#" + "C.......L........G...............................................................G........L.......C" + "#",
    "#" + "..........................................................................................................." + "#",
    "#" + "##########.......#######...................................................#######.......##########" + "#",
    "#" + "#........#.......#.....#...................................................#.....#.......#........#" + "#",
    "#" + "#..C..L..G.......G..T..#...................T...............T...............#..T..G.......G..L..C..#" + "#",
    "#" + "#........#.......#.....#...................................................#.....#.......#........#" + "#",
    "#" + "##########.......#######...................................................#######.......##########" + "#",
    "#" + "..........................................................................................................." + "#",
    "#" + "....E........................G...................G...................G........................E...." + "#",
    "#" + "..........................................................................................................." + "#",
    "#" + ".........#.......#######...............#######...............#######...............#######.......#........." + "#",
    "#" + "C........G.......#.....#...............#.....#.......T.......#.....#...............#.....#.......G........C" + "#",
    "#" + ".........#.......#.....#...............#.....#...............#.....#...............#.....#.......#........." + "#",
    "#" + "..L...E..#.......#.....#...............#.....#...............#.....#...............#.....#.......#..E...L.." + "#",
    "#" + ".........#.......#######.......G.......#######.......T.......#######.......G.......#######.......#........." + "#",
    "#" + "C...L...C...............................................................................................C...L...C" + "#",
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
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x06060e, roughness: 0.8 });
    const cyanGateMat = new THREE.MeshStandardMaterial({
        color: 0x0a1018, roughness: 0.75, emissive: 0x00f0ff, emissiveIntensity: 4.0
    });
    const pinkPillarMat = new THREE.MeshStandardMaterial({
        color: 0x180a10, roughness: 0.75, emissive: 0xff0055, emissiveIntensity: 4.5
    });
    const greenPillarMat = new THREE.MeshStandardMaterial({
        color: 0x0a180a, roughness: 0.75, emissive: 0x00ff66, emissiveIntensity: 4.5
    });
    const towerMat = new THREE.MeshStandardMaterial({
        color: 0x0d0d1a, roughness: 0.4, emissive: 0x00f0ff, emissiveIntensity: 2.5
    });

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
        scene.add(instancedMesh);
        return instancedMesh;
    }

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);

    createInstancedMesh(boxGeo, wallMat, wallPos, { x: TILE_SIZE, y: WALL_HEIGHT, z: TILE_SIZE });
    createInstancedMesh(boxGeo, cyanGateMat, gatePos, { x: TILE_SIZE * 0.9, y: WALL_HEIGHT * 0.85, z: 0.2 });
    createInstancedMesh(boxGeo, pinkPillarMat, pinkPos, { x: TILE_SIZE * 0.5, y: WALL_HEIGHT, z: TILE_SIZE * 0.5 });
    createInstancedMesh(boxGeo, greenPillarMat, greenPos, { x: TILE_SIZE * 0.5, y: WALL_HEIGHT, z: TILE_SIZE * 0.5 });

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
    if (towerPos.length > 0) {
        const TOWER_HEIGHT = 6.0;
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
    }

    // --- Deckungskisten im Zentrum ---
    const crateMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a14, roughness: 0.8, emissive: 0x9d00ff, emissiveIntensity: 0.8
    });
    const cratePositions = [];
    for (let x = -110; x <= 110; x += 22) {
        for (let z = -30; z <= 30; z += 18) {
            if (Math.abs(x) < 15 && Math.abs(z) < 15) continue;
            const cx = x + (Math.sin(x + z) * 3);
            const cz = z + (Math.cos(x * z) * 3);
            cratePositions.push({ x: cx, z: cz });
            addBox3Collider(cx, 0.7, cz, 1.8, 1.4, 1.8);
        }
    }
    createInstancedMesh(boxGeo, crateMat, cratePositions, { x: 1.8, y: 1.4, z: 1.8 }, 0.7);

    // --- Treppen zu den Sniper-Plattformen ---
    const stepMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a16, roughness: 0.8, emissive: 0x00f0ff, emissiveIntensity: 1.5
    });

    function addStaircase(startX, z, dirX, steps = 6, stepHeight = 1.0, stepDepth = 1.2) {
        for (let i = 0; i < steps; i++) {
            const h = stepHeight * (i + 1);
            const step = new THREE.Mesh(new THREE.BoxGeometry(stepDepth, h, TILE_SIZE * 1.2), stepMat);
            step.position.set(startX + dirX * stepDepth * i, h / 2, z);
            scene.add(step);
            groundMeshes.push(step);
        }
    }

    // Treppenaufgaenge zu den Turmzonen
    addStaircase(-110, -20, 1);
    addStaircase(-110, 20, 1);
    addStaircase(-40, -15, 1);
    addStaircase(-40, 15, 1);
    addStaircase(40, -15, -1);
    addStaircase(40, 15, -1);
    addStaircase(110, -20, -1);
    addStaircase(110, 20, -1);

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
    return colliders;
}
