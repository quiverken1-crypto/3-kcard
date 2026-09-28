const BASE = 'assets/audio/';
const SOUND_FILES = Object.freeze({
  sword: ['melee-sword-1.mp3', 'melee-sword-2.mp3', 'melee-sword-3.mp3'],
  fireball: ['ranged-fireball.mp3', 'fire-spell-1.mp3', 'fire-spell-2.mp3', 'fire-spell-3.mp3'],
  footstep: ['infantry-step-sand-1.mp3', 'infantry-step-sand-2.mp3', 'infantry-step-stone-1.mp3'],
  sand: ['infantry-step-sand-1.mp3', 'infantry-step-sand-2.mp3'],
  stone: ['infantry-step-stone-1.mp3'],
  cavalry: ['cavalry-gallop.mp3'],
  water: ['naval-entry.mp3', 'naval-swim.mp3'],
  splash: ['naval-entry.mp3'],
  spell: ['fire-spell-2.mp3', 'fire-spell-3.mp3']
});
// 没有素材文件的音效用 WebAudio 合成
const SYNTH_CUES = new Set(['grass', 'arrow', 'boulder', 'orb', 'hit', 'hqhit', 'chime', 'death', 'banner']);
const MUSIC_FILES = Object.freeze({ lobby: 'bgm-connection-changan.m4a', match: 'bgm-match-sanguosha-theme.m4a' });

// 优先 AAC（体积小），不支持的浏览器改用 MP3
function musicFile(scene) {
  const f = MUSIC_FILES[scene];
  try {
    const ok = typeof document !== 'undefined' && document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"');
    return ok ? f : f.replace(/\.m4a$/, '.mp3');
  } catch { return f; }
}

/** 地形 → 脚步音：水域入水、平原/林地草地、山地石地、支援阵线沙地 */
const TERRAIN_STEP = Object.freeze({ WATER: 'splash', PLAIN: 'grass', MOUNTAIN: 'stone', FOREST: 'grass', PASS: 'stone', LAND: 'sand' });

function attackCues(event) {
  const id = String(event.attackerCardId || '').replace(/_[0-9]+$/, '');
  const kws = event.attackerKeywords || [];
  const cues = [];
  if (id === 'wei_pi_li_che' || id === 'shu_fa_shi_che') cues.push('boulder');
  else if (event.attackerTroopType === 'STRATEGIST') cues.push('orb');
  else if (kws.includes('火攻')) cues.push('fireball');
  else if (kws.includes('矢石')) cues.push('arrow');
  else cues.push('sword');
  if (event.attackerTroopType === 'CAVALRY' && !kws.includes('矢石')) cues.push('cavalry');
  if (event.type === 'ATTACK_HQ' && event.damageDealt > 0) cues.push('hqhit');
  else if ((event.damageDealt ?? 0) > 0) cues.push('hit');
  if (event.defenderDied || event.attackerDied) cues.push('death');
  return cues;
}

export function selectAudioCues(event) {
  if (!event) return [];
  const selectedCue = event.audioCue || event.card?.audioCue;
  if (selectedCue && selectedCue !== 'auto' && event.type !== 'COMBAT_DAMAGE' && event.type !== 'ATTACK_HQ') return selectedCue === 'none' ? [] : [selectedCue];
  if (event.type === 'MOVE') {
    const surface = TERRAIN_STEP[event.toTerrain] || 'sand';
    return event.troopType === 'CAVALRY' ? ['cavalry', surface] : [surface];
  }
  if (event.type === 'DEPLOY' && event.card?.type === 'UNIT') {
    return [event.card.troopType === 'CAVALRY' ? 'cavalry' : 'sand'];
  }
  if (event.type === 'COMBAT_DAMAGE' || event.type === 'ATTACK_HQ') return attackCues(event);
  if (event.type === 'SKILL_DAMAGE') {
    const src = event.source || '';
    if (src.includes('火攻')) return ['fireball'];
    if (src.includes('连弩')) return ['arrow'];
    return ['hit'];
  }
  if (event.type === 'HQ_DAMAGED') return ['hqhit'];
  if (event.type === 'TACTIC_PLAYED') {
    const id = String(event.card?.cardId || '').replace(/_[0-9]+$/, '');
    if (id === 'shu_huo_gong') return ['banner', 'fireball'];
    if (id === 'shu_lian_nu_lian_she') return ['banner', 'arrow'];
    if (id === 'shu_chuan_xi_zhi_ji' || id === 'wei_wang_mei_zhi_ke') return ['banner', 'chime'];
    return ['banner', 'spell'];
  }
  if (event.type === 'COUNTER_TRIGGERED' || event.type === 'ABILITY_TRIGGERED') return ['spell'];
  return [];
}

