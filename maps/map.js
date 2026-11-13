// js/map.js  —  CS Mirage (GLB-derived, multi-level)
// Skala: 2 m pro Tile (GLB bereits in Metern)
// Ebenen: Boden (.), Tunnel/Keller (K), Plattform (P), Dach (R), Spawn (C)

const TILE_SIZE    = 2.0;
const WALL_HEIGHT  = 5.0;
const PLAT_H       = 2.5;
const ROOF_H       = 5.0;
const CELLAR_DEPTH = 3.5;

const MIRAGE_GRID = [
  '#############################################################',
  '##K#   #K#                                                  #',
  '#K#   #K# #                  #       ## #  #                #',
  '##  # ##  #     #           ### # ## #K#K#    #             #',
  '#K##K#K#########K#### ##      #####K######## ##             #',
  '##K## ###CK#K##K..KK##K#      #KK.#K### #### #K# #  #       #',
  '# #    ##KK#K##..KKK...#    ##..KKK##########K#K#K#         #',
  '# ######KKK########.##KK### #.KKKK#  #KKK####KK..#  ##   # ##',
  '# #KK###KKCK#  #  ##########K##KKK.# ##K..K......###     #  #',
  '# #CK#CCC.##K##K###K##  ##KKK###KK#####..K##KKK.KKKK# #     #',
  '## ##..K..#K.K#...## ############# #  #KK#  ##.#.CKK##R#    #',
  '## # #.K..K...K...## ###K## ##K##     #K..#   ###KKKC##     #',
  '#   ##.K..#K..#K..#K#K### ##  #      ##...#     #K#K# #     #',
  '#    ##K..#..K#...## #K###K#         #K.##      #####       #',
  '#      #K.##K##...#  #KKK#K#####     ####    #  #CKC#    # ##',
  '#      #.....K.....## ##K#K#  #K######K.#   #.# #CC.#       #',
  '#      #KK.KKK.KKK# # #.K###   # #   #K..###K.K#..K.#       #',
  '#       #########K## ##K.#K## #K##  ##K..K#.K..#....#       #',
  '#      ###  ###K.#  #K####.K#####K###K..KK#.K.K.KKK.#       #',
  '#       ## #####.K# ####K#..K..K.KK....K.K###.#.#..P#       #',
  '#     ###K#K.# ##.# # ##K#K#KK.#.K.......K# ####....#       #',
  '#       #KK.K.##KK# ##K#K...K....#.....KKK#   # #.#K.#      #',
  '#       #..##K# #K##K#K#.K.K..K....#...KKK##   #...P#       #',
  '#        ##  # #############K##K.#.K...K.K#    #..K..#      #',
  '#              #K.K.####K.##K# #KK.K....KK#    ####K#       #',
  '#         ###  ##.K.##K#..######...#..#K.KK#### ##KP.#      #',
  '#            # ##.KK### #KKKKK###.........# ## # #K.#       #',
  '#            # #K.K##K## ###K.# #..##K....###   # #K.#      #',
  '#           #.##KK######  ##K##  ##  ##....#K# #K##K#       #',
  '#          #......###KK########   #  ##...# #K#######       #',
  '#          #K.K#K.###K...K.KKK#  ####K#####  # ####K#       #',
  '#         #....K.K# #K.K...K.####K#KKK####  #####K####      #',
  '#         #..K.#..######K##..####KK.KK#KK###K######         #',
  '#         #....#...## #####......KK..K##K##K#  ##           #',
  '#         #K####K.K##  ###K...K.....K#####K## ###           #',
  '#          #K..K..K###  #KK.......KK#  # ##   ###           #',
  '#         #......KK##   #KK........K#  ###    #K#           #',
  '#          #.K.K..KK#   ##K.KKK....KK##  #### #K# # #       #',
  '#           #K##..K######KK.KKK.K..KK##  #K# #KK##R##       #',
  '#            #  #K.K#.##.##....KK..K#####.#K##.K# #         #',
  '#               #..KKK.K.##....K..K####.#K...K.K#           #',
  '#                #KK.KKKKK...K...#K#KK###K.....K#           #',
  '#                 #.KKKKK....K####K#.## #..##..#            #',
  '#                  ##...KK.###K#  # #    ##  ##             #',
  '#                   #..#..K#  #                             #',
  '#                    ## ###                                 #',
  '#                         #                                 #',
  '#############################################################',
];

