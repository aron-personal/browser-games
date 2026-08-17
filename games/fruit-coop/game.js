(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const messageEl = document.getElementById("message");
  const resultEl = document.getElementById("result");
  const resultReasonEl = document.getElementById("result-reason");
  const resultScoreEl = document.getElementById("result-score");
  const resultHighscoreEl = document.getElementById("result-highscore");

  const GRAVITY = 980;
  const MAX_MISSES = 3;
  const COMBO_WINDOW_MS = 400;
  const TRAIL_MAX_POINTS = 14;
  const TRAIL_FADE_MS = 180;
  const DOUBLE_TAP_MS = 320;
  const RESTART_LOCK_MS = 2400;
  const HIGHSCORE_KEY = "fruit-coop-highscore";
  const BASE_SPAWN_MS = 1100;
  const MIN_SPAWN_MS = 420;
  const BOMB_CHANCE = 0.14;

  /** @type {{ name: string, color: string, fill: string, deep: string, shape: 'round' | 'tall' | 'wide' | 'banana' | 'star' | 'apple', art: string[], accent?: string[] }[]} */
  const FRUIT_TYPES = [
    {
      name: "apple",
      color: "#ff8a80",
      fill: "#e53935",
      deep: "#8e0000",
      shape: "apple",
      art: [
        "     ~     ",
        "   .@@@.   ",
        "  @:. .:@  ",
        " @@  ~  @@ ",
        "  @:' ':@  ",
        "   '@@@'   ",
      ],
    },
    {
      name: "banana",
      color: "#fff59d",
      fill: "#ffca28",
      deep: "#f57f17",
      shape: "banana",
      art: [
        "      /##  ",
        "     /#.#\\ ",
        "    /#..#\\ ",
        "   /#...#/ ",
        "  /#...#/  ",
        " /####/    ",
        " ''        ",
      ],
    },
    {
      name: "watermelon",
      color: "#b9f6ca",
      fill: "#66bb6a",
      deep: "#1b5e20",
      shape: "wide",
      art: [
        "  .::::::. ",
        " :::::::::",
        ":::::::::::",
        ":::::::::::",
        " :::::::::",
        "  '::::::' ",
      ],
      accent: [
        "  .| | | |. ",
        " : | | | |:",
        ":| | | | | |:",
        ":| | | | | |:",
        " : | | | |:",
        "  '| | | |' ",
      ],
    },
    {
      name: "orange",
      color: "#ffe0b2",
      fill: "#ff9800",
      deep: "#e65100",
      shape: "round",
      art: [
        "    .*.    ",
        "  .@o o@.  ",
        " @o  .  o@ ",
        "@o  (@)  o@",
        " @o     o@ ",
        "  '@o o@'  ",
      ],
    },
    {
      name: "starfruit",
      color: "#f3e5f5",
      fill: "#ce93d8",
      deep: "#6a1b9a",
      shape: "star",
      art: [
        "     A     ",
        "    / \\    ",
        " /\\/   \\/\\ ",
        "<  .:::.  >",
        " \\/\\   /\\/ ",
        "    \\ /    ",
        "     V     ",
      ],
    },
    {
      name: "pear",
      color: "#b3e5fc",
      fill: "#4fc3f7",
      deep: "#01579b",
      shape: "tall",
      art: [
        "    .~.    ",
        "   .@o@.   ",
        "  @@   @@  ",
        " @o  ~  o@ ",
        "@@       @@",
        " @o     o@ ",
        "  '@@@@@'  ",
      ],
    },
  ];

  const BOMB_TYPE = {
    name: "bomb",
    color: "#ffcdd2",
    fill: "#455a64",
    deep: "#000a12",
    shape: "round",
    art: [
      "     *!    ",
      "   .@@@@.  ",
      "  @ x  x @ ",
      "  @  ><  @ ",
      "   @vvvv@  ",
      "    '@@'   ",
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
  /** @type {ReturnType<typeof setTimeout> | null} */
  let restartUnlockTimer = null;
  let restartAllowedAt = 0;
  let highScore = loadHighScore();

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

  function loadHighScore() {
    try {
      const n = Number(localStorage.getItem(HIGHSCORE_KEY));
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  }

  function saveHighScore(value) {
    try {
      localStorage.setItem(HIGHSCORE_KEY, String(value));
    } catch {
      /* ignore quota / private mode */
    }
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

  function hideResult() {
    resultEl.classList.add("hidden");
    resultEl.classList.remove("locked");
    scoreEl.classList.remove("hidden");
    livesEl.classList.remove("hidden");
  }

  function showResult(reason) {
    const previousBest = highScore;
    const isNewBest = score > previousBest;
    if (isNewBest) {
      highScore = score;
      saveHighScore(highScore);
    }

    resultReasonEl.textContent = reason;
    resultScoreEl.textContent = String(score);
    resultHighscoreEl.textContent = isNewBest && score > 0
      ? "New best"
      : `Best ${highScore}`;

    resultEl.classList.remove("hidden");
    resultEl.classList.add("locked");
    scoreEl.classList.add("hidden");
    livesEl.classList.add("hidden");
    setMessage("");
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
    restartAllowedAt = 0;
    if (restartUnlockTimer !== null) {
      clearTimeout(restartUnlockTimer);
      restartUnlockTimer = null;
    }
    hideResult();
    updateScoreDisplay();
    updateLivesDisplay();
    setMessage("");
  }

  function endGame(reason) {
    state = "over";
    blades.clear();
    restartAllowedAt = performance.now() + RESTART_LOCK_MS;
    if (restartUnlockTimer !== null) clearTimeout(restartUnlockTimer);
    restartUnlockTimer = setTimeout(() => {
      restartUnlockTimer = null;
      if (state === "over") resultEl.classList.remove("locked");
    }, RESTART_LOCK_MS);
    showResult(reason);
  }

  function canRestart() {
    return performance.now() >= restartAllowedAt;
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
      comboMessageUntil = now + 900;
      setMessage(`COMBO x${combo}  +${points}`);
    }

    sliceFruit(entity, bladeAngle, combo);
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

  function sliceFruit(entity, bladeAngle, comboLevel = 1) {
    entity.sliced = true;
    const power = Math.min(comboLevel, 8);
    const multi = power > 1;
    const juiceScale = 1 + (power - 1) * 0.55;
    const speedScale = 1 + (power - 1) * 0.22;
    const nx = Math.cos(bladeAngle + Math.PI / 2);
    const ny = Math.sin(bladeAngle + Math.PI / 2);
    const kick = (180 + Math.random() * 120) * (1 + (power - 1) * 0.12);

    for (const half of /** @type {const} */ ([-1, 1])) {
      entities.push({
        id: nextId++,
        x: entity.x + nx * half * 8,
        y: entity.y + ny * half * 8,
        vx: entity.vx + nx * half * kick,
        vy: entity.vy + ny * half * kick * 0.35 - 40,
        angle: entity.angle,
        spin: entity.spin + half * (3 + power * 0.4),
        radius: entity.radius * 0.9,
        type: entity.type,
        isBomb: false,
        sliced: true,
        half,
        life: 0.9 + (multi ? 0.15 : 0),
        alpha: 1,
      });
    }

    // Directional juice spray along the cut
    const count = Math.round((42 + Math.random() * 18) * juiceScale);
    for (let i = 0; i < count; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const spread = (Math.random() - 0.5) * (1.35 + power * 0.12);
      const a = bladeAngle + (Math.PI / 2) * side + spread;
      const sp = (70 + Math.random() * 340) * speedScale;
      spawnParticle({
        x: entity.x + (Math.random() - 0.5) * entity.radius * 0.7,
        y: entity.y + (Math.random() - 0.5) * entity.radius * 0.7,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 50 - Math.random() * 110,
        life: 0.4 + Math.random() * 0.55 + (multi ? 0.15 : 0),
        size: (2.5 + Math.random() * 6.5) * (1 + (power - 1) * 0.08),
        color: Math.random() < 0.28 ? "#fff5e6" : entity.type.color,
        drag: 0.985,
        kind: "juice",
      });
    }

    // Extra radial juice burst from the center
    const radial = Math.round(20 * juiceScale);
    for (let i = 0; i < radial; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (50 + Math.random() * 220) * speedScale;
      spawnParticle({
        x: entity.x,
        y: entity.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        life: 0.3 + Math.random() * 0.4 + (multi ? 0.1 : 0),
        size: (2 + Math.random() * 5) * (1 + (power - 1) * 0.1),
        color: entity.type.fill || entity.type.color,
        drag: 0.98,
        kind: "juice",
      });
    }

    // Tiny bright sparks on the blade line
    const sparkCount = 8 + (power - 1) * 6;
    for (let i = 0; i < sparkCount; i++) {
      const t = (Math.random() - 0.5) * entity.radius * 1.4;
      const a = bladeAngle + (Math.random() - 0.5) * 0.6;
      const sp = (40 + Math.random() * 160) * speedScale;
      spawnParticle({
        x: entity.x + Math.cos(bladeAngle) * t,
        y: entity.y + Math.sin(bladeAngle) * t,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.15 + Math.random() * 0.2 + (multi ? 0.12 : 0),
        size: 1.5 + Math.random() * 2.5 + (power - 1) * 0.35,
        color: multi && Math.random() < 0.45 ? "#ffe082" : "#ffffff",
        drag: 0.92,
        kind: "spark",
      });
    }

    rings.push({
      x: entity.x,
      y: entity.y,
      radius: entity.radius * 0.3,
      maxRadius: entity.radius * (2.2 + (power - 1) * 0.7),
      life: 0.28 + (multi ? 0.12 : 0),
      maxLife: 0.28 + (multi ? 0.12 : 0),
      color: entity.type.color,
      width: 2.5 + (power - 1) * 0.4,
    });

    if (multi) {
      // Extra shockwave rings for combos
      rings.push({
        x: entity.x,
        y: entity.y,
        radius: entity.radius * 0.5,
        maxRadius: entity.radius * (3.5 + power * 0.55),
        life: 0.4 + power * 0.05,
        maxLife: 0.4 + power * 0.05,
        color: power >= 4 ? "#ffe082" : "#ffffff",
        width: 2 + power * 0.35,
      });

      // Golden confetti sparks for bigger combos
      const confetti = 10 + power * 8;
      for (let i = 0; i < confetti; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (120 + Math.random() * 380) * speedScale;
        const palette = ["#ffffff", "#ffe082", "#ffd54f", entity.type.color, "#fff59d"];
        spawnParticle({
          x: entity.x,
          y: entity.y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 60,
          life: 0.45 + Math.random() * 0.5,
          size: 2 + Math.random() * 4 + power * 0.2,
          color: palette[(Math.random() * palette.length) | 0],
          drag: 0.97,
          kind: "spark",
        });
      }

      if (power >= 3) {
        screenFlash = {
          life: 0.12 + Math.min(power, 6) * 0.025,
          maxLife: 0.12 + Math.min(power, 6) * 0.025,
          color: power >= 5 ? "#ffe082" : "#ffffff",
        };
      }
    }
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

    if (state === "ready" || (state === "over" && canRestart())) {
      startGame();
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

  function fruitBodyPath(shape, r) {
    ctx.beginPath();
    if (shape === "banana") {
      // Crescent banana
      ctx.moveTo(r * 0.05, -r * 0.9);
      ctx.bezierCurveTo(r * 0.85, -r * 0.75, r * 1.05, r * 0.05, r * 0.55, r * 0.85);
      ctx.bezierCurveTo(r * 0.35, r * 1.0, r * 0.05, r * 0.95, -r * 0.05, r * 0.7);
      ctx.bezierCurveTo(r * 0.55, r * 0.15, r * 0.35, -r * 0.45, -r * 0.05, -r * 0.75);
      ctx.bezierCurveTo(-r * 0.15, -r * 0.95, -r * 0.05, -r * 0.95, r * 0.05, -r * 0.9);
      ctx.closePath();
    } else if (shape === "star") {
      const spikes = 5;
      const outer = r * 1.08;
      const inner = r * 0.5;
      for (let i = 0; i < spikes * 2; i++) {
        const rad = (i * Math.PI) / spikes - Math.PI / 2;
        const rr = i % 2 === 0 ? outer : inner;
        const x = Math.cos(rad) * rr;
        const y = Math.sin(rad) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else if (shape === "tall") {
      // Pear silhouette
      ctx.moveTo(0, -r * 1.08);
      ctx.bezierCurveTo(r * 0.42, -r * 1.05, r * 0.55, -r * 0.35, r * 0.62, r * 0.05);
      ctx.bezierCurveTo(r * 0.95, r * 0.35, r * 0.9, r * 0.95, 0, r * 1.08);
      ctx.bezierCurveTo(-r * 0.9, r * 0.95, -r * 0.95, r * 0.35, -r * 0.62, r * 0.05);
      ctx.bezierCurveTo(-r * 0.55, -r * 0.35, -r * 0.42, -r * 1.05, 0, -r * 1.08);
      ctx.closePath();
    } else if (shape === "wide") {
      ctx.ellipse(0, 0, r * 1.18, r * 0.78, 0, 0, Math.PI * 2);
    } else if (shape === "apple") {
      // Slight apple dimple
      ctx.moveTo(0, -r * 0.92);
      ctx.bezierCurveTo(r * 0.55, -r * 1.08, r * 1.05, -r * 0.35, r * 0.95, r * 0.25);
      ctx.bezierCurveTo(r * 0.85, r * 0.95, r * 0.35, r * 1.08, 0, r * 0.98);
      ctx.bezierCurveTo(-r * 0.35, r * 1.08, -r * 0.85, r * 0.95, -r * 0.95, r * 0.25);
      ctx.bezierCurveTo(-r * 1.05, -r * 0.35, -r * 0.55, -r * 1.08, 0, -r * 0.92);
      ctx.closePath();
    } else {
      ctx.ellipse(0, 0, r * 0.98, r * 1.02, 0, 0, Math.PI * 2);
    }
  }

  function drawFruitDecor(type, r, half) {
    if (half) return;
    const name = type.name;

    if (name === "apple" || name === "pear") {
      ctx.strokeStyle = "#4e342e";
      ctx.lineWidth = Math.max(1.6, r * 0.07);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.72);
      ctx.quadraticCurveTo(r * 0.12, -r * 1.05, r * 0.02, -r * 1.22);
      ctx.stroke();
      ctx.fillStyle = name === "apple" ? "#66bb6a" : "#81c784";
      ctx.beginPath();
      ctx.ellipse(r * 0.22, -r * 1.0, r * 0.26, r * 0.11, 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (name === "watermelon") {
      ctx.save();
      fruitBodyPath("wide", r);
      ctx.clip();
      ctx.strokeStyle = "rgba(0,40,0,0.45)";
      ctx.lineWidth = Math.max(2, r * 0.1);
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.32, -r);
        ctx.quadraticCurveTo(i * r * 0.28, 0, i * r * 0.32, r);
        ctx.stroke();
      }
      ctx.strokeStyle = "#c8e6c9";
      ctx.lineWidth = Math.max(2.5, r * 0.12);
      fruitBodyPath("wide", r * 0.92);
      ctx.stroke();
      ctx.restore();
    }

    if (name === "orange") {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        const rr = r * (0.25 + (i % 3) * 0.15);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.9, Math.max(1.2, r * 0.045), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#2e7d32";
      ctx.beginPath();
      ctx.arc(0, -r * 0.82, Math.max(2, r * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }

    if (name === "banana") {
      ctx.strokeStyle = "rgba(183, 98, 0, 0.45)";
      ctx.lineWidth = Math.max(1.2, r * 0.05);
      ctx.lineCap = "round";
      for (const t of [-0.25, 0, 0.25]) {
        ctx.beginPath();
        ctx.moveTo(r * (0.15 + t * 0.2), -r * 0.65);
        ctx.bezierCurveTo(
          r * (0.7 + t * 0.15),
          -r * 0.2,
          r * (0.65 + t * 0.1),
          r * 0.35,
          r * (0.2 + t * 0.1),
          r * 0.7
        );
        ctx.stroke();
      }
      ctx.fillStyle = "#5d4037";
      ctx.beginPath();
      ctx.arc(r * 0.05, -r * 0.88, Math.max(1.8, r * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }

    if (name === "starfruit") {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = Math.max(1.2, r * 0.05);
      fruitBodyPath("star", r * 0.62);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }

    if (name === "bomb") {
      ctx.fillStyle = "#78909c";
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.78, r * 0.28, r * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#b0bec5";
      ctx.lineWidth = Math.max(1.6, r * 0.07);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.88);
      ctx.quadraticCurveTo(r * 0.28, -r * 1.15, r * 0.08, -r * 1.4);
      ctx.stroke();
      ctx.fillStyle = "#ffab40";
      ctx.beginPath();
      ctx.arc(r * 0.08, -r * 1.42, Math.max(2.2, r * 0.11), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff59d";
      ctx.beginPath();
      ctx.arc(r * 0.08, -r * 1.42, Math.max(1.1, r * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawAscii(entity) {
    const type = entity.type;
    const art = type.art;
    const shape = type.shape || "round";
    const r = entity.radius;
    const lineH = Math.max(9, r * 0.3);
    const fontSize = Math.max(10, lineH * 1.0);
    const alpha = entity.alpha ?? 1;
    ctx.save();
    ctx.translate(entity.x, entity.y);
    ctx.rotate(entity.angle);
    if (entity.half === -1) {
      ctx.beginPath();
      ctx.rect(-r * 2.5, -r * 2.5, r * 2.5, r * 5);
      ctx.clip();
    } else if (entity.half === 1) {
      ctx.beginPath();
      ctx.rect(0, -r * 2.5, r * 2.5, r * 5);
      ctx.clip();
    }
    ctx.globalAlpha = alpha;

    // Outer glow for black background readability
    ctx.save();
    ctx.globalAlpha = alpha * 0.22;
    ctx.fillStyle = type.color;
    fruitBodyPath(shape, r * 1.18);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = alpha;

    // Drop shadow
    ctx.save();
    ctx.translate(r * 0.1, r * 0.14);
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillStyle = "#000";
    fruitBodyPath(shape, r * 0.98);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = alpha;

    // Body gradient
    const grad = ctx.createRadialGradient(
      -r * 0.4,
      -r * 0.45,
      r * 0.05,
      r * 0.1,
      r * 0.15,
      r * 1.2
    );
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.12, type.color);
    grad.addColorStop(0.5, type.fill);
    grad.addColorStop(1, type.deep);
    ctx.fillStyle = grad;
    fruitBodyPath(shape, r);
    ctx.fill();

    // Procedural surface details under ASCII
    drawFruitDecor(type, r, entity.half);

    // Specular gloss
    ctx.beginPath();
    ctx.ellipse(-r * 0.32, -r * 0.36, r * 0.32, r * 0.18, -0.55, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.34)";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-r * 0.18, -r * 0.48, r * 0.1, r * 0.06, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fill();

    // Crisp rim
    ctx.strokeStyle = type.color;
    ctx.lineWidth = Math.max(1.5, r * 0.065);
    fruitBodyPath(shape, r);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = Math.max(1, r * 0.03);
    fruitBodyPath(shape, r * 0.97);
    ctx.stroke();

    // ASCII clipped to body
    ctx.save();
    fruitBodyPath(shape, r * 0.96);
    ctx.clip();
    ctx.font = `bold ${fontSize}px ui-monospace, "Cascadia Code", "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const startY = -((art.length - 1) * lineH) / 2;

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    for (let i = 0; i < art.length; i++) {
      ctx.fillText(art[i], 1.1, startY + i * lineH + 1.1);
    }
    ctx.fillStyle = type.color;
    for (let i = 0; i < art.length; i++) {
      ctx.fillText(art[i], 0, startY + i * lineH);
    }
    if (type.accent) {
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      for (let i = 0; i < type.accent.length; i++) {
        ctx.fillText(type.accent[i], 0, startY + i * lineH);
      }
    }
    ctx.restore();

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
      if (screenFlash.color.startsWith("#")) {
        ctx.globalAlpha = 0.28 * t;
        ctx.fillStyle = screenFlash.color;
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.globalAlpha = 0.5 * t;
        ctx.fillStyle = "#ff3d00";
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 0.35 * t * t;
        ctx.fillStyle = "#fff59d";
        ctx.fillRect(0, 0, width, height);
      }
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
