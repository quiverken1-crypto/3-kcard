/**
 * prng.js — Deterministic Mulberry32 Seeded PRNG Engine
 * Conforms to tech_architecture.md §3.5 and PROJECT.md F34.
 */

export class PRNG {
  /**
   * Initializes the PRNG with a 32-bit integer seed.
   * @param {number} [seed=12345]
   */
  constructor(seed = 12345) {
    this.initialSeed = Number(seed) >>> 0;
    this.state = this.initialSeed;
    this._checkpoints = [];
  }

  /**
   * Generates a deterministic pseudorandom float in [0, 1).
   * @returns {number}
   */
  next() {
    this.state = ((this.state + 0x6D2B79F5) | 0) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generates a deterministic uniform integer in [min, max] inclusive.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  randomInt(min, max) {
    if (min === max) return min;
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    const range = high - low + 1;
    return low + Math.floor(this.next() * range);
  }

  /**
   * Alias for randomInt for standard API compatibility.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  nextInt(min, max) {
    return this.randomInt(min, max);
  }

  /**
   * Performs an in-place Fisher-Yates shuffle on an array using deterministic randomness.
   * @template T
   * @param {T[]} array
   * @returns {T[]}
   */
  shuffleArray(array) {
    if (!Array.isArray(array)) return array;
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i);
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  /**
   * Alias for shuffleArray.
   * @template T
   * @param {T[]} array
   * @returns {T[]}
   */
  shuffle(array) {
    return this.shuffleArray(array);
  }

  /**
   * Serializes current PRNG state into a portable POJO or JSON.
   * @returns {{ initialSeed: number, state: number }}
   */
  getState() {
    return {
      initialSeed: this.initialSeed >>> 0,
      state: this.state >>> 0
    };
  }

  /**
   * Serializes PRNG into JSON string or POJO.
   * @param {boolean} [asString=false]
   * @returns {string|{ initialSeed: number, state: number }}
   */
  serialize(asString = false) {
    const obj = this.getState();
    return asString ? JSON.stringify(obj) : obj;
  }

  /**
   * Restores PRNG state from a serialized POJO, JSON string, or number.
   * @param {{ initialSeed?: number, state: number }|string|number} savedState
   */
  setState(savedState) {
    if (typeof savedState === 'string') {
      try {
        savedState = JSON.parse(savedState);
      } catch {
        savedState = parseInt(savedState, 10);
      }
    }
    if (typeof savedState === 'number') {
      this.state = savedState >>> 0;
    } else if (savedState && typeof savedState.state === 'number') {
      this.state = savedState.state >>> 0;
      if (typeof savedState.initialSeed === 'number') {
        this.initialSeed = savedState.initialSeed >>> 0;
      }
    }
  }

  /**
   * Deserializes and restores state.
   * @param {{ initialSeed?: number, state: number }|string|number} savedState
   */
  deserialize(savedState) {
    this.setState(savedState);
  }

  /**
   * Static factory to deserialize PRNG instance.
   * @param {{ initialSeed?: number, state: number }|string|number} savedState
   * @returns {PRNG}
   */
  static deserialize(savedState) {
    const prng = new PRNG();
    prng.setState(savedState);
    return prng;
  }

  /**
   * Pushes current state onto the rollback checkpoint stack.
   */
  checkpoint() {
    this._checkpoints.push(this.state);
  }

  /**
   * Pops and restores the most recently saved checkpoint.
   * @returns {boolean} True if a checkpoint was restored, false if stack was empty.
   */
  rollback() {
    if (this._checkpoints.length > 0) {
      this.state = this._checkpoints.pop();
      return true;
    }
    return false;
  }

  /**
   * Clears all saved checkpoints.
   */
  clearCheckpoints() {
    this._checkpoints.length = 0;
  }

  /**
   * Resets PRNG state back to its initial seed.
   */
  reset() {
    this.state = this.initialSeed >>> 0;
    this._checkpoints.length = 0;
  }

  /**
   * Creates an independent deep clone of this PRNG instance.
   * @returns {PRNG}
   */
  clone() {
    const copy = new PRNG(this.initialSeed);
    copy.state = this.state >>> 0;
    copy._checkpoints = [...this._checkpoints];
    return copy;
  }
}

export default PRNG;
