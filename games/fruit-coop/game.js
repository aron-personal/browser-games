(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const messageEl = document.getElementById("message");

  const GRAVITY = 980;
  const MAX_MISSES = 3;
  const COMBO_WINDOW_MS = 400;
  const TRAIL_MAX_POINTS = 14;
  const TRAIL_FADE_MS = 180;
  const DOUBLE_TAP_MS = 320;
  const BASE_SPAWN_MS = 1100;
  const MIN_SPAWN_MS = 420;
  const BOMB_CHANCE = 0.14;

  /** @type {{ name: string, color: string, fill: string, art: string[] }[]} */
  const FRUIT_TYPES = [
    {
      name: "apple",
      color: "#ff6b6b",
      fill: "#c62828",
      art: [
        "   ,@@,   ",
        "  @@@@@@  ",
        " @@@@@@@@ ",
        " @@@@@@@@ ",
        "  @@@@@@  ",
        "   '@@'   ",
      ],
    },
    {
      name: "banana",
      color: "#ffd54f",
      fill: "#f9a825",
      art: [
        "     ##   ",
        "    ####  ",
        "   ##  ## ",
        "  ##   ## ",
        " ##   ##  ",
        "  ###'    ",
      ],
    },
    {
      name: "watermelon",
      color: "#69f0ae",
      fill: "#2e7d32",
      art: [
        "  .%%%%.  ",
        " %%%%%%%% ",
        "%%%%%%%%%%",
        "%%%%%%%%%%",
        " %%%%%%%% ",
        "  '%%%%'  ",
      ],
    },
    {
      name: "orange",
      color: "#ffab40",
      fill: "#ef6c00",
      art: [
        "  .@@@@.  ",
        " @@@@@@@@ ",
        "@@@@@@@@@@",
        " @@@@@@@@ ",
        "  '@@@@'  ",
      ],
    },
    {
      name: "starfruit",
      color: "#ea80fc",
      fill: "#8e24aa",
      art: [
        "    **    ",
        "   ****   ",
        " ******** ",
        "**********",
        " ******** ",
        "   ****   ",
        "    **    ",
      ],
    },
    {
      name: "pear",
      color: "#40c4ff",
      fill: "#0277bd",
      art: [
        "   .@@.   ",
        "  @@@@@@  ",
        " @@@@@@@@ ",
        "@@@@@@@@@@",
        " @@@@@@@@ ",
        "  '@@@@'  ",
      ],
    },
  ];

  const BOMB_TYPE = {
    name: "bomb",
    color: "#ff5252",
    fill: "#212121",
    art: [
      "    !!    ",
      "  .@@@@.  ",
      " @@x  x@@ ",
      " @@@@@@@@ ",
      "  @@@@@@  ",
      "   '@@'   ",
    ],
  };

  let width = 0;
  let height = 0;
  let dpr = 1;

  /** @type {'ready' | 'playing' | 'over'} */
  let state = "ready";
  let score = 0;
  let misses = 0;
  let lastTime = 0;
  let spawnTimer = 0;
  let combo = 0;
  let lastCutAt = 0;
  let comboMessageUntil = 0;
  let lastTapAt = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let pendingStart = null;

  /** @typedef {{
   *  id: number,
   *  x: number, y: number, vx: number, vy: number,
   *  angle: number, spin: number,
   *  radius: number,
   *  type: typeof FRUIT_TYPES[number] | typeof BOMB_TYPE,
   *  isBomb: boolean,
   *  sliced: boolean,
   *  half?: -1 | 1,
   *  life?: number,
   *  alpha?: number
   * }} Entity */

  /** @type {Entity[]} */
  let entities = [];
  /** @type {{ x: number, y: number, vx: number, vy: number, life: number, maxLife: number, size: number, color: string, drag: number, kind: 'juice' | 'spark' | 'smoke' | 'ember' }[]} */
  let particles = [];
  /** @type {{ x: number, y: number, radius: number, maxRadius: number, life: number, maxLife: number, color: string, width: number }[]} */
  let rings = [];
  /** @type {{ life: number, maxLife: number, color: string } | null} */
  let screenFlash = null;

  /** @type {Map<number, { points: { x: number, y: number, t: number }[], active: boolean }>} */
  const blades = new Map();

  let nextId = 1;

  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function setMessage(text) {
    if (!text) {
      messageEl.classList.add("hidden");
      messageEl.textContent = "";
      return;
    }
    messageEl.classList.remove("hidden");
    messageEl.textContent = text;
  }

  function updateScoreDisplay() {
    scoreEl.textContent = String(score);
  }

  function updateLivesDisplay() {
    const left = Math.max(0, MAX_MISSES - misses);
    livesEl.textContent = "♥".repeat(left) + "♡".repeat(MAX_MISSES - left);
  }

  function fruitRadius() {
    return Math.max(22, Math.min(width, height) * 0.045);
  }

  function spawnInterval() {
    const speedup = Math.min(score * 8, BASE_SPAWN_MS - MIN_SPAWN_MS);
    return Math.max(MIN_SPAWN_MS, BASE_SPAWN_MS - speedup);
  }

  function spawnFruit() {
    const isBomb = Math.random() < BOMB_CHANCE;
    const type = isBomb
      ? BOMB_TYPE
      : FRUIT_TYPES[(Math.random() * FRUIT_TYPES.length) | 0];
    const margin = width * 0.12;
    const x = margin + Math.random() * (width - margin * 2);
    const y = height + 40;
    const targetX = width * 0.15 + Math.random() * width * 0.7;
    const peak = height * (0.18 + Math.random() * 0.28);
    const flight = 0.85 + Math.random() * 0.35;
    const vy = -Math.sqrt(2 * GRAVITY * (y - peak));
    const vx = (targetX - x) / flight;

    entities.push({
      id: nextId++,
      x,
      y,
      vx,
      vy,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() * 4 - 2) * (0.8 + Math.random()),
      radius: fruitRadius(),
      type,
      isBomb,
      sliced: false,
    });
  }

  function startGame() {
    score = 0;
    misses = 0;
    combo = 0;
    lastCutAt = 0;
    comboMessageUntil = 0;
    entities = [];
    particles = [];
    rings = [];
    screenFlash = null;
    spawnTimer = 0.35;
    state = "playing";
    updateScoreDisplay();
    updateLivesDisplay();
    setMessage("");
  }

  function endGame(reason) {
    state = "over";
    blades.clear();
    setMessage(`${reason} — ${score} pts. Tap to play again`);
  }

  function registerCut(entity, bladeAngle) {
    const now = performance.now();
    if (entity.isBomb) {
      explodeBomb(entity);
      endGame("Bomb!");
      return;
    }

    if (now - lastCutAt <= COMBO_WINDOW_MS) {
      combo += 1;
    } else {
      combo = 1;
    }
    lastCutAt = now;

    const points = Math.pow(2, combo - 1);
    score += points;
    updateScoreDisplay();

    if (combo > 1) {
      comboMessageUntil = now + 700;
      setMessage(`COMBO x${combo}  +${points}`);
    }

    sliceFruit(entity, bladeAngle);
  }

  function spawnParticle(opts) {
    const maxLife = opts.life;
    particles.push({
      x: opts.x,
      y: opts.y,
      vx: opts.vx,
      vy: opts.vy,
      life: maxLife,
      maxLife,
      size: opts.size,
      color: opts.color,
      drag: opts.drag ?? 0.98,
      kind: opts.kind ?? "juice",
    });
  }

  function sliceFruit(entity, bladeAngle) {
    entity.sliced = true;
    const nx = Math.cos(bladeAngle + Math.PI / 2);
    const ny = Math.sin(bladeAngle + Math.PI / 2);
    const kick = 180 + Math.random() * 120;

    for (const half of /** @type {const} */ ([-1, 1])) {
      entities.push({
        id: nextId++,
        x: entity.x + nx * half * 8,
        y: entity.y + ny * half * 8,
        vx: entity.vx + nx * half * kick,
        vy: entity.vy + ny * half * kick * 0.35 - 40,
        angle: entity.angle,
        spin: entity.spin + half * 3,
        radius: entity.radius * 0.9,
        type: entity.type,
        isBomb: false,
        sliced: true,
        half,
        life: 0.9,
        alpha: 1,
      });
    }

    // Directional juice spray along the cut
    const count = 42 + ((Math.random() * 18) | 0);
    for (let i = 0; i < count; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const spread = (Math.random() - 0.5) * 1.35;
      const a = bladeAngle + (Math.PI / 2) * side + spread;
      const sp = 70 + Math.random() * 340;
      spawnParticle({
        x: entity.x + (Math.random() - 0.5) * entity.radius * 0.7,
        y: entity.y + (Math.random() - 0.5) * entity.radius * 0.7,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 50 - Math.random() * 110,
        life: 0.4 + Math.random() * 0.55,
        size: 2.5 + Math.random() * 6.5,
        color: Math.random() < 0.28 ? "#fff5e6" : entity.type.color,
        drag: 0.985,
        kind: "juice",
      });
    }

    // Extra radial juice burst from the center
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 220;
      spawnParticle({
        x: entity.x,
        y: entity.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        life: 0.3 + Math.random() * 0.4,
        size: 2 + Math.random() * 5,
        color: entity.type.fill || entity.type.color,
        drag: 0.98,
        kind: "juice",
      });
    }

    // Tiny bright sparks on the blade line
    for (let i = 0; i < 8; i++) {
      const t = (Math.random() - 0.5) * entity.radius * 1.4;
      const a = bladeAngle + (Math.random() - 0.5) * 0.6;
      const sp = 40 + Math.random() * 160;
      spawnParticle({
        x: entity.x + Math.cos(bladeAngle) * t,
        y: entity.y + Math.sin(bladeAngle) * t,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.15 + Math.random() * 0.2,
        size: 1.5 + Math.random() * 2.5,
        color: "#ffffff",
        drag: 0.92,
        kind: "spark",
      });
    }

    rings.push({
      x: entity.x,
      y: entity.y,
      radius: entity.radius * 0.3,
      maxRadius: entity.radius * 2.2,
      life: 0.28,
      maxLife: 0.28,
      color: entity.type.color,
      width: 2.5,
    });
  }

  function explodeBomb(entity) {
    entity.sliced = true;
    screenFlash = { life: 0.28, maxLife: 0.28, color: "rgba(255, 80, 60, 0.55)" };

    for (let i = 0; i < 3; i++) {
      rings.push({
        x: entity.x,
        y: entity.y,
        radius: entity.radius * (0.2 + i * 0.15),
        maxRadius: Math.min(width, height) * (0.28 + i * 0.12),
        life: 0.45 + i * 0.12,
        maxLife: 0.45 + i * 0.12,
        color: i === 0 ? "#ffeb3b" : i === 1 ? "#ff7043" : "#ff1744",
        width: 4 - i,
      });
    }

    // Core white flash particles
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 180;
      spawnParticle({
        x: entity.x,
        y: entity.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.2 + Math.random() * 0.2,
        size: 3 + Math.random() * 6,
        color: "#fffde7",
        drag: 0.9,
        kind: "spark",
      });
    }

    // Fast embers
    for (let i = 0; i < 42; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 160 + Math.random() * 420;
      const hot = Math.random();
      spawnParticle({
        x: entity.x + (Math.random() - 0.5) * 12,
        y: entity.y + (Math.random() - 0.5) * 12,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        life: 0.45 + Math.random() * 0.55,
        size: 2 + Math.random() * 5,
        color: hot > 0.66 ? "#ffeb3b" : hot > 0.33 ? "#ff6e40" : "#ff1744",
        drag: 0.975,
        kind: "ember",
      });
    }

    // Expanding smoke
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 160;
      spawnParticle({
        x: entity.x,
        y: entity.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 20,
        life: 0.7 + Math.random() * 0.6,
        size: 8 + Math.random() * 18,
        color: Math.random() < 0.5 ? "#616161" : "#9e9e9e",
        drag: 0.96,
        kind: "smoke",
      });
    }

    // Shrapnel scraps
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 200 + Math.random() * 380;
      spawnParticle({
        x: entity.x,
        y: entity.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.4,
        size: 2 + Math.random() * 3,
        color: "#eceff1",
        drag: 0.99,
        kind: "spark",
      });
    }
  }

  function distPointToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    if (len2 === 0) {
      return Math.hypot(px - ax, py - ay);
    }
    let t = ((px - ax) * abx + (py - ay) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    return Math.hypot(px - cx, py - cy);
  }

  function tryCutWithSegment(ax, ay, bx, by) {
    if (state !== "playing") return;
    const bladeAngle = Math.atan2(by - ay, bx - ax);
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 2) return;

    for (const entity of entities) {
      if (entity.sliced || entity.half) continue;
      const hitR = entity.radius * 1.05;
      if (distPointToSegment(entity.x, entity.y, ax, ay, bx, by) <= hitR) {
        registerCut(entity, bladeAngle);
      }
    }
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function toggleFullscreen() {
    const root = document.documentElement;
    if (isFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
      return;
    }
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (request) request.call(root).catch(() => {});
  }

  function onPointerDown(event) {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const now = performance.now();
    blades.set(event.pointerId, {
      points: [{ x: event.clientX, y: event.clientY, t: now }],
      active: true,
    });

      // Canvas double-tap fullscreen only when not playing (avoids accidental exit mid-game).
    if (state !== "playing") {
      const doubleTap = now - lastTapAt < DOUBLE_TAP_MS;
      lastTapAt = now;
      if (doubleTap) {
        if (pendingStart !== null) {
          clearTimeout(pendingStart);
          pendingStart = null;
        }
        lastTapAt = 0;
        toggleFullscreen();
        return;
      }
    } else {
      lastTapAt = 0;
    }

    if (state === "ready" || state === "over") {
      if (pendingStart !== null) clearTimeout(pendingStart);
      pendingStart = setTimeout(() => {
        pendingStart = null;
        if (state === "ready" || state === "over") startGame();
      }, DOUBLE_TAP_MS);
    }
  }

  function onPointerMove(event) {
    event.preventDefault();
    const blade = blades.get(event.pointerId);
    if (!blade || !blade.active) return;
    const now = performance.now();
    const prev = blade.points[blade.points.length - 1];
    const next = { x: event.clientX, y: event.clientY, t: now };
    blade.points.push(next);
    if (blade.points.length > TRAIL_MAX_POINTS) {
      blade.points.shift();
    }
    if (prev) {
      tryCutWithSegment(prev.x, prev.y, next.x, next.y);
    }
  }

  function onPointerUp(event) {
    event.preventDefault();
    const blade = blades.get(event.pointerId);
    if (blade) {
      blade.active = false;
    }
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function update(dt) {
    const now = performance.now();

    if (state === "playing") {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnFruit();
        if (Math.random() < 0.22 + Math.min(score * 0.002, 0.25)) {
          spawnFruit();
        }
        spawnTimer = spawnInterval() / 1000;
      }
    }

    for (const entity of entities) {
      entity.vy += GRAVITY * dt;
      entity.x += entity.vx * dt;
      entity.y += entity.vy * dt;
      entity.angle += entity.spin * dt;

      if (entity.half) {
        entity.life = (entity.life ?? 1) - dt;
        entity.alpha = Math.max(0, entity.life / 0.9);
      }
    }

    if (state === "playing") {
      for (const entity of entities) {
        if (entity.sliced || entity.half || entity.isBomb) continue;
        if (entity.y - entity.radius > height + 10 && entity.vy > 0) {
          entity.sliced = true;
          misses += 1;
          updateLivesDisplay();
          if (misses >= MAX_MISSES) {
            endGame("Out of lives");
          }
        }
      }
      // Remove bombs that fall off without being cut (no miss)
      for (const entity of entities) {
        if (!entity.isBomb || entity.sliced) continue;
        if (entity.y - entity.radius > height + 10 && entity.vy > 0) {
          entity.sliced = true;
        }
      }
    }

    entities = entities.filter((e) => {
      if (e.half) return (e.life ?? 0) > 0;
      if (e.sliced) return false;
      return e.y < height + 200;
    });

    for (const p of particles) {
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      if (p.kind === "juice" || p.kind === "ember") {
        p.vy += GRAVITY * (p.kind === "juice" ? 0.45 : 0.2) * dt;
      } else if (p.kind === "smoke") {
        p.vy -= 40 * dt;
        p.size += 18 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const ring of rings) {
      ring.radius += (ring.maxRadius - ring.radius) * Math.min(1, 10 * dt);
      ring.life -= dt;
    }
    rings = rings.filter((r) => r.life > 0);

    if (screenFlash) {
      screenFlash.life -= dt;
      if (screenFlash.life <= 0) screenFlash = null;
    }

    for (const [id, blade] of blades) {
      blade.points = blade.points.filter((pt) => now - pt.t < TRAIL_FADE_MS * 2.5);
      if (!blade.active && blade.points.length === 0) {
        blades.delete(id);
      }
    }

    if (
      comboMessageUntil &&
      now > comboMessageUntil &&
      state === "playing"
    ) {
      comboMessageUntil = 0;
      setMessage("");
    }
  }

  function drawAscii(entity) {
    const art = entity.type.art;
    const lineH = Math.max(11, entity.radius * 0.36);
    const fontSize = Math.max(12, lineH * 1.05);
    const alpha = entity.alpha ?? 1;
    ctx.save();
    ctx.translate(entity.x, entity.y);
    ctx.rotate(entity.angle);
    if (entity.half === -1) {
      ctx.beginPath();
      ctx.rect(-entity.radius * 2, -entity.radius * 2, entity.radius * 2, entity.radius * 4);
      ctx.clip();
    } else if (entity.half === 1) {
      ctx.beginPath();
      ctx.rect(0, -entity.radius * 2, entity.radius * 2, entity.radius * 4);
      ctx.clip();
    }
    ctx.globalAlpha = alpha;

    // Solid body fill for contrast on black
    ctx.fillStyle = entity.type.fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, entity.radius * 0.92, entity.radius * 0.98, 0, 0, Math.PI * 2);
    ctx.fill();

    // Soft rim so the silhouette reads clearly
    ctx.strokeStyle = entity.type.color;
    ctx.lineWidth = Math.max(2, entity.radius * 0.08);
    ctx.stroke();

    ctx.font = `bold ${fontSize}px ui-monospace, "Cascadia Code", "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const startY = -((art.length - 1) * lineH) / 2;

    // Dark under-pass so glyphs stay readable on the fill
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let i = 0; i < art.length; i++) {
      ctx.fillText(art[i], 1, startY + i * lineH + 1);
    }

    ctx.fillStyle = entity.type.color;
    for (let i = 0; i < art.length; i++) {
      ctx.fillText(art[i], 0, startY + i * lineH);
    }
    ctx.restore();
  }

  function drawTrails() {
    const now = performance.now();
    for (const blade of blades.values()) {
      const pts = blade.points;
      if (pts.length < 2) continue;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const age = now - b.t;
        const alpha = Math.max(0, 1 - age / (TRAIL_FADE_MS * 2));
        ctx.strokeStyle = `rgba(255,255,255,${0.15 + alpha * 0.75})`;
        ctx.lineWidth = 2 + alpha * 5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  function draw() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    // Smoke behind everything else
    for (const p of particles) {
      if (p.kind !== "smoke") continue;
      const t = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = t * 0.35;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const ring of rings) {
      const t = Math.max(0, ring.life / ring.maxLife);
      ctx.globalAlpha = t * 0.85;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.width * (0.6 + t);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const p of particles) {
      if (p.kind === "smoke") continue;
      const t = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = Math.min(1, t * (p.kind === "spark" ? 1.2 : 1.4));
      ctx.fillStyle = p.color;
      const s = p.size * (0.55 + t * 0.55);
      if (p.kind === "spark" || p.kind === "ember") {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, s * 0.7, s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    for (const entity of entities) {
      drawAscii(entity);
    }

    drawTrails();

    if (screenFlash) {
      const t = Math.max(0, screenFlash.life / screenFlash.maxLife);
      ctx.globalAlpha = 0.5 * t;
      ctx.fillStyle = "#ff3d00";
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 0.35 * t * t;
      ctx.fillStyle = "#fff59d";
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }
  }

  function frame(time) {
    const dt = Math.min(0.033, (time - lastTime) / 1000 || 0);
    lastTime = time;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove, { passive: false });
  canvas.addEventListener("pointerup", onPointerUp, { passive: false });
  canvas.addEventListener("pointercancel", onPointerUp, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const fullscreenBtn = document.getElementById("fullscreen");
  const fullscreenIcon = fullscreenBtn.querySelector(".fs-icon path");
  const ICON_ENTER =
    "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z";
  const ICON_EXIT =
    "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z";
  let fullscreenBtnTapAt = 0;

  function syncFullscreenIcon() {
    fullscreenIcon.setAttribute("d", isFullscreen() ? ICON_EXIT : ICON_ENTER);
  }

  fullscreenBtn.addEventListener(
    "pointerdown",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const now = performance.now();
      if (now - fullscreenBtnTapAt < DOUBLE_TAP_MS) {
        fullscreenBtnTapAt = 0;
        toggleFullscreen();
        return;
      }
      fullscreenBtnTapAt = now;
    },
    { passive: false }
  );
  fullscreenBtn.addEventListener("click", (e) => e.preventDefault());

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  document.addEventListener("fullscreenchange", () => {
    syncFullscreenIcon();
    resize();
  });
  document.addEventListener("webkitfullscreenchange", () => {
    syncFullscreenIcon();
    resize();
  });

  resize();
  updateScoreDisplay();
  updateLivesDisplay();
  setMessage("Swipe to slice");
  requestAnimationFrame(frame);
})();
