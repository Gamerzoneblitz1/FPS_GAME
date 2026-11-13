// js/map.js  —  CS Italy (OBJ-derived, multi-level)
// Skala: 36 CS Hammer-Units = 1 m, TILE_SIZE = 3 m = 108 CS-Units pro Tile
// Ebenen: Boden (Z≈0), Keller/Cellar (Z≈-160 ≈ -4m), Plattform (Z≈128 ≈+3.5m), Dach (Z≈384 ≈+5.5m)

const TILE_SIZE    = 3.0;
const WALL_HEIGHT  = 6.0;
const PLAT_H       = 3.5;   // erhöhte Fläche (Z=128 CS → 128/36≈3.56 m)
const ROOF_H       = 5.5;   // Dachgalerie     (Z=160 CS → 4.44 m; für Spielbarkeit auf 5.5 gesetzt)
const CELLAR_DEPTH = 4.0;   // Kellerboden 4 m unter Erdebene (Z=-160 CS → 160/36≈4.4 m)

// Grid-Legende:
// # = Wand  . = Boden  K = Keller  P = Plattform  R = Dach  C = Spawn  B = Kiste
const NEON_VAULT_GRID = [
  '##########################################',
  '##########################################',
  '########KK.######P########################',
  '#########K#P#PPPP.########################',
  '#########K#K#KKKK#########################',
  '############CKKK##########################',
  '#########C###KKK#C########################',
  '#######C#C#C#KKC#C#.######################',
  '########.KK##KKK#KK#######################',
  '#######.#.K#K.##KKK#######################',
  '########.KK#KK##KKK#######################',
  '##########K#K####KK#######################',
  '#######.##K######..P#PP###################',
  '########.KKK.K##K.####P###################',
  '##########KKK####.##P#####################',
  '#######...KKK####P####P###################',
  '########PP#P.K##KP##P#P###################',
  '############..##.K##P#####################',
  '########P#PPKKKKK.PP#PP###################',
  '#########..KK#..#KK..PP###################',
  '#######.###K######KK...###################',
  '#########.K##P.PP###K#####################',
  '#########.K##PP#P###K#####################',
  '#######.#.K####PP##KKK.##PP#PP.PPP#PP..###',
  '#########.##P##PPP##.PPP.P###..#######.###',
  '#######.#.##.####.##.PP#PPP.....####P..###',
  '#####PPPP.##P##P#P##P####P....KK.....K#.##',
  '#####PPP..KKP#####.K.#P##P..KKK.K.KK..#..#',
  '#####P##...PP#####P..#####.K....K..KK###.#',
  '#####.....KK######KK.P#PPPP.K.K..K#KKKP###',
  '#####PPP.P..P#####..KKK..KK..KKKKKKK.#P#.#',
  '#####P###...P#####..KP#PPPPK.KKK.K#..#P#.#',
  '#####P###PKK######.KK#######KKKKKKKKKK.###',
  '#####P#.K..P######...PPRRRP###.#.##K..#..#',
  '###PPP##K...###.P....#####K##K..K##K#.K..#',
  '##PPPPPPPPK.###.PPKK.####K.K....K..K.K..##',
  '##PP#..K.K..P##.P.PPP#####KK.K######P..###',
  '####.K...K.KP##P#PP.P#RR#R.#K#######P..###',
  '##P#K##KRPRP#R.PP.RPPR####KK#K#######K.###',
  '##P.K###KP.P#PP...#PP####KKK.K######P.####',
  '####KK##P..##P.....#.RRR#R.K...PKP.K..####',
  '##P.KKK#RP#.RP.RRP...####PKK.K##K..KK..###',
  '##P#KK##P..P##....P.PRP##P..KK##KK.K######',
  '###.KK##P..##P...P.P.PP#####..K#.P..######',
  '##P.KK#KRP.P..P..#..PPP#####.KK#P#.#######',
  '###..K#.PPPPPP.PPPPPPP.KP.KPK####.K#######',
  '####..#KP.P..#.RPPPPPP.#######K###.###K###',
  '##P..K#.PPPPPP.PPPPPPPK##K##K.KKPP.KKKK###',
  '##P...#K#PK..K.PRKR.KP..PKPRPPRP#R.#######',
  '###...###K...#..##K.KK.K.#########KP#P####',
  '##P...###......K##.K..K.RR#########.#.####',
  '##P....KPP.PK#PKPRPP....#R#########.#K####',
  '###.......#P..R.R.RR.P.K.R#######PP..P####',
  '##P..KK..##P..R#RRRR.PK.R##########..#####',
  '###..K...P.P..R####R.P#K.R#########...####',
  '#PPPPPPPPPPP..##R####P#KKR########P..#####',
  '#####.....PP..R####R#PKKPR######P#P#P#####',
  '#P#R#PPK..RP..R####R#P##RR########.#.#####',
  '####...K.R.P..##################.P.P.#####',
  '##P##K..PPRP..R####R#PKKPR######P#PP######',
  '###R.PP..K.P..R#R##P#P..RRR#RRR...P.######',
  '#####..KPP.P..R##R.P...K.######RPPPPRRR###',
  '##PR...KPR.P..R.R#......P.R#RPPPPPP.RP####',
  '###R..P.P..P.......K.......##.......PPP###',
  '#P#P#......PP....K#.#.....####......P.####',
  '####P##P#.P..K......K.KK..#.##.##P#R#P####',
  '#########CCCCCCCCK.KP.K...####.RRPR#.PR###',
  '#########...PKR.KKKK..K#..###...RPPRPP####',
  '###################PP#K.....##.PPPPPPPR###',
  '###################P...##..#####P###P#P###',
  '###################P...##..####PR.P.P#R###',
  '###################P...........PP...PP####',
  '###################PPPP#PP#PPPPPR##R#R####',
  '##########################################',
];

