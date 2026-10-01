/** Small deterministic runner; coordinates are logical pixels, independent of display size. */
export class CourierRun {
  constructor(random = Math.random) { this.random = random; this.x = 62; this.width = 640; this.restart(); }
  restart() { this.y = 0; this.velocity = 0; this.distance = 0; this.over = false; this.obstacles = []; this.nextSpawn = 1.8; }
  jump() {
    if (this.over) this.restart();
    if (this.y === 0) this.velocity = 450;
  }
  update(seconds) {
    if (this.over) return;
    const dt = Math.min(Math.max(seconds, 0), 0.05);
    const speed = Math.min(300, 190 + this.distance / 180);
    this.distance += speed * dt;
    this.y = Math.max(0, this.y + this.velocity * dt - 600 * dt * dt);
    this.velocity -= 1200 * dt;
    if (this.y === 0) this.velocity = 0;
    for (const o of this.obstacles) o.x -= speed * dt;
    this.obstacles = this.obstacles.filter(o => o.x + o.width > 0);
    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.obstacles.push({ x: this.width + 10, width: 18 + this.random() * 10, height: 20 + this.random() * 12 });
      this.nextSpawn = 1.25 + this.random() * 0.75;
    }
    this.over = this.obstacles.some(o => o.x < this.x + 19 && o.x + o.width > this.x + 5 && this.y + 5 < o.height);
  }
  get score() { return Math.floor(this.distance / 10); }
}

export function mountCourierRunner(canvas, { button, status, score, best } = {}) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) { if (status) status.textContent = '可直接进入主菜单'; return { destroy() {} }; }
  const doc = canvas.ownerDocument;
  const run = new CourierRun();
  const abort = new AbortController();
  let high = 0, active = false, frame = 0, previous = 0;
  try { high = Number(localStorage.getItem('sgk-courier-best')) || 0; } catch { /* Private browsing. */ }
  const saveBest = () => {
    try { localStorage.setItem('sgk-courier-best', String(high)); } catch { /* Optional storage. */ }
  };
  const text = (el, value) => { if (el && el.textContent !== value) el.textContent = value; };
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    run.width = rect.width / rect.height * 180;
    draw();
  };
  function draw() {
    ctx.setTransform(canvas.width / run.width, 0, 0, canvas.height / 180, 0, 0);
    ctx.clearRect(0, 0, run.width, 180);
    ctx.fillStyle = '#829387';
    // Distant city walls, moving more slowly than the road.
    for (let i = 0; i < Math.ceil(run.width / 95) + 1; i++) {
      const x = i * 95 - (run.distance * 0.12 % 95);
      ctx.globalAlpha = 0.18; ctx.fillRect(x, 60, 46, 85); ctx.fillRect(x - 4, 58, 54, 5);
      for (let j = 0; j < 4; j++) ctx.fillRect(x + j * 13, 52, 6, 8);
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = '#947747'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 145); ctx.lineTo(run.width, 145); ctx.stroke();
    ctx.fillStyle = '#947747';
    for (let i = 0; i < Math.ceil(run.width / 43) + 1; i++) ctx.fillRect(i * 43 - run.distance % 43, 156 + (i % 2) * 7, 15, 1);
    for (const o of run.obstacles) {
      ctx.fillStyle = '#a77c48'; ctx.fillRect(o.x, 145 - o.height, o.width, o.height);
      ctx.strokeStyle = '#ead7a2'; ctx.strokeRect(o.x + 3, 148 - o.height, o.width - 6, o.height - 6);
      ctx.beginPath(); ctx.moveTo(o.x + 4, 143); ctx.lineTo(o.x + o.width - 4, 150 - o.height); ctx.stroke();
    }
    const x = run.x, y = 145 - run.y;
    const stride = active && !run.over && run.y === 0 ? Math.sin(run.distance / 12) * 5 : 0;
    ctx.fillStyle = '#dbc995'; ctx.fillRect(x + 7, y - 42, 14, 13);
    ctx.fillStyle = '#45645b'; ctx.fillRect(x + 6, y - 47, 16, 5); ctx.fillRect(x + 4, y - 29, 17, 19);
    ctx.fillStyle = '#ba4938'; ctx.fillRect(x - 10, y - 28, 15, 4); ctx.fillRect(x - 16, y - 25, 10, 4);
    ctx.fillStyle = '#dbc995'; ctx.fillRect(x + 20, y - 25, 8, 5);
    ctx.fillStyle = '#829387'; ctx.fillRect(x + 4 + stride, y - 10, 6, 10); ctx.fillRect(x + 15 - stride, y - 10, 6, 10);
    text(score, String(run.score).padStart(4, '0')); text(best, String(high).padStart(4, '0'));
    text(status, run.over ? '碰到路障了，点按或空格再跑一程' : active ? '跳过路障，把军令送往前线' : '空格 / ↑ / 点按跳跃，随时可进入主菜单');
    text(button, run.over ? '再跑一程' : active ? '跳跃' : '开始跑酷');
  }
  function tick(now) {
    frame = 0;
    if (!active || doc.hidden) { previous = 0; return; }
    run.update(previous ? (now - previous) / 1000 : 0); previous = now;
    if (run.score > high) high = run.score;
    draw();
    if (run.over) {
      active = false; previous = 0;
      saveBest();
    } else frame = requestAnimationFrame(tick);
  }
  const jump = () => {
    run.jump(); active = true; draw();
    if (!frame && !doc.hidden) frame = requestAnimationFrame(tick);
  };
  const options = { signal: abort.signal };
  canvas.addEventListener('pointerdown', e => { if (e.button > 0) return; e.preventDefault(); canvas.focus(); jump(); }, options);
  button?.addEventListener('click', jump, options);
  (canvas.closest('[role="dialog"]') || canvas.parentElement).addEventListener('keydown', e => {
    if (!['Space', 'ArrowUp'].includes(e.code) || e.repeat || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    // Enter and Space on the entry button must keep their native meaning.
    if (e.target.closest?.('button') && e.target !== button) return;
    e.preventDefault(); jump();
  }, options);
  doc.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(frame); frame = 0; previous = 0;
    if (!doc.hidden && active) frame = requestAnimationFrame(tick);
  }, options);
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  return { destroy() { saveBest(); active = false; cancelAnimationFrame(frame); abort.abort(); observer.disconnect(); } };
}
