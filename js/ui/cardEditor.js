import { normalizeCardPack, saveCardPack } from '../data/customCards.js';
import { ABILITY_TRIGGERS, EFFECT_TYPES, EFFECT_TARGETS } from '../engine/abilities.js';

const optionsHtml = values => values.map(value => `<option value="${value}">${value}</option>`).join('');

export class CardEditor {
  constructor(pack, onChange = () => {}) {
    this.pack = normalizeCardPack(pack);
    this.onChange = onChange;
    this.modal = document.getElementById('modal-card-editor');
    this.form = document.getElementById('custom-card-form');
    this.selectedId = null;
    this.pendingDeleteId = null;
    this._bind();
    this.renderList();
    this.newCard();
  }

  _bind() {
    document.getElementById('btn-close-card-editor').addEventListener('click', () => this.hide());
    this.modal.addEventListener('click', event => { if (event.target === this.modal) this.hide(); });
    document.getElementById('btn-new-custom-card').addEventListener('click', () => this.newCard());
    document.getElementById('btn-add-ability').addEventListener('click', () => this.addAbilityRow());
    document.getElementById('btn-delete-custom-card').addEventListener('click', () => this.deleteSelected());
    document.getElementById('btn-export-custom-cards').addEventListener('click', () => this.exportPack());
    document.getElementById('btn-apply-card-json').addEventListener('click', () => this.applyJSON());
    document.getElementById('custom-card-import').addEventListener('change', event => this.importFile(event.target.files?.[0]));
    this.form.addEventListener('submit', event => { event.preventDefault(); this.saveForm(); });
  }

  show() { this.refreshJSON(); this.modal.classList.remove('hidden'); }
  hide() { this.modal.classList.add('hidden'); }
  status(message, isError = false) {
    const el = document.getElementById('card-editor-status');
    el.textContent = message;
    el.classList.toggle('error', isError);
  }

  newCard() {
    this.selectedId = null;
    this.pendingDeleteId = null;
    this.form.reset();
    this.form.elements.id.value = `custom_wei_${Date.now().toString(36)}`;
    this.form.elements.name.value = '新卡牌';
    this.form.elements.description.value = '填写实际触发效果';
    document.getElementById('editor-ability-rows').replaceChildren();
    this.addAbilityRow();
    this.renderList();
    this.status('正在编辑新卡牌；保存后下一局生效。');
  }

  selectCard(id) {
    const card = this.pack.cards.find(item => item.id === id);
    if (!card) return;
    this.selectedId = id;
    this.pendingDeleteId = null;
    for (const field of ['id','name','faction','type','troopType','audioCue','cost','actionCost','atk']) {
      this.form.elements[field].value = card[field];
    }
    this.form.elements.hp.value = Math.max(1, card.hp);
    this.form.elements.keywords.value = card.keywords.join(', ');
    this.form.elements.description.value = card.skill.description;
    document.getElementById('editor-ability-rows').replaceChildren();
    for (const ability of card.abilities) {
      for (const effect of ability.effects) this.addAbilityRow(ability, effect);
    }
    this.renderList();
    this.status(`正在编辑【${card.name}】`);
  }

  addAbilityRow(ability = {}, effect = {}) {
    const row = document.createElement('div');
    row.className = 'editor-ability-row';
    row.innerHTML = `
      <label>时机<select class="ability-trigger">${optionsHtml(ABILITY_TRIGGERS)}</select></label>
      <label>效果<select class="ability-effect">${optionsHtml(EFFECT_TYPES)}</select></label>
      <label>目标<select class="ability-target">${optionsHtml(EFFECT_TARGETS)}</select></label>
      <label>数值<input class="ability-amount" type="number" min="0" max="20" value="1"></label>
      <label>词条<input class="ability-keyword" maxlength="24" placeholder="仅授予/移除词条时"></label>
      <label>条件 JSON<input class="ability-conditions" placeholder="[]"></label>
      <button class="editor-remove-ability" type="button" aria-label="移除这项效果">✕</button>`;
    row.querySelector('.ability-trigger').value = ability.trigger || 'ON_DEPLOY';
    row.querySelector('.ability-effect').value = effect.type || 'DRAW';
    row.querySelector('.ability-target').value = effect.target || 'OWNER';
    row.querySelector('.ability-amount').value = effect.amount ?? 1;
    row.querySelector('.ability-keyword').value = effect.keyword || '';
    row.querySelector('.ability-conditions').value = JSON.stringify(ability.conditions || []);
    row.querySelector('.ability-effect').addEventListener('change', () => {
      const type = row.querySelector('.ability-effect').value;
      if (['STEAL_CARD','STEAL_PROVISIONS','DAMAGE_HQ','DISCARD_RANDOM'].includes(type)) row.querySelector('.ability-target').value = 'OPPONENT';
      else if (['DAMAGE_UNIT','HEAL_UNIT','BUFF_ATTACK','BUFF_HEALTH','APPLY_SUPPRESSION','APPLY_INHIBITION','GRANT_KEYWORD','REMOVE_KEYWORD','REVEAL_UNIT','RESTORE_ACTION'].includes(type)) row.querySelector('.ability-target').value = 'SELF';
      else row.querySelector('.ability-target').value = 'OWNER';
    });
    row.querySelector('.editor-remove-ability').addEventListener('click', () => row.remove());
    document.getElementById('editor-ability-rows').appendChild(row);
  }