export function setupMap(scene) {
  const colliders    = [];   // Box3-Collider (Wände) + unsichtbare Mesh-Collider (Rampen/Decks)
  const groundMeshes = [];   // begehbare Flächen für den Boden-Raycast in main.js
  const shootBlockers= [];   // blockieren Schüsse

  const halfC = Math.floor(NEON_VAULT_GRID[0].length / 2);
  const halfR = Math.floor(NEON_VAULT_GRID.length    / 2);

  function worldPos(col, row) {
    return { x: (col - halfC) * TILE_SIZE, z: (row - halfR) * TILE_SIZE };
  }

  // ── Hilfsfunktionen ──────────────────────────────────────────────────────────
  function makeInstanced(geo, mat, count) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.frustumCulled = false;
    m.instanceMatrix.needsUpdate = true;
    return m;
  }

  // Box3-Collider (kompatibel mit dem isColliding()-Check in main.js)
  function addBox3Collider(x, cy, z, w, h, d) {
    const box = new THREE.Box3();
    box.setFromCenterAndSize(
      new THREE.Vector3(x, cy, z),
      new THREE.Vector3(w, h, d)
    );
    colliders.push(box);
  }

  // Unsichtbares Mesh als Shoot-Blocker + Boden-Raycast-Ziel
  function addSlabMesh(x, y, z, w, h, d, forGround, forShoot) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    mesh.position.set(x, y, z);
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    if (forGround)  groundMeshes.push(mesh);
    if (forShoot)   shootBlockers.push(mesh);
    return mesh;
  }

  // ── Materialien (CS Italy Farbpalette) ──────────────────────────────────────
  const wallMat   = new THREE.MeshLambertMaterial({ color: 0x8B6914 }); // terracotta
  const floorMat  = new THREE.MeshLambertMaterial({ color: 0xC2A060 }); // sandgelb
  const platMat   = new THREE.MeshLambertMaterial({ color: 0xA0785A }); // erhöhter Boden
  const roofMat   = new THREE.MeshLambertMaterial({ color: 0x7A5C3A }); // dunkleres Dach
  const cellarMat = new THREE.MeshLambertMaterial({ color: 0x556070 }); // Keller-Stein
  const beamMat   = new THREE.MeshLambertMaterial({ color: 0xFFCC44, emissive: new THREE.Color(0xCC8800) });
  const skyMat    = new THREE.MeshLambertMaterial({ color: 0x87CEEB, side: THREE.BackSide });

  // ── Tiles zählen für InstancedMesh-Allokation ───────────────────────────────
  let wallCount=0, floorCount=0, platCount=0, roofCount=0, cellarCount=0;
  for (let row=0; row<NEON_VAULT_GRID.length; row++) {
    for (let col=0; col<NEON_VAULT_GRID[row].length; col++) {
      const ch = NEON_VAULT_GRID[row][col];
      if      (ch==='#')                   wallCount++;
      else if (ch==='.' || ch==='C' || ch==='B') floorCount++;
      else if (ch==='P')                   platCount++;
      else if (ch==='R')                   roofCount++;
      else if (ch==='K')                   cellarCount++;
    }
  }

  const boxGeo   = new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, TILE_SIZE);
  const slabGeo  = new THREE.BoxGeometry(TILE_SIZE, 0.3, TILE_SIZE);
  const beamGeo  = new THREE.BoxGeometry(0.08, WALL_HEIGHT + 0.08, 0.08);

  const wallMesh   = makeInstanced(boxGeo,  wallMat,   wallCount);
  const floorMesh  = makeInstanced(slabGeo, floorMat,  floorCount);
  const platMesh   = makeInstanced(slabGeo, platMat,   platCount);
  const roofMesh   = makeInstanced(slabGeo, roofMat,   roofCount);
  const cellarMesh = makeInstanced(slabGeo, cellarMat, cellarCount);
  const beamMesh   = makeInstanced(beamGeo, beamMat,   wallCount * 4);

  scene.add(wallMesh, floorMesh, platMesh, roofMesh, cellarMesh, beamMesh);

  const dummy = new THREE.Object3D();
  let wi=0, fi=0, pi=0, ri=0, ki=0, bi=0;

  // ── Tiles platzieren ─────────────────────────────────────────────────────────
  for (let row=0; row<NEON_VAULT_GRID.length; row++) {
    const rowStr = NEON_VAULT_GRID[row];
    for (let col=0; col<rowStr.length; col++) {
      const ch = rowStr[col];
      const { x, z } = worldPos(col, row);

      if (ch === '#') {
        const cy = WALL_HEIGHT / 2;
        dummy.position.set(x, cy, z); dummy.updateMatrix();
        wallMesh.setMatrixAt(wi++, dummy.matrix);
        // Neon-Kanten an 4 Ecken
        const half = TILE_SIZE/2 - 0.04;
        for (const [ox,oz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
          dummy.position.set(x + ox*half, cy, z + oz*half); dummy.updateMatrix();
          if (bi < wallCount*4) beamMesh.setMatrixAt(bi++, dummy.matrix);
        }
        addBox3Collider(x, cy, z, TILE_SIZE, WALL_HEIGHT, TILE_SIZE);

      } else if (ch === '.' || ch === 'C' || ch === 'B') {
        dummy.position.set(x, -0.15, z); dummy.updateMatrix();
        floorMesh.setMatrixAt(fi++, dummy.matrix);
        addSlabMesh(x, -0.15, z, TILE_SIZE, 0.3, TILE_SIZE, true, false);

      } else if (ch === 'K') {
        const ky = -CELLAR_DEPTH - 0.15;
        dummy.position.set(x, ky, z); dummy.updateMatrix();
        cellarMesh.setMatrixAt(ki++, dummy.matrix);
        addSlabMesh(x, ky, z, TILE_SIZE, 0.3, TILE_SIZE, true, false);

      } else if (ch === 'P') {
        dummy.position.set(x, PLAT_H - 0.15, z); dummy.updateMatrix();
        platMesh.setMatrixAt(pi++, dummy.matrix);
        addSlabMesh(x, PLAT_H - 0.15, z, TILE_SIZE, 0.3, TILE_SIZE, true, false);
        addBox3Collider(x, PLAT_H/2, z, TILE_SIZE, PLAT_H, TILE_SIZE);

      } else if (ch === 'R') {
        dummy.position.set(x, ROOF_H - 0.15, z); dummy.updateMatrix();
        roofMesh.setMatrixAt(ri++, dummy.matrix);
        addSlabMesh(x, ROOF_H - 0.15, z, TILE_SIZE, 0.3, TILE_SIZE, true, false);
        addBox3Collider(x, ROOF_H/2, z, TILE_SIZE, ROOF_H, TILE_SIZE);
      }
    }
  }

  wallMesh.instanceMatrix.needsUpdate   = true;
  floorMesh.instanceMatrix.needsUpdate  = true;
  platMesh.instanceMatrix.needsUpdate   = true;
  roofMesh.instanceMatrix.needsUpdate   = true;
  cellarMesh.instanceMatrix.needsUpdate = true;
  beamMesh.instanceMatrix.needsUpdate   = true;

  // ── Skybox (Tageshimmel, CS-Italy-Style) ─────────────────────────────────────
  const sky = new THREE.Mesh(new THREE.BoxGeometry(500, 200, 500), skyMat);
  sky.position.y = 50;
  const skyboxGroup = new THREE.Group();
  skyboxGroup.add(sky);
  scene.add(skyboxGroup);

  // ── Beleuchtung ───────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0xfff4e0, 0.7));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
  sun.position.set(50, 100, 30);
  scene.add(sun);

  // Zonen-Lichter
  const zoneLights = [
    { p: worldPos(10,  7), y: 3, color: 0xFF4422 }, // T Spawn
    { p: worldPos(10, 15), y: 3, color: 0x44BBFF }, // Keller
    { p: worldPos(15, 25), y: 3, color: 0xFFAA22 }, // Mid
    { p: worldPos(20, 35), y: 3, color: 0xFF6688 }, // Short
    { p: worldPos(13, 66), y: 3, color: 0x2244FF }, // CT Spawn
    { p: worldPos(25, 55), y: 3, color: 0x22FFCC }, // CT Long
    { p: worldPos(30, 45), y: 3, color: 0xFFFF22 }, // Market
    { p: worldPos(20, 50), y: 5, color: 0xFF44AA }, // Roof
  ];
  for (const { p, y, color } of zoneLights) {
    const pl = new THREE.PointLight(color, 1.5, 25);
    pl.position.set(p.x, y, p.z);
    scene.add(pl);
  }

  // ── Atmosphäre ────────────────────────────────────────────────────────────────
  scene.fog = new THREE.FogExp2(0xC8A878, 0.010);
  scene.background = new THREE.Color(0x87CEEB);

  // ── Spawn-Punkte sammeln ──────────────────────────────────────────────────────
  const spawnPoints = [];
  for (let row=0; row<NEON_VAULT_GRID.length; row++) {
    for (let col=0; col<NEON_VAULT_GRID[row].length; col++) {
      if (NEON_VAULT_GRID[row][col] === 'C') {
        const { x, z } = worldPos(col, row);
        spawnPoints.push({ x, y: 2.0, z });
      }
    }
  }

  colliders.spawnPoints   = spawnPoints;
  colliders.groundMeshes  = groundMeshes;
  colliders.skyboxGroup   = skyboxGroup;
  colliders.portalRings   = [];
  colliders.shootBlockers = shootBlockers;
  colliders.rampStats     = { placed: 0, total: 0 };
  colliders.towers        = [];
  colliders.ramps         = [];

  return colliders;
}
