/** 座位（WEI/SHU）→ 势力（wei/shu/wu/lb）的显示映射 */
import { KINGDOMS } from '../data/cardDB.js';

let seatKingdoms = { WEI: 'wei', SHU: 'shu' };

export function setSeatKingdoms(map = {}) {
  seatKingdoms = { WEI: map.WEI || 'wei', SHU: map.SHU || 'shu' };
}
export const kingdomOf = seat => seatKingdoms[seat] || String(seat || 'wei').toLowerCase();
export const seatArmy = seat => KINGDOMS[kingdomOf(seat)]?.army || seat;
export const seatChar = seat => KINGDOMS[kingdomOf(seat)]?.name || '';
/** 卡牌显示用势力：优先卡牌自身的 kingdom 字段 */
export const cardKingdom = card => card?.kingdom || kingdomOf(card?.faction);
