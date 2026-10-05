// --- Einzelne Waffe: nimmt jetzt eine Konfiguration (siehe WEAPON_CONFIGS unten) statt fester Werte,
// damit mehrere unterschiedliche Waffentypen dieselbe Klasse nutzen können. ---
export class Weapon {
    constructor(camera, scene, config, onAmmoChange = null) {
        this.camera = camera;
        this.scene = scene;
        this.onAmmoChange = onAmmoChange; // callback(this) - wird bei jeder Munitions-/Reload-Änderung aufgerufen

        this.name = config.name;
        this.damage = config.damage;
        this.fireCooldown = config.fireCooldown; // Sekunden zwischen zwei Schüssen (Feuerrate)
        this.lastShotTime = -Infinity;

        // --- Munitionssystem ---
        this.magSize = config.magSize;
        this.ammoInMag = this.magSize;
        this.reserveAmmo = config.reserveAmmo;
        this.isReloading = false;
        this.reloadDuration = config.reloadDuration;
        this.infiniteAmmo = config.infiniteAmmo ?? true; // Magazin leert sich nie, kein Nachladen nötig

        this.weaponGroup = new THREE.Group();
        config.buildModel(this.weaponGroup);
        this.weaponGroup.position.set(0.3, -0.25, -0.5);
        this.weaponGroup.visible = false; // WeaponManager blendet die aktive Waffe ein
        this.camera.add(this.weaponGroup);

        this._notifyAmmoChange();
    }

    _notifyAmmoChange() {
        if (this.onAmmoChange) this.onAmmoChange(this);
    }

    // Gibt true zurück, wenn tatsächlich geschossen wurde (main.js nutzt das,
    // um Tracer/Netzwerk-Events nur bei echten Treffern zu senden)
    shoot() {
        const now = performance.now() / 1000;
        if (now - this.lastShotTime < this.fireCooldown) return false; // Feuerrate noch nicht bereit
        if (this.isReloading) return false;

        if (!this.infiniteAmmo && this.ammoInMag <= 0) {
            this._dryFire();
            return false;
        }

        this.lastShotTime = now;

        if (!this.infiniteAmmo) {
            this.ammoInMag -= 1;
            this._notifyAmmoChange();
        }

        // Rückstoß
        this.weaponGroup.position.z += 0.08;
        setTimeout(() => { this.weaponGroup.position.z -= 0.08; }, 50);

        // Mündungsfeuer
        const flashGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const flash = new THREE.Mesh(flashGeo, flashMat);
        flash.position.set(0.3, -0.15, -0.85);

        this.camera.add(flash);
        setTimeout(() => { this.camera.remove(flash); }, 40);

        return true;
    }

    // Leeres Magazin: kurzes "Klick"-Feedback statt Schuss
    _dryFire() {
        this.weaponGroup.position.x += 0.02;
        setTimeout(() => { this.weaponGroup.position.x -= 0.02; }, 60);
    }

    reload() {
        if (this.infiniteAmmo) return; // nie nötig
        if (this.isReloading) return;
        if (this.ammoInMag === this.magSize) return; // Magazin schon voll
        if (this.reserveAmmo <= 0) return; // keine Reserve mehr übrig

        this.isReloading = true;
        this._notifyAmmoChange();

        // Waffe während des Nachladens leicht absenken (visuelles Feedback)
        this.weaponGroup.position.y -= 0.15;

        setTimeout(() => {
            const needed = this.magSize - this.ammoInMag;
            const amount = Math.min(needed, this.reserveAmmo);
            this.ammoInMag += amount;
            this.reserveAmmo -= amount;
            this.isReloading = false;

            this.weaponGroup.position.y += 0.15;
            this._notifyAmmoChange();
        }, this.reloadDuration);
    }
}

// Funktion für gelben Laser-Tracerstrahl im Raum
export function createTracer(scene, startPos, endPos) {
    const material = new THREE.LineBasicMaterial({ color: 0xffcc00, linewidth: 2 });
    const points = [
        new THREE.Vector3(startPos.x, startPos.y, startPos.z),
        new THREE.Vector3(endPos.x, endPos.y, endPos.z)
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    scene.add(line);

    setTimeout(() => {
        scene.remove(line);
        geometry.dispose();
        material.dispose();
    }, 80);
}

// --- Modell-Baufunktionen pro Waffentyp (bauen die Meshes direkt in die übergebene Gruppe) ---

function buildRifleModel(group) {
    const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.3, 0.1),
        new THREE.MeshBasicMaterial({ color: 0x111111 })
    );
    group.add(handle);

    const barrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 0.6),
        new THREE.MeshBasicMaterial({ color: 0x333333 })
    );
    barrel.position.set(0, 0.1, -0.2);
    group.add(barrel);

    const scopeBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.3),
        new THREE.MeshBasicMaterial({ color: 0x1a1a1a })
    );
    scopeBase.position.set(0, 0.19, -0.25);
    group.add(scopeBase);

    const scopeLens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12),
        new THREE.MeshBasicMaterial({ color: 0x00f0ff })
    );
    scopeLens.rotation.x = Math.PI / 2;
    scopeLens.position.set(0, 0.19, -0.4);
    group.add(scopeLens);
}