export function setupMap(scene) {
  const colliders    = [];
  const groundMeshes = [];
  const shootBlockers= [];

  const halfC = Math.floor(MIRAGE_GRID[0].length / 2);
  const halfR = Math.floor(MIRAGE_GRID.length    / 2);

  function worldPos(col, row) {
    return { x: (col - halfC) * TILE_SIZE, z: (row - halfR) * TILE_SIZE };
  }

  function makeInstanced(geo, mat, count) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.frustumCulled = false;
    m.instanceMatrix.needsUpdate = true;
    return m;
  }

  function addBox3Collider(x, cy, z, w, h, d) {
    const box = new THREE.Box3();
    box.setFromCenterAndSize(
      new THREE.Vector3(x, cy, z),
      new THREE.Vector3(w, h, d)
    );
    colliders.push(box);
  }

  function addSlabMesh(x, y, z, w, h, d, forGround) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    mesh.position.set(x, y, z);
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    if (forGround) groundMeshes.push(mesh);
    return mesh;
  }

  // Mirage: Sand / Blau / Mauerwerk
  const wallMat   = new THREE.MeshLambertMaterial({ color: 0xC4A882 });
  const floorMat  = new THREE.MeshLambertMaterial({ color: 0xD4B896 });
  const platMat   = new THREE.MeshLambertMaterial({ color: 0xB89C74 });
  const roofMat   = new THREE.MeshLambertMaterial({ color: 0x9C8060 });
  const cellarMat = new THREE.MeshLambertMaterial({ color: 0x60707A });
  const accentMat = new THREE.MeshLambertMaterial({ color: 0x2244AA, emissive: new THREE.Color(0x112266) });
  const skyMat    = new THREE.MeshLambertMaterial({ color: 0xB0D4F0, side: THREE.BackSide });

  let wallCount=0, floorCount=0, platCount=0, roofCount=0, cellarCount=0;
  for (let row=0; row<MIRAGE_GRID.length; row++) {
    for (let col=0; col<MIRAGE_GRID[row].length; col++) {
      const ch = MIRAGE_GRID[row][col];
      if      (ch==='#')               wallCount++;
      else if (ch==='.' || ch==='C')   floorCount++;
      else if (ch==='P')               platCount++;
      else if (ch==='R')               roofCount++;
      else if (ch==='K')               cellarCount++;
    }
  }

  const boxGeo  = new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, TILE_SIZE);
  const slabGeo = new THREE.BoxGeometry(TILE_SIZE, 0.3,         TILE_SIZE);
  const beamGeo = new THREE.BoxGeometry(0.1, WALL_HEIGHT + 0.1, 0.1);

  const wallMesh   = makeInstanced(boxGeo,  wallMat,   wallCount);
  const floorMesh  = makeInstanced(slabGeo, floorMat,  floorCount);
  const platMesh   = makeInstanced(slabGeo, platMat,   platCount);
  const roofMesh   = makeInstanced(slabGeo, roofMat,   roofCount);
  const cellarMesh = makeInstanced(slabGeo, cellarMat, cellarCount);
  const beamMesh   = makeInstanced(beamGeo, accentMat, wallCount * 4);

  scene.add(wallMesh, floorMesh, platMesh, roofMesh, cellarMesh, beamMesh);

  const dummy = new THREE.Object3D();
  let wi=0, fi=0, pi=0, ri=0, ki=0, bi=0;

  for (let row=0; row<MIRAGE_GRID.length; row++) {
    const rowStr = MIRAGE_GRID[row];
    for (let col=0; col<rowStr.length; col++) {
      const ch = rowStr[col];
      const { x, z } = worldPos(col, row);

      if (ch === '#') {
        const cy = WALL_HEIGHT / 2;
        dummy.position.set(x, cy, z); dummy.updateMatrix();
        wallMesh.setMatrixAt(wi++, dummy.matrix);
        addBox3Collider(x, cy, z, TILE_SIZE, WALL_HEIGHT, TILE_SIZE);
        const half = TILE_SIZE/2 - 0.05;
        for (const [ox,oz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
          dummy.position.set(x+ox*half, cy, z+oz*half); dummy.updateMatrix();
          if (bi < wallCount*4) beamMesh.setMatrixAt(bi++, dummy.matrix);
        }

      } else if (ch === '.' || ch === 'C') {
        dummy.position.set(x, -0.15, z); dummy.updateMatrix();
        floorMesh.setMatrixAt(fi++, dummy.matrix);
        addSlabMesh(x, -0.15, z, TILE_SIZE, 0.3, TILE_SIZE, true);

      } else if (ch === 'K') {
        const ky = -CELLAR_DEPTH - 0.15;
        dummy.position.set(x, ky, z); dummy.updateMatrix();
        cellarMesh.setMatrixAt(ki++, dummy.matrix);
        addSlabMesh(x, ky, z, TILE_SIZE, 0.3, TILE_SIZE, true);

      } else if (ch === 'P') {
        dummy.position.set(x, PLAT_H - 0.15, z); dummy.updateMatrix();
        platMesh.setMatrixAt(pi++, dummy.matrix);
        addSlabMesh(x, PLAT_H - 0.15, z, TILE_SIZE, 0.3, TILE_SIZE, true);
        addBox3Collider(x, PLAT_H/2, z, TILE_SIZE, PLAT_H, TILE_SIZE);

      } else if (ch === 'R') {
        dummy.position.set(x, ROOF_H - 0.15, z); dummy.updateMatrix();
        roofMesh.setMatrixAt(ri++, dummy.matrix);
        addSlabMesh(x, ROOF_H - 0.15, z, TILE_SIZE, 0.3, TILE_SIZE, true);
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

  // Skybox
  const sky = new THREE.Mesh(new THREE.BoxGeometry(600, 300, 600), skyMat);
  sky.position.y = 80;
  const skyboxGroup = new THREE.Group();
  skyboxGroup.add(sky);
  scene.add(skyboxGroup);

  // Beleuchtung
  scene.add(new THREE.AmbientLight(0xFFF5E0, 0.75));
  const sun = new THREE.DirectionalLight(0xFFF5D0, 1.1);
  sun.position.set(80, 150, 50);
  scene.add(sun);

  const halfCols = MIRAGE_GRID[0].length / 2;
  const halfRows = MIRAGE_GRID.length    / 2;
  const zoneLights = [
    { x: (-halfCols+5)*TILE_SIZE,  y: 3, z: 0,                      color: 0xFF4422 }, // T Spawn
    { x: (halfCols-5)*TILE_SIZE,   y: 3, z: 0,                      color: 0x2244FF }, // CT Spawn
    { x: 0,                        y: 3, z: (-halfRows+8)*TILE_SIZE, color: 0xFFAA22 }, // A
    { x: 0,                        y: 3, z: (halfRows-8)*TILE_SIZE,  color: 0x22FFAA }, // B
    { x: 0,                        y: 2, z: 0,                      color: 0xFFFFAA }, // Mid
    { x: -15,                      y:-2, z: 0,                      color: 0x4488CC }, // Tunnel
  ];
  for (const { x, y, z, color } of zoneLights) {
    const pl = new THREE.PointLight(color, 1.5, 30);
    pl.position.set(x, y, z);
    scene.add(pl);
  }

  scene.fog = new THREE.FogExp2(0xC8B090, 0.008);
  scene.background = new THREE.Color(0xB0D4F0);

  const spawnPoints = [];
  for (let row=0; row<MIRAGE_GRID.length; row++) {
    for (let col=0; col<MIRAGE_GRID[row].length; col++) {
      if (MIRAGE_GRID[row][col] === 'C') {
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