export class AudioDirector {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.muted = false;
    this.volume = 0.65;
    this.scene = null;
    this.music = null;
    this.nextVariant = {};
    this.localMusic = {};
    try {
      this.muted = storage?.getItem('sanguo-kards-muted') === '1';
      const saved = Number(storage?.getItem('sanguo-kards-volume'));
      if (saved > 0 && saved <= 1) this.volume = saved;
    } catch { /* Private browsing may disable storage. */ }
  }

  _track(scene) {
    this._tracks = this._tracks || {};
    const src = this.localMusic[scene] || this.musicBlobs?.[scene] || BASE + musicFile(scene);
    let a = this._tracks[scene];
    if (!a || (a._src !== src && a.paused)) {
      a = new Audio(src);
      a._src = src;
      a.loop = true;
      a.preload = 'auto';
      this._tracks[scene] = a;
    }
    return a;
  }

  setScene(scene) {
    if (scene === this.scene) return;
    this.scene = scene;
    this.music?.pause();
    this.music = null;
    if (!MUSIC_FILES[scene] || typeof Audio === 'undefined') return;
    const music = this._track(scene);
    try { music.currentTime = 0; } catch { /* 未加载时忽略 */ }
    music.volume = this.muted ? 0 : this.volume * 0.36;
    this.music = music;
    if (!this.muted) this.unlock();
  }

  /** 浏览器要求用户先点一下才能出声：在任意点击/触摸/按键时解锁，直到真正播放成功 */
  armUnlock(doc = globalThis.document) {
    if (!doc || this._armed) return;
    this._armed = true;
    const handler = () => {
      this.unlock();
      if ((this.muted || (this.music && !this.music.paused)) && this.ctx?.state === 'running') {
        for (const t of events) doc.removeEventListener(t, handler, true);
      }
    };
    const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
    for (const t of events) doc.addEventListener(t, handler, true);
  }

  unlock() {
    const ctx = this._ctx();
    if (ctx?.state === 'suspended') ctx.resume?.();
    this._preloadSfx();
    if (this.muted || !this.music) return;
    if (!this.music.paused) return;
    const promise = this.music.play();
    promise?.catch?.(() => {}); // 等待下一次用户操作再试
  }

  _loadSfx(f) {
    this.buffers = this.buffers || {};
    this._sfxPromises = this._sfxPromises || {};
    if (this._sfxPromises[f]) return this._sfxPromises[f];
    const ctx = this._ctx();
    if (!ctx || typeof fetch === 'undefined') return Promise.resolve();
    this._sfxPromises[f] = fetch(BASE + f).then(r => r.arrayBuffer())
      .then(buf => new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); p?.then?.(res, rej); }))
      .then(decoded => { this.buffers[f] = decoded; })
      .catch(() => { delete this._sfxPromises[f]; });
    return this._sfxPromises[f];
  }

  /** 音效解码进内存（WebAudio），首次之后零延迟播放；手机上也不用每次重新下载 */
  _preloadSfx() {
    if (this._sfxLoading) return;
    this._sfxLoading = true;
    for (const f of new Set(Object.values(SOUND_FILES).flat())) this._loadSfx(f);
  }

  /** 供加载页使用的预加载任务：音效 + 两首背景乐（下载成 Blob，之后切换场景不再联网） */
  preloadTasks() {
    const tasks = [];
    for (const f of new Set(Object.values(SOUND_FILES).flat())) tasks.push({ weight: 1, label: '音效', run: () => this._loadSfx(f) });
    if (typeof fetch !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
      this.musicBlobs = this.musicBlobs || {};
      for (const scene of Object.keys(MUSIC_FILES)) {
        tasks.push({ weight: 25, label: '背景音乐', run: () => fetch(BASE + musicFile(scene)).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
          .then(b => {
            this.musicBlobs[scene] = URL.createObjectURL(b);
            // 当前场景若还没开始播放，换成本地缓存
            if (this.scene === scene && this.music?.paused) { this.scene = null; this.setScene(scene); }
          }) });
      }
    }
    return tasks;
  }

  setLocalTrack(scene, file) {
    if (!MUSIC_FILES[scene] || !file || !(file.type?.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|flac)$/i.test(file.name))) throw new Error('请选择有效的音频文件');
    if (this.scene === scene) this.music?.pause();
    if (this.localMusic[scene]) URL.revokeObjectURL(this.localMusic[scene]);
    this.localMusic[scene] = URL.createObjectURL(file);
    if (this.scene === scene) {
      this.scene = null;
      this.setScene(scene);
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.music) {
      this.music.volume = this.muted ? 0 : this.volume * 0.36;
      if (this.muted) this.music.pause();
      else this.unlock();
    }
    try { this.storage?.setItem('sanguo-kards-muted', this.muted ? '1' : '0'); } catch {}
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    if (this.music) this.music.volume = this.muted ? 0 : this.volume * 0.36;
    try { this.storage?.setItem('sanguo-kards-volume', String(this.volume)); } catch {}
  }

  _ctx() {
    if (this.ctx) return this.ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    return this.ctx;
  }

  _noise(ctx, seconds) {
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  _env(ctx, node, t0, attack, decay, peak) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    g.connect(ctx.destination);
    return g;
  }

  /** 合成音效：草地脚步、箭矢破空、落石、法术、受击、主城受击、钟声、阵亡、横幅锣声 */
  playSynth(cue) {
    const ctx = this._ctx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume?.();
    const v = this.volume * 0.8;
    const now = ctx.currentTime + 0.01;
    const noiseBurst = (t, dur, type, freq, q, peak, sweepTo) => {
      const n = this._noise(ctx, dur + 0.05);
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
      n.connect(f);
      this._env(ctx, f, t, 0.005, dur, peak * v);
      n.start(t); n.stop(t + dur + 0.05);
    };
    const tone = (t, dur, type, freq, peak, toFreq) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
      this._env(ctx, o, t, 0.008, dur, peak * v);
      o.start(t); o.stop(t + dur + 0.05);
    };
    switch (cue) {
      case 'grass': // 草叶沙沙：三段高频带通噪声
        for (let i = 0; i < 3; i++) noiseBurst(now + i * 0.11 + Math.random() * 0.03, 0.08, 'bandpass', 3200 + Math.random() * 1800, 1.2, 0.5);
        break;
      case 'arrow': noiseBurst(now, 0.22, 'bandpass', 5200, 3, 0.45, 1400); noiseBurst(now + 0.24, 0.05, 'lowpass', 900, 1, 0.5); break;
      case 'boulder': noiseBurst(now, 0.35, 'bandpass', 400, 1, 0.35, 180); tone(now + 0.38, 0.4, 'sine', 90, 0.9, 40); noiseBurst(now + 0.38, 0.3, 'lowpass', 600, 1, 0.6); break;
      case 'orb': tone(now, 0.35, 'sine', 520, 0.35, 1040); tone(now + 0.02, 0.4, 'triangle', 780, 0.25, 1560); break;
      case 'hit': noiseBurst(now + 0.05, 0.09, 'lowpass', 1400, 1, 0.55); tone(now + 0.05, 0.12, 'sine', 160, 0.5, 80); break;
      case 'hqhit': tone(now, 0.5, 'sine', 70, 1, 35); noiseBurst(now, 0.35, 'lowpass', 500, 1, 0.7); break;
      case 'chime': [880, 1320, 1760].forEach((f, i) => tone(now + i * 0.07, 0.7, 'sine', f, 0.28)); break;
      case 'death': tone(now + 0.15, 0.5, 'sawtooth', 180, 0.18, 60); noiseBurst(now + 0.15, 0.4, 'lowpass', 700, 1, 0.3); break;
      case 'banner': tone(now, 1.1, 'triangle', 196, 0.35, 180); tone(now, 1.1, 'sine', 392, 0.2, 360); noiseBurst(now, 0.15, 'bandpass', 2400, 2, 0.25); break;
      default: break;
    }
  }

  playCue(cue) {
    if (this.muted) return;
    if (SYNTH_CUES.has(cue)) { try { this.playSynth(cue); } catch { /* 无 WebAudio 时静默 */ } return; }
    if (!SOUND_FILES[cue] || typeof Audio === 'undefined') return;
    const files = SOUND_FILES[cue];
    const index = this.nextVariant[cue] || 0;
    this.nextVariant[cue] = (index + 1) % files.length;
    const file = files[index];
    const buf = this.buffers?.[file];
    const ctx = this.ctx;
    if (buf && ctx) {
      try {
        if (ctx.state === 'suspended') ctx.resume?.();
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = this.volume * 0.75;
        src.connect(g); g.connect(ctx.destination);
        src.start();
        return;
      } catch { /* 回落 */ }
    }
    const sound = new Audio(BASE + file);
    sound.volume = this.volume * 0.75;
    sound.play()?.catch?.(() => {});
  }

  playEvents(events) {
    // 同一批次去重，避免同类音效叠加爆音
    const played = new Set();
    for (const event of (events || []).slice(0, 16)) {
      for (const cue of selectAudioCues(event)) {
        if (played.has(cue)) continue;
        played.add(cue);
        this.playCue(cue);
      }
    }
  }
}
