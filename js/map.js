// map.js — "Neon Vault" map
// Builds the map with real Three.js geometry (no external FBX models needed)
// and returns an array of THREE.Box3 colliders, matching what main.js expects
// from: colliders = setupMap(scene);

const TILE_SIZE = 2.0;
const WALL_HEIGHT = 4.0;

// # = wall | . = floor | G = neon gate (walk-through) | L = neon pillar (blocks) | C = spawn zone
const NEON_VAULT_GRID = [
    "#################################",
    "#C......L.......#.......L......C#",
    "#.###G##########.##########G###.#",
    "#.#..........#.....#..........#.#",
    "#.#..L.......#G#.#G#.......L..#.#",
    "#LG...C...................C...GL#",
    "#.#..L.......#G#.#G#.......L..#.#",
    "#.#..........#.....#..........#.#",
    "#.###G##########.##########G###.#",
    "#C......L.......#.......L......C#",
    "#################################"
];

export function setupMap(scene) {
    const colliders = [];
    const spawnPoints = [];

    const rows = NEON_VAULT_GRID.length;
    const cols = NEON_VAULT_GRID[0].length;
    const halfWidth = (cols * TILE_SIZE) / 2;
    const halfDepth = (rows * TILE_SIZE) / 2;

    // --- Mood: dark background + fog so neon accents pop ---
    scene.background = new THREE.Color(0x02020a);
    scene.fog = new THREE.FogExp2(0x02020a, 0.035);
    scene.add(new THREE.AmbientLight(0x0a0a1a, 0.4));

    // --- Floor ---
    const floorGeo = new THREE.PlaneGeometry(cols * TILE_SIZE, rows * TILE_SIZE);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x080810, roughness: 0.8, metalness: 0.2 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Tron-style neon grid lines on the floor
    const gridHelper = new THREE.GridHelper(Math.max(cols, rows) * TILE_SIZE, Math.max(cols, rows), 0x00f0ff, 0x111133);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // --- Low ceiling to keep the space moody / enclosed ---
    const ceiling = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0x030308, roughness: 1.0 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_HEIGHT;
    scene.add(ceiling);

    function worldPos(col, row) {
        return {
            x: (col * TILE_SIZE) - halfWidth + TILE_SIZE / 2,
            z: (row * TILE_SIZE) - halfDepth + TILE_SIZE / 2
        };
    }

    function addBoxCollider(mesh) {
        colliders.push(new THREE.Box3().setFromObject(mesh));
    }

    // Reusable materials
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x080810, roughness: 0.8, metalness: 0.1 });
    const gateMat = new THREE.MeshStandardMaterial({
        color: 0x101018, roughness: 0.3, metalness: 0.4,
        emissive: 0x00f0ff, emissiveIntensity: 2.5
    });
    const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x101018, roughness: 0.2, metalness: 0.4,
        emissive: 0xff0055, emissiveIntensity: 3.0
    });

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
                // Neon gate arch — decorative, walk-through, cyan glow
                const gate = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.9, WALL_HEIGHT * 0.9, 0.2), gateMat);
                gate.position.set(x, WALL_HEIGHT / 2, z);
                scene.add(gate);

                const gateLight = new THREE.PointLight(0x00f0ff, 2.0, 6.0);
                gateLight.position.set(x, WALL_HEIGHT / 2, z);
                scene.add(gateLight);

            } else if (char === 'L') {
                // Neon pillar — solid obstacle, pink glow
                const pillar = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.5, WALL_HEIGHT, TILE_SIZE * 0.5), pillarMat);
                pillar.position.set(x, WALL_HEIGHT / 2, z);
                pillar.castShadow = true;
                scene.add(pillar);
                addBoxCollider(pillar);

                const pillarLight = new THREE.PointLight(0xff0055, 3.0, 5.0);
                pillarLight.position.set(x, WALL_HEIGHT * 0.7, z);
                scene.add(pillarLight);

            } else if (char === 'C') {
                // Spawn zone — warm spotlight marker
                spawnPoints.push({ x, y: 2, z });

                const spotLight = new THREE.SpotLight(0xfff5e6, 1.5, 8.0, Math.PI / 4);
                spotLight.position.set(x, WALL_HEIGHT, z);
                spotLight.target.position.set(x, 0, z);
                scene.add(spotLight);
                scene.add(spotLight.target);
            }
            // '.' and ' ' -> plain floor, nothing extra needed
        }
    }

    // Extra ambient neon strip lights along the long side walls
    [-halfWidth + TILE_SIZE, halfWidth - TILE_SIZE].forEach((x) => {
        const strip = new THREE.PointLight(0x9d00ff, 1.5, 10);
        strip.position.set(x, WALL_HEIGHT - 0.5, 0);
        scene.add(strip);
    });

    // Extra data for main.js if you want to use it later (spawning players at C tiles etc.)
    colliders.spawnPoints = spawnPoints;
    return colliders;
}
