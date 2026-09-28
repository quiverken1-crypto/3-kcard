/**
 * 回合计时：
 * - 单步思考时间 stepMs（默认 40 秒）：每次行动后重新计时；
 * - 回合总时间 turnMs（默认 80 秒）：整个回合共用，不会因行动而重置；
 * 两者任一耗尽即超时。总时间剩余 warnTotalMs（默认 30 秒）时进入“告急”状态。
 */
export class TurnClock {
  constructor({ stepMs, durationMs, turnMs = 80000, warnTotalMs = 30000, now = () => Date.now(), onExpire = () => {} } = {}) {
    this.stepMs = stepMs ?? durationMs ?? 40000;
    this.turnMs = turnMs;
    this.warnTotalMs = warnTotalMs;
    this.now = now;
    this.onExpire = onExpire;
    this.deadline = 0;       // 实际截止（两者取早）
    this.stepDeadline = 0;
    this.turnDeadline = 0;
    this.expired = false;
  }

  /** 新回合：单步与总计时一起重置 */
  start() {
    const t = this.now();
    this.turnDeadline = t + this.turnMs;
    this.stepDeadline = t + this.stepMs;
    this._update();
    this.expired = false;
  }

  /** 同一回合内完成一次行动：只重置单步计时，总计时继续走 */
  restartStep() {
    if (!this.turnDeadline) { this.start(); return; }
    this.stepDeadline = this.now() + this.stepMs;
    this._update();
    this.expired = false;
  }

  _update() { this.deadline = Math.min(this.stepDeadline, this.turnDeadline); }

  stop() {
    this.deadline = 0;
    this.stepDeadline = 0;
    this.turnDeadline = 0;
    this.expired = false;
  }

  remainingSeconds() {
    if (!this.deadline) return 0;
    return Math.max(0, Math.ceil((this.deadline - this.now()) / 1000));
  }

  totalRemainingSeconds() {
    if (!this.turnDeadline) return 0;
    return Math.max(0, Math.ceil((this.turnDeadline - this.now()) / 1000));
  }

  /** 回合总时间告急（剩余 ≤ 30 秒） */
  isTotalWarning() {
    return Boolean(this.turnDeadline) && (this.turnDeadline - this.now()) <= this.warnTotalMs;
  }

  tick() {
    if (this.deadline && !this.expired && this.now() >= this.deadline) {
      this.expired = true;
      this.onExpire();
    }
    return this.remainingSeconds();
  }
}
