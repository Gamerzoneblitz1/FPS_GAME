// map.js — "Neon Vault Megaplex"
// Giant Arena (121x33 Tiles / ~242m x 66m) with multiple zones, elevated towers,
// cover clusters, multi-color sector lighting, and 24 spawn points.

const TILE_SIZE = 2.0;
const WALL_HEIGHT = 5.0;

// Grid Legend:
// # = Wall | . = Floor | G = Cyan Gate | L = Pink Pillar | E = Green Energy Pillar
// C = Spawn Point | T = Elevated Tower Spot | H = High Wall
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

    // --- Atmospheric World Lighting & Fog ---
    scene.background = new THREE.Color(0x010106);
    scene.fog = new THREE.FogExp2(0x010106, 0.015);
    scene.add(new THREE.AmbientLight(0x08081c, 0.6));

    // Directional Cyberpunk Sun / Moon
    const dirLight = new THREE.DirectionalLight(0x334466, 0.8);
    dirLight.position.set(50, 100, 50);
    scene.add(dirLight);

    // --- Floor Setup ---
    const floorGeo = new THREE.PlaneGeometry(cols * TILE_SIZE, rows * TILE_SIZE);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x06060c, roughness: 0.8, metalness: 0.3 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    groundMeshes.push(floor);

    // Grid Overlay
    const gridHelper = new THREE.GridHelper(Math.max(cols, rows) * TILE_SIZE, Math.max(cols, rows), 0x00f0ff, 0x0a0a22);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Ceiling
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
    function addBoxCollider(mesh) {
        const box = new THREE.Box3().setFromObject(mesh);
        box.expandByScalar(COLLIDER_PADDING);
        colliders.push(box);
    }

    // Shared Materials
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x06060e, roughness: 0.8, metalness: 0.2 });
    const cyanGateMat = new THREE.MeshStandardMaterial({
        color: 0x0a1018, roughness: 0.3, metalness: 0.5,
        emissive: 0x00f0ff, emissiveIntensity: 2.5
    });
    const pinkPillarMat = new THREE.MeshStandardMaterial({
        color: 0x180a10, roughness: 0.2, metalness: 0.5,
        emissive: 0xff0055, emissiveIntensity: 3.0
    });
    const greenPillarMat = new THREE.MeshStandardMaterial({
        color: 0x0a180a, roughness: 0.2, metalness: 0.5,
        emissive: 0x00ff66, emissiveIntensity: 3.0
    });

    // --- Parse Tile Grid ---
    for (let r = 0; r < rows; r++) {
        const line = NEON_VAULT_GRID[r];
        for (let c = 0; c < cols; c++) {
            const char = line[c];
            const { x, z } = worldPos(c, r);

            if (char === '#') {
                const wall = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, TILE_SIZE), wallMat);
                wall.position.set(x, WALL_HEIGHT / 2, z);
                wall.castShadow = true;
                wall.receiveShadow = true;
                scene.add(wall);
                addBoxCollider(wall);

            } else if (char === 'G') {
                const gate = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.9, WALL_HEIGHT * 0.85, 0.2), cyanGateMat);
                gate.position.set(x, WALL_HEIGHT / 2, z);
                scene.add(gate);

                const gateLight = new THREE.PointLight(0x00f0ff, 2.0, 8.0);
                gateLight.position.set(x, WALL_HEIGHT / 2, z);
                scene.add(gateLight);

            } else if (char === 'L') {
                const pillar = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.5, WALL_HEIGHT, TILE_SIZE * 0.5), pinkPillarMat);
                pillar.position.set(x, WALL_HEIGHT / 2, z);
                pillar.castShadow = true;
                pillar.receiveShadow = true;
                scene.add(pillar);
                addBoxCollider(pillar);

                const pillarLight = new THREE.PointLight(0xff0055, 3.0, 7.0);
                pillarLight.position.set(x, WALL_HEIGHT * 0.7, z);
                scene.add(pillarLight);

            } else if (char === 'E') {
                const pillar = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.5, WALL_HEIGHT, TILE_SIZE * 0.5), greenPillarMat);
                pillar.position.set(x, WALL_HEIGHT / 2, z);
                pillar.castShadow = true;
                pillar.receiveShadow = true;
                scene.add(pillar);
                addBoxCollider(pillar);

                const pillarLight = new THREE.PointLight(0x00ff66, 3.0, 7.0);
                pillarLight.position.set(x, WALL_HEIGHT * 0.7, z);
                scene.add(pillarLight);

            } else if (char === 'C') {
                spawnPoints.push({ x, y: 2, z });

                const spotLight = new THREE.SpotLight(0xfff5e6, 2.0, 10.0, Math.PI / 4);
                spotLight.position.set(x, WALL_HEIGHT, z);
                spotLight.target.position.set(x, 0, z);
                scene.add(spotLight);
                scene.add(spotLight.target);

            } else if (char === 'T') {
                // Sniper / Elevated Platform Post
                const platform = new THREE.Mesh(
                    new THREE.BoxGeometry(TILE_SIZE * 1.2, 1.8, TILE_SIZE * 1.2),
                    cyanGateMat
                );
                platform.position.set(x, 0.9, z);
                scene.add(platform);
                groundMeshes.push(platform);

                const towerLight = new THREE.PointLight(0x00f0ff, 2.5, 6.0);
                towerLight.position.set(x, 2.5, z);
                scene.add(towerLight);
            }
        }
    }

    // --- Sector Ambient Neon Strips ---
    const sectorXOffsets = [-100, -50, 0, 50, 100];
    const sectorColors = [0xff0055, 0x00f0ff, 0x9d00ff, 0x00ff66, 0xffaa00];

    sectorXOffsets.forEach((x, idx) => {
        const color = sectorColors[idx % sectorColors.length];
        
        const topStrip = new THREE.PointLight(color, 2.5, 20);
        topStrip.position.set(x, WALL_HEIGHT - 0.5, -halfDepth + 4);
        scene.add(topStrip);

        const bottomStrip = new THREE.PointLight(color, 2.5, 20);
        bottomStrip.position.set(x, WALL_HEIGHT - 0.5, halfDepth - 4);
        scene.add(bottomStrip);
    });

    // --- Massive Cover Clusters (Crates) ---
    const crateMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a14, roughness: 0.5, metalness: 0.4,
        emissive: 0x9d00ff, emissiveIntensity: 0.3
    });

    // Procedural generation of tactical cover throughout corridors
    for (let x = -100; x <= 100; x += 12) {
        for (let z = -24; z <= 24; z += 12) {
            if (Math.abs(x) < 8 && Math.abs(z) < 8) continue; // Keep absolute center clear

            const crate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), crateMat);
            crate.position.set(x + (Math.sin(x + z) * 2), 0.7, z + (Math.cos(x * z) * 2));
            crate.castShadow = true;
            crate.receiveShadow = true;
            scene.add(crate);
            addBoxCollider(crate);
        }
    }

    // --- Staircases & Elevated Ramp Systems ---
    const stepMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a16, roughness: 0.4, metalness: 0.4,
        emissive: 0x00f0ff, emissiveIntensity: 0.5
    });

    function addStaircase(startX, z, dirX, steps = 4, stepHeight = 0.45, stepDepth = 1.0, platformDepth = 2.5) {
        for (let i = 0; i < steps; i++) {
            const h = stepHeight * (i + 1);
            const step = new THREE.Mesh(new THREE.BoxGeometry(stepDepth, h, TILE_SIZE * 1.2), stepMat);
            step.position.set(startX + dirX * stepDepth * i, h / 2, z);
            step.castShadow = true;
            step.receiveShadow = true;
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
        platform.castShadow = true;
        platform.receiveShadow = true;
        scene.add(platform);
        groundMeshes.push(platform);

        const edgeLight = new THREE.PointLight(0x00f0ff, 2.5, 8.0);
        edgeLight.position.set(platform.position.x, platformHeight + 1.2, z);
        scene.add(edgeLight);
    }

    // Place Stair Systems across West, Central, and East Wings
    addStaircase(-104, -18, 1);
    addStaircase(-104, 18, 1);
    addStaircase(-40, -12, 1);
    addStaircase(-40, 12, 1);
    addStaircase(40, -12, -1);
    addStaircase(40, 12, -1);
    addStaircase(104, -18, -1);
    addStaircase(104, 18, -1);

    // Export properties expected by main.js
    colliders.spawnPoints = spawnPoints;
    colliders.groundMeshes = groundMeshes;
    return colliders;
}
