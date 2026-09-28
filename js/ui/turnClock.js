export class TurnClock {
  constructor({ durationMs = 30000, now = () => Date.now(), onExpire = () => {} } = {}) {
    this.durationMs = durationMs;
    this.now = now;
    this.onExpire = onExpire;
    this.deadline = 0;
    this.expired = false;
  }

  start() {
    this.deadline = this.now() + this.durationMs;
    this.expired = false;
  }

  stop() {
    this.deadline = 0;
    this.expired = false;
  }

  remainingSeconds() {
    if (!this.deadline) return 0;
    return Math.max(0, Math.ceil((this.deadline - this.now()) / 1000));
  }

  tick() {
    if (this.deadline && !this.expired && this.now() >= this.deadline) {
      this.expired = true;
      this.onExpire();
    }
    return this.remainingSeconds();
  }
}
