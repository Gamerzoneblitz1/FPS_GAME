export class Weapon {
    constructor(camera, scene, onAmmoChange = null) {
        this.camera = camera;
        this.scene = scene;
        this.onAmmoChange = onAmmoChange; // callback(ammoInMag, reserveAmmo, isReloading)

        // --- Munitionssystem ---
        this.magSize = 12;
        this.ammoInMag = this.magSize;
        this.reserveAmmo = 84; // 7 weitere Magazine in Reserve
        this.isReloading = false;
        this.reloadDuration = 1500; // ms

        this.weaponGroup = new THREE.Group();

        const handleGeo = new THREE.BoxGeometry(0.1, 0.3, 0.1);
        const handleMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
        const handle = new THREE.Mesh(handleGeo, handleMat);

        const barrelGeo = new THREE.BoxGeometry(0.12, 0.12, 0.6);
        const barrelMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.position.set(0, 0.1, -0.2);

        // Scope (Referenzbild-Look): kleiner Aufsatz mit leuchtender Linse
        const scopeBaseGeo = new THREE.BoxGeometry(0.08, 0.08, 0.3);
        const scopeBaseMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
        const scopeBase = new THREE.Mesh(scopeBaseGeo, scopeBaseMat);
        scopeBase.position.set(0, 0.19, -0.25);

        const scopeLensGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12);
        const scopeLensMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
        const scopeLensFront = new THREE.Mesh(scopeLensGeo, scopeLensMat);
        scopeLensFront.rotation.x = Math.PI / 2;
        scopeLensFront.position.set(0, 0.19, -0.4);

        this.weaponGroup.add(handle);
        this.weaponGroup.add(barrel);
        this.weaponGroup.add(scopeBase);
        this.weaponGroup.add(scopeLensFront);

        this.weaponGroup.position.set(0.3, -0.25, -0.5);
        this.camera.add(this.weaponGroup);

        this._notifyAmmoChange();
    }

    _notifyAmmoChange() {
        if (this.onAmmoChange) {
            this.onAmmoChange(this.ammoInMag, this.reserveAmmo, this.isReloading);
        }
    }

    // Gibt true zurück, wenn tatsächlich geschossen wurde (main.js nutzt das,
    // um Tracer/Netzwerk-Events nur bei echten Treffern zu senden)
    shoot() {
        if (this.isReloading) return false;

        if (this.ammoInMag <= 0) {
            this._dryFire();
            return false;
        }

        this.ammoInMag -= 1;
        this._notifyAmmoChange();

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
