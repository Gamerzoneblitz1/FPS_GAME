// map.js — "Neon Vault Megaplex (High FPS Optimized)"
// Size: 121x33 (~242m x 66m). Optimized via InstancedMesh & Light Budgeting.

const TILE_SIZE = 2.0;
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

    const rows = NEON_VAULT_GRID.length;
    const cols = NEON_VAULT_GRID[0].length;
    const halfWidth = (cols * TILE_SIZE) / 2;
    const halfDepth = (rows * TILE_SIZE) / 2;

    // --- Atmosphaere ---
    scene.background = new THREE.Color(0x010106);
    scene.fog = new THREE.FogExp2(0x010106, 0.012);
    scene.add(new THREE.AmbientLight(0x101025, 0.8));

    const dirLight = new THREE.DirectionalLight(0x445577, 0.6);
    dirLight.position.set(30, 80, 30);
    scene.add(dirLight);

    // --- Boden & Decke ---
    const floorGeo = new THREE.PlaneGeometry(cols * TILE_SIZE, rows * TILE_SIZE);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x06060c, roughness: 0.8, metalness: 0.2 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    groundMeshes.push(floor);

    const gridHelper = new THREE.GridHelper(Math.max(cols, rows) * TILE_SIZE, 60, 0x00f0ff, 0x0d0d22);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    const ceiling = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0x020205, roughness: 1.0 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_HEIGHT;
    scene.add(ceiling);

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

    // --- Zonen-Beleuchtung (Sparsam platzierte Punktlichter für sanftes Licht) ---
    const zoneLights = [
        { x: -90, z: 0, color: 0xff0055 },
        { x: -45, z: 0, color: 0x00f0ff },
        { x: 0, z: 0, color: 0x9d00ff },
        { x: 45, z: 0, color: 0x00ff66 },
        { x: 90, z: 0, color: 0xffaa00 }
    ];

    zoneLights.forEach(l => {
        const pLight = new THREE.PointLight(l.color, 3.5, 35.0);
        pLight.position.set(l.x, WALL_HEIGHT - 1, l.z);
        scene.add(pLight);
    });

    colliders.spawnPoints = spawnPoints;
    colliders.groundMeshes = groundMeshes;
    return colliders;
}
