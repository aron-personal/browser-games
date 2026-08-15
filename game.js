(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const messageEl = document.getElementById("message");

  const PADDLE_WIDTH_RATIO = 0.018;
  const PADDLE_HEIGHT_RATIO = 0.22;
  const PADDLE_MARGIN_RATIO = 0.03;
  const BALL_SIZE_RATIO = 0.018;
  const BASE_SPEED_RATIO = 0.55;
  const SPEED_BUMP = 1.04;
  const MAX_SPEED_RATIO = 2.2;
  const HIT_ANGLE_FACTOR = 0.75;

  let width = 0;
  let height = 0;
  let dpr = 1;

  let paddleW = 0;
  let paddleH = 0;
  let paddleMargin = 0;
  let ballSize = 0;
  let baseSpeed = 0;
  let maxSpeed = 0;

  const left = { y: 0 };
  const right = { y: 0 };
  const ball = { x: 0, y: 0, vx: 0, vy: 0 };

  /** @type {Map<number, 'left' | 'right'>} */
  const pointers = new Map();

  let score = 0;
  /** @type {'ready' | 'playing' | 'miss'} */
  let state = "ready";
  let lastTime = 0;
  let lastTapAt = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let pendingStart = null;
  const DOUBLE_TAP_MS = 320;

  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    paddleW = Math.max(10, width * PADDLE_WIDTH_RATIO);
    paddleH = Math.max(60, height * PADDLE_HEIGHT_RATIO);
    paddleMargin = Math.max(12, width * PADDLE_MARGIN_RATIO);
    ballSize = Math.max(10, Math.min(width, height) * BALL_SIZE_RATIO);
    baseSpeed = Math.min(width, height) * BASE_SPEED_RATIO;
    maxSpeed = Math.min(width, height) * MAX_SPEED_RATIO;

    left.y = clamp(left.y || height / 2, paddleH / 2, height - paddleH / 2);
    right.y = clamp(right.y || height / 2, paddleH / 2, height - paddleH / 2);

    if (state !== "playing") {
      resetBall(false);
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

  function resetBall(serve) {
    ball.x = width / 2;
    ball.y = height / 2;
    if (!serve) {
      ball.vx = 0;
      ball.vy = 0;
      return;
    }
    const dir = Math.random() < 0.5 ? -1 : 1;
    const angle = (Math.random() * 0.6 - 0.3) * Math.PI;
    ball.vx = Math.cos(angle) * baseSpeed * dir;
    ball.vy = Math.sin(angle) * baseSpeed;
  }

  function startRally() {
    score = 0;
    updateScoreDisplay();
    state = "playing";
    setMessage("");
    resetBall(true);
  }

  function endRally() {
    state = "miss";
    ball.vx = 0;
    ball.vy = 0;
    setMessage(`Miss — ${score} return${score === 1 ? "" : "s"}. Tap to continue`);
  }

  function leftPaddleX() {
    return paddleMargin;
  }

  function rightPaddleX() {
    return width - paddleMargin - paddleW;
  }

  function paddleSideFromX(clientX) {
    return clientX < width / 2 ? "left" : "right";
  }

  function setPaddleY(side, clientY) {
    const y = clamp(clientY, paddleH / 2, height - paddleH / 2);
    if (side === "left") left.y = y;
    else right.y = y;
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
    const side = paddleSideFromX(event.clientX);
    pointers.set(event.pointerId, side);
    setPaddleY(side, event.clientY);

    const now = performance.now();
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

    if (state === "ready" || state === "miss") {
      if (pendingStart !== null) clearTimeout(pendingStart);
      pendingStart = setTimeout(() => {
        pendingStart = null;
        if (state === "ready" || state === "miss") startRally();
      }, DOUBLE_TAP_MS);
    }
  }

  function onPointerMove(event) {
    event.preventDefault();
    const side = pointers.get(event.pointerId);
    if (!side) return;
    setPaddleY(side, event.clientY);
  }

  function onPointerUp(event) {
    event.preventDefault();
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function bouncePaddle(side) {
    const paddle = side === "left" ? left : right;
    const paddleX = side === "left" ? leftPaddleX() : rightPaddleX();
    const ballLeft = ball.x - ballSize / 2;
    const ballRight = ball.x + ballSize / 2;
    const ballTop = ball.y - ballSize / 2;
    const ballBottom = ball.y + ballSize / 2;
    const paddleTop = paddle.y - paddleH / 2;
    const paddleBottom = paddle.y + paddleH / 2;

    const overlapsY = ballBottom >= paddleTop && ballTop <= paddleBottom;
    if (!overlapsY) return false;

    let hit = false;
    if (side === "left" && ball.vx < 0 && ballLeft <= paddleX + paddleW && ballRight >= paddleX) {
      hit = true;
      ball.x = paddleX + paddleW + ballSize / 2;
    } else if (
      side === "right" &&
      ball.vx > 0 &&
      ballRight >= paddleX &&
      ballLeft <= paddleX + paddleW
    ) {
      hit = true;
      ball.x = paddleX - ballSize / 2;
    }
    if (!hit) return false;

    const offset = (ball.y - paddle.y) / (paddleH / 2);
    const speed = Math.min(Math.hypot(ball.vx, ball.vy) * SPEED_BUMP, maxSpeed);
    const direction = side === "left" ? 1 : -1;
    ball.vx = direction * speed;
    ball.vy = offset * HIT_ANGLE_FACTOR * speed;

    score += 1;
    updateScoreDisplay();
    return true;
  }

  function update(dt) {
    if (state !== "playing") return;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    const half = ballSize / 2;
    if (ball.y - half <= 0) {
      ball.y = half;
      ball.vy = Math.abs(ball.vy);
    } else if (ball.y + half >= height) {
      ball.y = height - half;
      ball.vy = -Math.abs(ball.vy);
    }

    bouncePaddle("left");
    bouncePaddle("right");

    if (ball.x + half < 0 || ball.x - half > width) {
      endRally();
    }
  }

  function draw() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#fff";
    ctx.fillRect(leftPaddleX(), left.y - paddleH / 2, paddleW, paddleH);
    ctx.fillRect(rightPaddleX(), right.y - paddleH / 2, paddleW, paddleH);
    ctx.fillRect(ball.x - ballSize / 2, ball.y - ballSize / 2, ballSize, ballSize);
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

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  document.addEventListener("fullscreenchange", resize);
  document.addEventListener("webkitfullscreenchange", resize);

  resize();
  left.y = height / 2;
  right.y = height / 2;
  resetBall(false);
  updateScoreDisplay();
  setMessage("Tap to start · Double-tap for fullscreen");
  requestAnimationFrame(frame);
})();
