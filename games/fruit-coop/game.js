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

  /** @type {{ name: string, color: string, art: string[] }[]} */
  const FRUIT_TYPES = [
    {
      name: "apple",
      color: "#f07178",
      art: ["  .-.  ", " (o o) ", " |   | ", "  '-'  "],
    },
    {
      name: "banana",
      color: "#e6c07b",
      art: ["   ,   ", "  / \\  ", " |   ) ", "  \\_/  "],
    },
    {
      name: "watermelon",
      color: "#98c379",
      art: [" .---. ", "/:::::\\", "\\:::::/", " '---' "],
    },
    {
      name: "orange",
      color: "#d19a66",
      art: ["  .-.  ", " (   ) ", "  '-'  "],
    },
    {
      name: "starfruit",
      color: "#c678dd",
      art: ["  /\\   ", " <  >  ", "  \\/   "],
    },
    {
      name: "pear",
      color: "#56b6c2",
      art: ["  .-.  ", " (   ) ", "  \\_/  ", "   '   "],
    },
  ];

  const BOMB_TYPE = {
    name: "bomb",
    color: "#e06c75",
    art: ["  .-.  ", " (x x) ", " |___| ", "  /|\\  "],
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
  /** @type {{ x: number, y: number, vx: number, vy: number, life: number, color: string }[]} */
  let particles = [];

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
    return Math.max(28, Math.min(width, height) * 0.055);
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

    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 220;
      particles.push({
        x: entity.x,
        y: entity.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0.35 + Math.random() * 0.35,
        color: entity.type.color,
      });
    }
  }

  function explodeBomb(entity) {
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 320;
      particles.push({
        x: entity.x,
        y: entity.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.4,
        color: i % 2 === 0 ? "#e06c75" : "#abb2bf",
      });
    }
    entity.sliced = true;
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
      p.vy += GRAVITY * 0.35 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

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
    const lineH = Math.max(12, entity.radius * 0.42);
    const fontSize = Math.max(11, lineH * 0.95);
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
    ctx.globalAlpha = entity.alpha ?? 1;
    ctx.fillStyle = entity.type.color;
    ctx.font = `bold ${fontSize}px ui-monospace, "Cascadia Code", "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const startY = -((art.length - 1) * lineH) / 2;
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

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    for (const entity of entities) {
      drawAscii(entity);
    }

    drawTrails();
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
