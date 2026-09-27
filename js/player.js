// player.js — lädt "Walk_With_Rifle.fbx" einmal, klont es pro Spieler (inkl. Skelett/Animation)
// und spielt die Lauf-Animation in Dauerschleife ab.

const MODEL_PATH = 'models/Walk_With_Rifle.fbx';
const MODEL_SCALE = 0.01; // Die meisten FBX-Rigs (z.B. Mixamo) sind in cm -> auf Meter skalieren.
                          // Wenn der Charakter zu klein/groß wirkt, hier anpassen.

let cachedModel = null;
let cachedAnimation = null;
let loadPromise = null;

function loadWalkModel() {
    if (loadPromise) return loadPromise; // nur einmal laden, egal wie viele Spieler joinen

    loadPromise = new Promise((resolve, reject) => {
        // Absichtlich erst HIER (nicht auf Modul-Ebene) erstellt: falls THREE.FBXLoader aus
        // irgendeinem Grund nicht verfügbar ist, würde ein Fehler auf Modul-Ebene den kompletten
        // Import von main.js zum Absturz bringen -> ganzes Spiel lädt nicht mehr. So bleibt der
        // Fehler lokal auf "Modell konnte nicht geladen werden" begrenzt.
        if (typeof THREE.FBXLoader !== 'function') {
            console.error('THREE.FBXLoader ist nicht verfügbar (Script nicht geladen?). Spieler bleiben als Platzhalter-Box sichtbar.');
            reject(new Error('THREE.FBXLoader missing'));
            return;
        }

        const fbxLoader = new THREE.FBXLoader();

        fbxLoader.load(
            MODEL_PATH,
            (fbx) => {
                cachedModel = fbx;
                cachedAnimation = fbx.animations[0] || null;
                if (!cachedAnimation) {
                    console.warn('Walk_With_Rifle.fbx enthält keine Animation-Clips.');
                }
                resolve();
            },
            undefined,
            (err) => {
                console.error('FBX-Ladefehler (models/Walk_With_Rifle.fbx) — liegt die Datei im models/-Ordner neben index.html?', err);
                reject(err);
            }
        );
    });

    return loadPromise;
}

export function createPlayerMesh(id) {
    const group = new THREE.Group();
    group.userData.id = id; // Wichtig für Raycasting-Treffererkennung!
    group.userData.mixer = null; // wird gesetzt, sobald das Modell geladen + geklont ist

    // Platzhalter-Box: sichtbar, solange das FBX-Modell noch lädt (verhindert unsichtbare Spieler)
    const placeholderGeo = new THREE.BoxGeometry(0.8, 1.8, 0.5);
    const placeholderMat = new THREE.MeshBasicMaterial({ color: 0xcc2222 });
    const placeholder = new THREE.Mesh(placeholderGeo, placeholderMat);
    placeholder.position.y = 0.9;
    group.add(placeholder);

    loadWalkModel()
        .then(() => {
            try {
                // SkeletonUtils.clone statt object.clone() -> nötig, damit jeder Spieler sein
                // eigenes, unabhängiges Skelett/Animation hat (sonst teilen sich alle Spieler
                // dieselbe Pose). Fallback auf normales clone(), falls SkeletonUtils fehlt
                // (Animation könnte dann zwischen Spielern geteilt sein, aber besser als nichts).
                const hasSkeletonUtils = typeof THREE.SkeletonUtils !== 'undefined'
                    && typeof THREE.SkeletonUtils.clone === 'function';

                if (!hasSkeletonUtils) {
                    console.warn('THREE.SkeletonUtils nicht verfügbar — nutze normales clone() als Fallback.');
                }

                const model = hasSkeletonUtils
                    ? THREE.SkeletonUtils.clone(cachedModel)
                    : cachedModel.clone(true);

                model.scale.setScalar(MODEL_SCALE);

                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                // Platzhalter erst JETZT entfernen — nachdem das Modell sicher fertig aufgebaut ist
                group.remove(placeholder);
                placeholderGeo.dispose();
                placeholderMat.dispose();

                group.add(model);

                if (cachedAnimation) {
                    const mixer = new THREE.AnimationMixer(model);
                    const action = mixer.clipAction(cachedAnimation);
                    action.play();
                    group.userData.mixer = mixer;
                }
            } catch (err) {
                console.error('Fehler beim Aufbau des Spieler-Modells — Platzhalter-Box bleibt sichtbar:', err);
            }
        })
        .catch(() => {
            // Platzhalter bleibt einfach stehen, falls das Modell nicht geladen werden konnte
        });

    return group;
}

// Muss in main.js pro Frame aufgerufen werden (mit delta-Zeit), damit die
// Lauf-Animation aller anderen Spieler-Meshes tatsächlich abgespielt wird.
export function updatePlayerAnimations(playerMeshesList, delta) {
    for (const mesh of playerMeshesList) {
        if (mesh.userData.mixer) {
            mesh.userData.mixer.update(delta);
        }
    }
}
