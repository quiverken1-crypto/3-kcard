const icon = name => `assets/ui/kit_v2/icons/${name}.webp`;
export const BOOT_LEVELS = Array.from({length:6},(_,i)=>icon(`loading-${String(i).padStart(2,'0')}`));
export const BOOT_GEMS = Array.from({length:7},(_,i)=>icon(`energy-${i}`));
export const BOOT_ASSETS = [
  'assets/ui/home-bg.webp',
  ...['solo','battle','sandbox','decks','rules','workshop','fullscreen','audio'].map(icon),
  ...BOOT_LEVELS,...BOOT_GEMS
];
export const DEFERRED_UI_ASSETS = ['assets/ui/kit_v2/modal_frame.svg',icon('castle'),icon('close'),icon('title-divider')];
export function bootLevelAt(energy) { return Math.max(0,Math.min(BOOT_LEVELS.length-1,Math.floor(energy))); }
