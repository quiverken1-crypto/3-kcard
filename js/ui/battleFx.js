/**
 * battleFx.js — 战斗特效层
 *
 * 事件在渲染“之前”到达（此时 DOM 还是行动前的战场），因此：
 *  - 所有位置在调用时立即取样，特效用 fixed 定位的覆盖层绘制，不依赖会被重绘的单位节点；
 *  - 阵亡单位会复制一份“残影”播放倒下动画；
 *  - 需要作用在新节点上的效果（部署尘土、治疗光、受击震动）在下一帧按 instanceId 重新查找。
 */

const doc = () => (typeof document !== 'undefined' ? document : null);
const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const baseId = id => String(id || '').replace(/_[0-9]+$/, '');

let layer = null;
function fxLayer() {
  const d = doc();
  if (!layer || !layer.isConnected) {
    layer = d.createElement('div');
    layer.className = 'bfx-layer';
    d.body.appendChild(layer);
  }
  return layer;
}

function spawn(el, ms) {
  fxLayer().appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

function rectOf(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height };
}

/** 复制单位卡作为残影；外层按战场缩放比例放大，保证与原卡等大 */
function makeGhost(el, extraClass = '') {
  const r = rectOf(el);
  if (!r) return null;
  const natural = el.offsetWidth || r.w;
  const scale = r.w / natural;
  const wrap = doc().createElement('div');
  wrap.className = `bfx-ghost-wrap ${extraClass}`;
  Object.assign(wrap.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.w}px`, height: `${r.h}px` });
  const clone = el.cloneNode(true);
  clone.classList.add('bfx-ghost');
  Object.assign(clone.style, { transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute', left: '0', top: '0' });
  wrap.appendChild(clone);
  return { wrap, r };
}

const unitEl = id => (id ? doc()?.querySelector(`.board-unit[data-instance-id="${id}"]`) : null);

export class BattleFx {
  constructor({ getLocalPlayer } = {}) {
    this.getLocalPlayer = getLocalPlayer || (() => 'WEI');
  }

  hqEl(faction) {
    return doc()?.getElementById(faction === this.getLocalPlayer() ? 'slot-friendly-hq' : 'slot-opp-hq');
  }

  // ------------------------------------------------------------
  // 基础元件
  // ------------------------------------------------------------
  float(at, text, kind = 'dmg', delay = 0) {
    if (!at) return;
    const d = doc();
    setTimeout(() => {
      const el = d.createElement('div');
      el.className = `bfx-float bfx-${kind}`;
      el.textContent = text;
      el.style.left = `${at.x + (Math.random() * 16 - 8)}px`;
      el.style.top = `${at.y - 10}px`;
      spawn(el, 1300);
    }, delay);
  }

  blood(at, amount = 3, delay = 0) {
    if (!at) return;
    const d = doc();
    setTimeout(() => {
      const n = Math.min(12, 4 + amount);
      for (let i = 0; i < n; i++) {
        const drop = d.createElement('div');
        drop.className = 'bfx-blood';
        const ang = Math.random() * Math.PI * 2;
        const dist = 18 + Math.random() * 34;
        drop.style.left = `${at.x}px`;
        drop.style.top = `${at.y}px`;
        drop.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
        drop.style.setProperty('--dy', `${Math.sin(ang) * dist + 26}px`);
        drop.style.setProperty('--s', `${3 + Math.random() * 4}px`);
        spawn(drop, 800);
      }
    }, delay);
  }

  impact(at, kind = 'slash', delay = 0) {
    if (!at) return;
    const d = doc();
    setTimeout(() => {
      const el = d.createElement('div');
      el.className = `bfx-impact bfx-impact-${kind}`;
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
      if (kind === 'slash') {
        el.innerHTML = '<svg viewBox="0 0 100 100"><path d="M12 82 Q50 50 88 14" stroke="#fff4e0" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M12 82 Q50 50 88 14" stroke="#ff5a3c" stroke-width="3" fill="none" stroke-linecap="round"/></svg>';
      }
      spawn(el, 650);
    }, delay);
  }

  projectile(from, to, kind = 'arrow', duration = 360) {
    if (!from || !to) return 0;
    const d = doc();
    const count = kind === 'arrow' ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const el = d.createElement('div');
      el.className = `bfx-proj bfx-proj-${kind}`;
      const jitter = count > 1 ? (i - 1) * 10 : 0;
      el.style.left = `${from.x}px`;
      el.style.top = `${from.y + jitter}px`;
      const dx = to.x - from.x, dy = to.y - from.y - jitter;
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      spawn(el, duration + 80 + i * 60);
      if (typeof el.animate === 'function' && !reduced()) {
        const lift = kind === 'stone' ? -120 : (kind === 'arrow' ? -40 : 0);
        el.animate([
          { transform: `translate(0,0) rotate(${ang}deg)`, opacity: 1 },
          { transform: `translate(${dx / 2}px, ${dy / 2 + lift}px) rotate(${ang}deg)`, opacity: 1, offset: .5 },
          { transform: `translate(${dx}px, ${dy}px) rotate(${ang}deg)`, opacity: .9 }
        ], { duration, delay: i * 60, easing: 'linear', fill: 'forwards' });
      }
    }
    return duration;
  }

  /** 冲锋残影：复制攻击方卡面向目标突进 */
  dash(fromEl, to, duration = 260) {
    if (!fromEl || !to || reduced()) return 0;
    const g = makeGhost(fromEl, 'bfx-dash');
    if (!g) return 0;
    spawn(g.wrap, duration * 2 + 60);
    const dx = (to.x - g.r.x) * 0.75, dy = (to.y - g.r.y) * 0.75;
    g.wrap.animate?.([
      { transform: 'translate(0,0) scale(1)', opacity: .8 },
      { transform: `translate(${dx}px, ${dy}px) scale(1.06)`, opacity: .95, offset: .5 },
      { transform: 'translate(0,0) scale(1)', opacity: 0 }
    ], { duration: duration * 2, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
    return duration;
  }

  /** 阵亡残影 */
  death(el, delay = 0) {
    const g = makeGhost(el, 'bfx-dying');
    if (!g) return;
    g.wrap.style.animationDelay = `${delay}ms`;
    spawn(g.wrap, 1100 + delay);
    const d = doc();
    setTimeout(() => {
      const mark = d.createElement('div');
      mark.className = 'bfx-stamp bfx-stamp-dead';
      mark.textContent = '亡';
      mark.style.left = `${g.r.x}px`;
      mark.style.top = `${g.r.y}px`;
      spawn(mark, 900);
    }, delay + 120);
  }

  stamp(at, text, cls = '', delay = 0) {
    if (!at) return;
    const d = doc();
    setTimeout(() => {
      const el = d.createElement('div');
      el.className = `bfx-stamp ${cls}`;
      el.textContent = text;
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
      spawn(el, 900);
    }, delay);
  }

  burst(at, kind = 'fire', delay = 0) {
    if (!at) return;
    const d = doc();
    setTimeout(() => {
      const el = d.createElement('div');
      el.className = `bfx-burst bfx-burst-${kind}`;
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
      spawn(el, 900);
      if (kind === 'fire' && !reduced()) {
        for (let i = 0; i < 10; i++) {
          const e = d.createElement('div');
          e.className = 'bfx-ember';
          const a = Math.random() * Math.PI * 2, dist = 20 + Math.random() * 40;
          e.style.left = `${at.x}px`; e.style.top = `${at.y}px`;
          e.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
          e.style.setProperty('--dy', `${Math.sin(a) * dist - 40}px`);
          spawn(e, 900);
        }
      }
    }, delay);
  }

  /** 下一帧给新渲染的节点加一个临时类 */
  flashLater(selectorOrId, cls, ms = 700, delay = 0) {
    setTimeout(() => requestAnimationFrame(() => {
      const el = typeof selectorOrId === 'string' && selectorOrId.startsWith('#')
        ? doc()?.querySelector(selectorOrId)
        : unitEl(selectorOrId);
      if (!el) return;
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), ms);
    }), delay);
  }

  banner(text, cls = '') {
    const d = doc();
    const el = d.createElement('div');
    el.className = `bfx-banner ${cls}`;
    el.innerHTML = `<span>${text}</span>`;
    spawn(el, 1300);
  }

  arrowRain(faction, delay = 0) {
    if (reduced()) return;
    const d = doc();
    const units = [...d.querySelectorAll('.board-unit')].filter(el => el.dataset.faction && el.dataset.faction !== faction);
    const targets = units.length ? units.map(rectOf).filter(Boolean) : [];
    setTimeout(() => {
      for (const t of targets) {
        for (let i = 0; i < 3; i++) {
          const a = d.createElement('div');
          a.className = 'bfx-rain-arrow';
          a.style.left = `${t.x + (Math.random() * 40 - 20)}px`;
          a.style.top = `${t.y - 140}px`;
          a.style.animationDelay = `${i * 70 + Math.random() * 60}ms`;
          spawn(a, 800);
        }
      }
    }, delay);
  }

  glowUnits(ids, cls, delay = 0) {
    ids.forEach((id, i) => this.flashLater(id, cls, 1100, delay + i * 60));
  }

  // ------------------------------------------------------------
  // 事件分发
  // ------------------------------------------------------------
  present(events = []) {
    if (!doc()) return;
    let t = 0; // 同批次多个事件依次错开
    for (const ev of events) {
      try { t += this.presentOne(ev, t) || 0; } catch (err) { console.warn('FX error', err); }
    }
  }

  presentOne(ev, t) {
    switch (ev.type) {
      case 'COMBAT_DAMAGE': return this.onCombat(ev, t);
      case 'ATTACK_HQ': return this.onHqAttack(ev, t);
      case 'SKILL_DAMAGE': {
        const el = unitEl(ev.unitId);
        const at = rectOf(el);
        const src = ev.source || '';
        if (src.includes('火攻')) this.burst(at, 'fire', t);
        else if (src.includes('连弩')) this.impact(at, 'pierce', t);
        else if (src.includes('诱敌')) this.stamp(at, '伏', 'bfx-stamp-trap', t);
        else this.impact(at, 'hit', t);
        this.float(at, `-${ev.damage}`, 'dmg', t + 80);
        this.blood(at, ev.damage, t + 80);
        if (el && ev.damage >= 1) this.maybeDeath(el, ev, t + 200);
        return 90;
      }
      case 'HQ_DAMAGED': {
        const hq = this.hqEl(ev.playerId);
        const at = rectOf(hq);
        this.impact(at, 'hit', t);
        this.float(at, `-${ev.damage}`, 'hq', t + 60);
        this.flashLater(hq?.id ? `#${hq.id}` : null, 'bfx-hq-shake', 500, t);
        return 80;
      }
      case 'FATIGUE': {
        const at = rectOf(this.hqEl(ev.playerId));
        this.float(at, `士气 -${ev.damage}`, 'hq', t);
        return 60;
      }
      case 'TACTIC_PLAYED': return this.onTactic(ev, t);
      case 'COUNTER_TRIGGERED':
        this.banner(`反制 ·【${ev.counterName || ''}】`, 'bfx-banner-counter');
        return 120;
      case 'DEPLOY':
        if (ev.card?.instanceId) this.flashLater(ev.card.instanceId, 'bfx-deploy', 700, t);
        return 0;
      case 'MOVE': {
        const cls = ev.toTerrain === 'WATER' ? 'bfx-splash' : 'bfx-dust';
        if (ev.unitId) this.flashLater(ev.unitId, cls, 800, t);
        return 0;
      }
      default: return 0;
    }
  }

  maybeDeath(el, ev, delay) {
    // SKILL_DAMAGE 不带存活信息：先备好残影，渲染后若节点消失则播放阵亡
    const id = el.dataset.instanceId;
    const g = makeGhost(el, 'bfx-dying');
    if (!g) return;
    setTimeout(() => requestAnimationFrame(() => {
      if (unitEl(id)) return;
      spawn(g.wrap, 1100);
    }), delay);
  }

  attackKind(ev) {
    const id = baseId(ev.attackerCardId);
    const kws = ev.attackerKeywords || [];
    if (id === 'wei_pi_li_che' || id === 'shu_fa_shi_che') return 'stone';
    if (ev.attackerTroopType === 'STRATEGIST') return 'orb';
    if (kws.includes('矢石')) return 'arrow';
    if (kws.includes('火攻')) return 'fire';
    if (ev.attackerTroopType === 'CAVALRY') return 'charge';
    return 'melee';
  }

  onCombat(ev, t) {
    const atkEl = unitEl(ev.attackerId);
    const defEl = unitEl(ev.defenderId);
    const a = rectOf(atkEl), dpos = rectOf(defEl);
    const kind = this.attackKind(ev);
    let hit = t;
    setTimeout(() => {
      if (kind === 'charge' || kind === 'melee') this.dash(atkEl, dpos, kind === 'charge' ? 220 : 180);
      else this.projectile(a, dpos, kind === 'orb' ? 'orb' : kind, kind === 'stone' ? 520 : 360);
    }, t);
    hit += kind === 'stone' ? 520 : (kind === 'charge' || kind === 'melee' ? 200 : 360);

    const impactKind = { stone: 'boom', orb: 'magic', arrow: 'pierce', fire: 'fire', charge: 'slash', melee: 'slash' }[kind];
    if (ev.banished) {
      this.impact(dpos, 'slash', hit);
      this.stamp(dpos, '斩', 'bfx-stamp-banish', hit);
    } else if (ev.ambushTriggered) {
      this.stamp(a, '伏', 'bfx-stamp-trap', hit - 120);
    } else {
      if (kind === 'fire') this.burst(dpos, 'fire', hit); else this.impact(dpos, impactKind, hit);
    }
    const dealt = ev.damageDealt ?? ev.attackerDamage ?? 0;
    const counter = ev.counterDealt ?? ev.defenderDamage ?? 0;
    if (!ev.banished && dealt > 0) {
      this.float(dpos, `-${dealt}`, dealt >= 5 ? 'crit' : 'dmg', hit + 40);
      this.blood(dpos, dealt, hit + 40);
    } else if (!ev.banished && !ev.ambushTriggered) {
      this.float(dpos, '格挡', 'block', hit + 40);
    }
    if (counter > 0) {
      this.impact(a, 'hit', hit + 220);
      this.float(a, `-${counter}`, 'counter', hit + 260);
      this.blood(a, counter, hit + 260);
    }
    if (ev.vanguardImmunity) this.stamp(a, '先登', 'bfx-stamp-skill', hit + 200);
    else if (ev.chargeImmunity) this.stamp(a, '冲阵', 'bfx-stamp-skill', hit + 200);
    if (ev.defenderDied && defEl) this.death(defEl, hit + 180);
    if (ev.attackerDied && atkEl) this.death(atkEl, hit + 380);
    if (ev.overflowDamage > 0) {
      const hq = this.hqEl(ev.playerId === this.getLocalPlayer() ? this.oppOf(ev.playerId) : this.getLocalPlayer());
      this.float(rectOf(hq), `-${ev.overflowDamage}`, 'hq', hit + 420);
    }
    return hit - t + 150;
  }

  oppOf(p) { return p === 'WEI' ? 'SHU' : 'WEI'; }

  onHqAttack(ev, t) {
    const atkEl = unitEl(ev.attackerId);
    const hq = this.hqEl(this.oppOf(ev.playerId));
    const a = rectOf(atkEl), h = rectOf(hq);
    const kind = this.attackKind(ev);
    setTimeout(() => {
      if (kind === 'charge' || kind === 'melee') this.dash(atkEl, h, 220);
      else this.projectile(a, h, kind === 'orb' ? 'orb' : kind, kind === 'stone' ? 520 : 380);
    }, t);
    const hit = t + (kind === 'stone' ? 520 : 300);
    this.impact(h, kind === 'stone' ? 'boom' : 'slash', hit);
    if (ev.damageDealt > 0) {
      this.float(h, `-${ev.damageDealt}`, 'hq', hit + 40);
      this.flashLater(hq?.id ? `#${hq.id}` : null, 'bfx-hq-shake', 500, hit);
    } else {
      this.float(h, '无伤', 'block', hit + 40);
    }
    return hit - t + 150;
  }

  onTactic(ev, t) {
    const name = ev.cardName || ev.card?.name || '战法';
    this.banner(`战法 ·【${name}】`);
    const id = baseId(ev.card?.cardId);
    const own = ev.playerId;
    const target = rectOf(unitEl(ev.targetId));
    const myHq = rectOf(this.hqEl(own));
    const friendlyIds = [...(doc()?.querySelectorAll('.board-unit') || [])].filter(el => el.dataset.faction === own).map(el => el.dataset.instanceId);
    switch (id) {
      case 'shu_lian_nu_lian_she': this.arrowRain(own, t + 200); break;
      case 'shu_chuan_xi_zhi_ji': this.glowUnits(friendlyIds, 'bfx-heal', t + 150); break;
      case 'wei_wang_mei_zhi_ke': this.glowUnits(friendlyIds, 'bfx-buff', t + 150); break;
      case 'shu_shu_si_yi_zhan': this.glowUnits(friendlyIds, 'bfx-rage', t + 150); break;
      case 'wei_ce_fan': this.burst(target, 'charm', t + 200); break;
      case 'shu_zha_bai': this.burst(target, 'smoke', t + 150); break;
      case 'wei_hong_men_yan': this.burst(target, 'wine', t + 150); break;
      case 'shu_sheng_dong_ji_xi': this.burst(target, 'smoke', t + 150); break;
      case 'shu_huo_gong': break; // 伤害由 SKILL_DAMAGE 逐个呈现
      default: this.burst(myHq, 'gold', t + 150);
    }
    return 350;
  }
}

export default BattleFx;