  formCard() {
    const form = this.form.elements;
    const abilities = [...document.querySelectorAll('#editor-ability-rows .editor-ability-row')].map(row => {
      const effect = {
        type: row.querySelector('.ability-effect').value,
        target: row.querySelector('.ability-target').value,
        amount: Number(row.querySelector('.ability-amount').value)
      };
      const keyword = row.querySelector('.ability-keyword').value.trim();
      if (keyword) effect.keyword = keyword;
      return {
        trigger: row.querySelector('.ability-trigger').value,
        conditions: JSON.parse(row.querySelector('.ability-conditions').value || '[]'),
        effects: [effect]
      };
    });
    return {
      id: form.id.value.trim(), name: form.name.value.trim(), faction: form.faction.value,
      type: form.type.value, troopType: form.troopType.value,
      audioCue: form.audioCue.value,
      cost: Number(form.cost.value), actionCost: Number(form.actionCost.value),
      atk: Number(form.atk.value), hp: Number(form.hp.value),
      keywords: form.keywords.value.split(/[,，]/).map(value => value.trim()).filter(Boolean),
      description: form.description.value.trim(), abilities
    };
  }

  saveForm() {
    try {
      const candidate = this.formCard();
      const cards = this.pack.cards.filter(card => card.id !== this.selectedId);
      cards.push(candidate);
      this.commit({ schemaVersion: 1, cards });
      this.selectCard(candidate.id);
      this.status(`【${candidate.name}】已保存；下一局加入牌组。`);
    } catch (error) { this.status(`保存失败：${error.message}`, true); }
  }

  deleteSelected() {
    if (!this.selectedId) return;
    if (this.pendingDeleteId !== this.selectedId) {
      this.pendingDeleteId = this.selectedId;
      this.status('再次点击“删除当前卡牌”以确认删除。', true);
      return;
    }
    const id = this.selectedId;
    this.commit({ schemaVersion: 1, cards: this.pack.cards.filter(card => card.id !== id) });
    this.newCard();
    this.status(`已删除 ${id}`);
  }

  commit(pack) {
    this.pack = saveCardPack(pack);
    this.onChange(this.pack);
    this.renderList();
    this.refreshJSON();
  }

  renderList() {
    const list = document.getElementById('custom-card-list');
    list.replaceChildren();
    for (const card of this.pack.cards) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `custom-card-list-item ${card.id === this.selectedId ? 'active' : ''}`;
      button.textContent = `${card.faction === 'WEI' ? '魏' : '蜀'} · ${card.name} · ${card.type}`;
      button.addEventListener('click', () => this.selectCard(card.id));
      list.appendChild(button);
    }
    if (!this.pack.cards.length) list.textContent = '暂无自定义卡牌';
  }

  refreshJSON() { document.getElementById('editor-pack-json').value = JSON.stringify(this.pack, null, 2); }
  applyJSON() {
    try {
      const raw = JSON.parse(document.getElementById('editor-pack-json').value);
      this.commit(raw);
      this.newCard();
      this.status(`已导入并校验 ${this.pack.cards.length} 张卡牌；下一局生效。`);
    } catch (error) { this.status(`JSON 导入失败：${error.message}`, true); }
  }

  async importFile(file) {
    if (!file) return;
    try {
      if (file.size > 200_000) throw new Error('卡包文件不能超过200 KB');
      const data = JSON.parse(await file.text());
      this.commit(data);
      this.newCard();
      this.status(`已导入 ${this.pack.cards.length} 张卡牌；下一局生效。`);
    } catch (error) { this.status(`文件导入失败：${error.message}`, true); }
    document.getElementById('custom-card-import').value = '';
  }

  exportPack() {
    const blob = new Blob([JSON.stringify(this.pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sanguo-kards-cards.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.status('卡包 JSON 已导出。');
  }
}