function buildPistolModel(group) {
    const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.22, 0.09),
        new THREE.MeshBasicMaterial({ color: 0x151515 })
    );
    handle.position.set(0, -0.08, 0.05);
    group.add(handle);

    const slide = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.09, 0.32),
        new THREE.MeshBasicMaterial({ color: 0x2a2a2a })
    );
    slide.position.set(0, 0.02, -0.08);
    group.add(slide);

    const sight = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.03, 0.03),
        new THREE.MeshBasicMaterial({ color: 0xff0055 })
    );
    sight.position.set(0, 0.075, -0.22);
    group.add(sight);
}

function buildSniperModel(group) {
    const stock = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.1, 0.4),
        new THREE.MeshBasicMaterial({ color: 0x1a1512 })
    );
    stock.position.set(0, -0.02, 0.1);
    group.add(stock);

    const barrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, 1.0),
        new THREE.MeshBasicMaterial({ color: 0x222222 })
    );
    barrel.position.set(0, 0.07, -0.55);
    group.add(barrel);

    const scopeBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.4, 12),
        new THREE.MeshBasicMaterial({ color: 0x151515 })
    );
    scopeBody.rotation.x = Math.PI / 2;
    scopeBody.position.set(0, 0.22, -0.35);
    group.add(scopeBody);

    const scopeLens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.02, 12),
        new THREE.MeshBasicMaterial({ color: 0xff0055 })
    );
    scopeLens.rotation.x = Math.PI / 2;
    scopeLens.position.set(0, 0.22, -0.56);
    group.add(scopeLens);
}

// --- Waffentypen: magSize/reserveAmmo/reloadDuration greifen nur, falls infiniteAmmo auf false
// gesetzt wird. Reihenfolge hier = Reihenfolge beim Wechseln mit 1/2/3. ---
export const WEAPON_CONFIGS = [
    {
        name: 'Rifle', damage: 20, fireCooldown: 0.1,
        magSize: 12, reserveAmmo: 84, reloadDuration: 1500,
        buildModel: buildRifleModel
    },
    {
        name: 'Pistol', damage: 15, fireCooldown: 0.18,
        magSize: 10, reserveAmmo: 60, reloadDuration: 1000,
        buildModel: buildPistolModel
    },
    {
        name: 'Sniper', damage: 75, fireCooldown: 1.2,
        magSize: 5, reserveAmmo: 25, reloadDuration: 2200,
        buildModel: buildSniperModel
    }
];

// --- WeaponManager: hält alle Waffen gleichzeitig (an derselben Kamera), blendet beim Wechsel nur
// die jeweils aktive ein/aus (kein Neu-Erstellen nötig -> sofortiger, flüssiger Wechsel). ---
export class WeaponManager {
    constructor(camera, scene, onAmmoChange = null) {
        this.onAmmoChange = onAmmoChange;
        this.weapons = WEAPON_CONFIGS.map(
            config => new Weapon(camera, scene, config, (w) => this._handleWeaponAmmoChange(w))
        );
        this.activeIndex = 0;
        this.weapons[this.activeIndex].weaponGroup.visible = true;
        this._notify();
    }

    get current() { return this.weapons[this.activeIndex]; }

    // Proxy-Eigenschaften, damit main.js/HUD-Code wie bisher einfach "weapon.xyz" lesen kann,
    // ohne überall ".current" einfügen zu müssen.
    get name() { return this.current.name; }
    get damage() { return this.current.damage; }
    get ammoInMag() { return this.current.ammoInMag; }
    get reserveAmmo() { return this.current.reserveAmmo; }
    get magSize() { return this.current.magSize; }
    get isReloading() { return this.current.isReloading; }
    get infiniteAmmo() { return this.current.infiniteAmmo; }

    shoot() { return this.current.shoot(); }
    reload() { this.current.reload(); }

    switchTo(index) {
        if (index < 0 || index >= this.weapons.length || index === this.activeIndex) return;
        this.current.weaponGroup.visible = false;
        this.activeIndex = index;
        this.current.weaponGroup.visible = true;
        this._notify();
    }

    switchNext() {
        this.switchTo((this.activeIndex + 1) % this.weapons.length);
    }

    _handleWeaponAmmoChange(weapon) {
        // Nur HUD aktualisieren, wenn sich die gerade AKTIVE Waffe ändert (z.B. Nachladen im
        // Hintergrund einer nicht ausgerüsteten Waffe soll das HUD nicht beeinflussen)
        if (weapon === this.current) this._notify();
    }

    _notify() {
        if (this.onAmmoChange) {
            this.onAmmoChange(this.current.ammoInMag, this.current.reserveAmmo, this.current.isReloading, this.current.name, this.current.magSize);
        }
    }
}
// Funktion für gelben Laser-Tracerstrahl im Raum
export function createTracer(scene, startPos, endPos) {
    const material = new THREE.LineBasicMaterial({ color: 0xffcc00, linewidth: 2 });
    const points = [
        new THREE.Vector3(startPos.x, startPos.y, startPos.z),
        new THREE.Vector3(endPos.x, endPos.y, endPos.z)
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    scene.add(line);

    setTimeout(() => {
        scene.remove(line);
        geometry.dispose();
        material.dispose();
    }, 80);
}
