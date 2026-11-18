// modes.js — Anzeige und Eingaben der Spielmodi (Bombplant, Rettungsmission; Deathmatch hat nichts Besonderes).
// Der Server (server.js) hält Teams, Runden, Bombe und Geiseln; hier werden sie gezeichnet:
//  - HUD oben: Modus, Punktestand T : CT, Rundenzeit, Bomben-Countdown, Rundenende-Banner
//  - HUD unten: Hinweis (z.B. "E halten: Bombe legen") und Fortschrittsbalken
//  - 3D: Bombenplätze A/B, Bombe, Geiseln, Rettungszone

export const TEAM_COLORS = { T: '#ffa93a', CT: '#4aa8ff' };
export const TEAM_NAMES = { T: 'TERRORISTEN', CT: 'ANTI-TERROR' };
const hex = (c) => parseInt(c.slice(1), 16);

function label(text, color, size = 1.2) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.font = 'bold 84px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 16; g.fillStyle = color;
    g.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.scale.set(size * 2, size, 1);
    sp.renderOrder = 10;
    return sp;
}

export function createModes({ scene, getMe, getMyId, sendHold, notice }) {
    const root = new THREE.Group();
    root.visible = false;
    scene.add(root);
    let state = { mode: 'dm' }, layout = null, teams = {}, recvAt = 0;
    let holding = false;
    const sites = [], hostages = [];
    let bombMesh = null, zoneMesh = null;

    // ---------- HUD ----------
    const css = document.createElement('style');
    css.textContent = `
    #mode-bar{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:4;display:none;pointer-events:none;font-family:monospace;text-align:center;color:#fff;text-shadow:0 0 6px #000}
    #mode-bar .mb-row{display:flex;align-items:center;gap:0;justify-content:center}
    #mode-bar .mb-team{min-width:70px;padding:5px 12px;font-size:20px;font-weight:800;background:rgba(5,8,22,.78);border:1px solid rgba(255,255,255,.15)}
    #mode-bar .mb-time{min-width:96px;padding:5px 10px;font-size:22px;font-weight:800;background:rgba(5,8,22,.9);border:1px solid rgba(255,255,255,.2);letter-spacing:2px}
    #mode-bar .mb-sub{margin-top:3px;font-size:11px;letter-spacing:2px;color:#cfe;opacity:.9}
    #mode-bar .mb-my{display:inline-block;margin-top:2px;font-size:11px;letter-spacing:2px;font-weight:700;padding:1px 8px}
    #mode-prompt{position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:4;display:none;pointer-events:none;text-align:center;font-family:monospace;color:#fff;text-shadow:0 0 8px #000}
    #mode-prompt .mp-text{font-size:16px;font-weight:700;letter-spacing:1px;padding:6px 14px;background:rgba(5,8,22,.75);border:1px solid rgba(0,240,255,.45)}
    #mode-prompt .mp-bar{margin:6px auto 0;width:240px;height:10px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);display:none}
    #mode-prompt .mp-bar i{display:block;height:100%;width:0;background:#00f0ff;box-shadow:0 0 8px #00f0ff}
    #mode-banner{position:fixed;left:50%;top:26%;transform:translateX(-50%);z-index:6;display:none;pointer-events:none;text-align:center;font-family:monospace;color:#fff;text-shadow:0 0 14px #000}
    #mode-banner .b1{font-size:34px;font-weight:900;letter-spacing:4px}
    #mode-banner .b2{font-size:15px;letter-spacing:2px;margin-top:4px;opacity:.9}`;
    document.head.appendChild(css);
    const bar = document.createElement('div'); bar.id = 'mode-bar'; document.body.appendChild(bar);
    const prompt = document.createElement('div'); prompt.id = 'mode-prompt';
    prompt.innerHTML = '<div class="mp-text"></div><div class="mp-bar"><i></i></div>';
    document.body.appendChild(prompt);
    const banner = document.createElement('div'); banner.id = 'mode-banner'; document.body.appendChild(banner);
    const pText = prompt.querySelector('.mp-text'), pBar = prompt.querySelector('.mp-bar'), pFill = prompt.querySelector('.mp-bar i');

    const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    const leftMs = () => Math.max(0, (state.leftMs || 0) - (performance.now() - recvAt));
    const myTeam = () => teams[getMyId()];

    // ---------- 3D-Objekte ----------
    function clearObjects() {
        while (root.children.length) root.remove(root.children[0]);
        sites.length = 0; hostages.length = 0; bombMesh = null; zoneMesh = null;
    }
    function buildObjects() {
        clearObjects();
        if (!layout) return;
        layout.sites.forEach((s, i) => {
            const g = new THREE.Group(); g.position.set(s.x, s.y, s.z);
            const col = i ? 0xffd24a : 0x00f0ff;
            const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.09, 8, 48), new THREE.MeshBasicMaterial({ color: col }));
            ring.rotation.x = Math.PI / 2; ring.position.y = 0.08; g.add(ring);
            const col2 = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 5, 36, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
            col2.position.y = 2.5; g.add(col2);
            const lb = label(s.name, i ? '#ffd24a' : '#00f0ff', 2.4); lb.position.y = 4.2; g.add(lb);
            g.visible = false; root.add(g); sites.push(g);
        });
        zoneMesh = new THREE.Group(); zoneMesh.position.set(layout.ct.x, layout.ct.y + 0.06, layout.ct.z);
        const zr = new THREE.Mesh(new THREE.RingGeometry(8.6, 9, 56), new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
        zr.rotation.x = -Math.PI / 2; zoneMesh.add(zr);
        const zl = label('RETTUNG', '#39ff14', 1.6); zl.position.y = 3; zoneMesh.add(zl);
        zoneMesh.visible = false; root.add(zoneMesh);
        // Bombe
        bombMesh = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.38), new THREE.MeshBasicMaterial({ color: 0x1b1d26 }));
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2030 }));
        led.position.set(0.15, 0.15, 0); led.name = 'led';
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.2), new THREE.MeshBasicMaterial({ color: 0xff7a00 }));
        strip.position.y = 0.12;
        bombMesh.add(body, led, strip); bombMesh.visible = false; root.add(bombMesh);
        // Geiseln
        layout.hostages.forEach(() => {
            const g = new THREE.Group();
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.0, 12), new THREE.MeshBasicMaterial({ color: 0xffb300 }));
            body.position.y = 0.75;
            const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10), new THREE.MeshBasicMaterial({ color: 0x3a3a46 }));
            legs.position.y = 0.25;
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: 0xf2c9a0 }));
            head.position.y = 1.45;
            const lb = label('GEISEL', '#ffd24a', 0.7); lb.position.y = 2.1;
            g.add(body, legs, head, lb); g.visible = false; root.add(g);
            hostages.push({ g, tx: 0, ty: 0, tz: 0, init: false });
        });
    }

    function applyState() {
        const mode = state.mode;
        root.visible = mode !== 'dm' && !!layout;
        sites.forEach(g => { g.visible = mode === 'bomb'; });
        if (zoneMesh) zoneMesh.visible = mode === 'rescue';
        if (bombMesh) {
            const b = state.bomb;
            bombMesh.visible = !!b && (b.state === 'dropped' || b.state === 'planted');
            if (b && bombMesh.visible) bombMesh.position.set(b.x, b.y + 0.12, b.z);
        }
        hostages.forEach((h, i) => {
            const s = state.hostages && state.hostages[i];
            h.g.visible = mode === 'rescue' && !!s && !s.rescued;
            if (s) { h.tx = s.x; h.ty = s.y; h.tz = s.z; if (!h.init) { h.g.position.set(s.x, s.y, s.z); h.init = true; } }
        });
    }

    // ---------- Hinweise ----------
    function promptInfo() {
        const me = getMe(), id = getMyId(), team = myTeam();
        if (!me || !team || state.phase !== 'live') return null;
        const d2 = (p) => Math.hypot(p.x - me.x, p.z - me.z);
        if (state.mode === 'bomb' && state.bomb) {
            const b = state.bomb;
            if (team === 'T') {
                if (b.state === 'carried' && b.carrier === id) {
                    const near = layout && layout.sites.find(s => d2(s) <= 3.4);
                    return near ? { text: '[E] HALTEN: BOMBE LEGEN (' + near.name + ')', hold: true } : { text: 'DU TRÄGST DIE BOMBE – BRING SIE ZU A ODER B' };
                }
                if (b.state === 'dropped') return { text: 'BOMBE LIEGT AM BODEN – LAUF HIN' };
                if (b.state === 'planted') return { text: 'BEWACHE DIE BOMBE' };
            } else if (b.state === 'planted') return d2(b) <= 3.2 ? { text: '[E] HALTEN: BOMBE ENTSCHÄRFEN', hold: true } : { text: 'ENTSCHÄRFE DIE BOMBE!' };
        }
        if (state.mode === 'rescue' && state.hostages && team === 'CT') {
            if (state.hostages.some(h => h.carrier === id)) return { text: 'BRING DIE GEISEL ZUR GRÜNEN RETTUNGSZONE' };
            const h = state.hostages.find(x => !x.rescued && !x.carrier && d2(x) <= 3.2);
            if (h) return { text: '[E] HALTEN: GEISEL BEFREIEN', hold: true };
        }
        return null;
    }

    function updateHud() {
        const mode = state.mode;
        if (mode === 'dm' || !layout && state.phase !== 'nolayout') { bar.style.display = 'none'; prompt.style.display = 'none'; banner.style.display = 'none'; return; }
        const team = myTeam();
        bar.style.display = 'block';
        const phase = state.phase;
        let timer = phase === 'live' ? fmt(leftMs()) : (phase === 'end' ? '–' : '…');
        let sub = (state.name || '').toUpperCase() + (state.roundNo ? ' · RUNDE ' + state.roundNo : '');
        if (phase === 'nolayout') sub = (state.name || '').toUpperCase() + ' · KARTE WIRD VORBEREITET …';
        let timerColor = '#fff';
        if (state.mode === 'bomb' && state.bomb && state.bomb.state === 'planted' && phase === 'live') {
            const fuse = Math.max(0, state.bomb.fuseMs - (performance.now() - recvAt));
            timer = '💣 ' + fmt(fuse); timerColor = '#ff4a4a';
        }
        bar.innerHTML = '<div class="mb-row"><div class="mb-team" style="color:' + TEAM_COLORS.T + '">T ' + (state.scoreT || 0) + '</div><div class="mb-time" style="color:' + timerColor + '">' + timer + '</div><div class="mb-team" style="color:' + TEAM_COLORS.CT + '">' + (state.scoreCT || 0) + ' CT</div></div>' +
            '<div class="mb-sub">' + sub + '</div>' +
            (team ? '<div class="mb-my" style="background:' + TEAM_COLORS[team] + '33;color:' + TEAM_COLORS[team] + ';border:1px solid ' + TEAM_COLORS[team] + '">DU: ' + TEAM_NAMES[team] + '</div>' : '');
        // Hinweis unten + Fortschritt
        const pi = promptInfo();
        const pr = state.prog && state.prog.owner === getMyId() ? state.prog : null;
        if (pi) {
            prompt.style.display = 'block'; pText.textContent = pi.text;
            pBar.style.display = pr ? 'block' : 'none';
            if (pr) { pFill.style.width = Math.round(pr.p * 100) + '%'; }
        } else if (state.mode === 'bomb' && state.bomb && state.bomb.state === 'planted' && state.prog && state.prog.kind === 'defuse') {
            prompt.style.display = 'block'; pText.textContent = 'BOMBE WIRD ENTSCHÄRFT ' + Math.round(state.prog.p * 100) + '%'; pBar.style.display = 'none';
        } else prompt.style.display = 'none';
        // Rundenende
        if (phase === 'end') {
            const w = state.winner;
            banner.style.display = 'block';
            banner.innerHTML = '<div class="b1" style="color:' + TEAM_COLORS[w] + '">' + (w === 'T' ? 'TERRORISTEN' : 'ANTI-TERROR') + ' GEWINNEN</div><div class="b2">' + (state.reason || '') + '</div>';
        } else banner.style.display = 'none';
    }

    // E-Taste: halten (nur wenn es etwas zu tun gibt - der Server prüft zusätzlich Nähe und Team)
    function setHold(on) {
        if (on === holding) return;
        holding = on;
        sendHold(on);
    }

    return {
        setLayout(p) {
            layout = p && p.layout ? p.layout : null;
            buildObjects(); applyState(); updateHud();
        },
        setTeams(m) { teams = m || {}; },
        setState(s) {
            const prevPhase = state.phase, prevMode = state.mode;
            state = s || { mode: 'dm' }; recvAt = performance.now();
            if (prevMode !== state.mode || prevPhase !== state.phase) {
                if (state.phase === 'live' && prevPhase !== 'live') notice(state.mode === 'bomb' ? (myTeam() === 'T' ? 'Runde startet – bring die Bombe zu A oder B!' : 'Runde startet – verteidige A und B!')
                    : state.mode === 'rescue' ? (myTeam() === 'CT' ? 'Runde startet – befreie die Geiseln!' : 'Runde startet – bewache die Geiseln!') : '');
            }
            applyState();
        },
        setHold,
        teamOf: (id) => teams[id],
        get teams() { return teams; },
        get state() { return state; },
        get layout() { return layout; },
        get active() { return state.mode !== 'dm'; },
        update(dt) {
            if (state.mode === 'dm') { if (bar.style.display !== 'none') updateHud(); return; }
            const k = 1 - Math.exp(-dt * 10);
            hostages.forEach(h => { if (!h.g.visible) return; h.g.position.x += (h.tx - h.g.position.x) * k; h.g.position.y += (h.ty - h.g.position.y) * k; h.g.position.z += (h.tz - h.g.position.z) * k; });
            if (bombMesh && bombMesh.visible) {
                const b = state.bomb, led = bombMesh.getObjectByName('led');
                if (b && b.state === 'planted' && led) {
                    const fuse = Math.max(0, b.fuseMs - (performance.now() - recvAt));
                    const rate = fuse < 10000 ? 8 : fuse < 20000 ? 4 : 2;
                    led.material.color.setHex(Math.sin(performance.now() / 1000 * rate * Math.PI) > 0 ? 0xff2030 : 0x300000);
                } else if (led) led.material.color.setHex(0xffd24a);
            }
            updateHud();
        },
        hide() { bar.style.display = 'none'; prompt.style.display = 'none'; banner.style.display = 'none'; }
    };
}
