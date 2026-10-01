const icon = name => `assets/ui/kit_v2/icons/${name}.webp`;
export const BOOT_ASSETS = [
  'assets/ui/home-bg.webp',
  ...['solo','battle','sandbox','decks','rules','workshop','fullscreen','audio'].map(icon)
];
export const DEFERRED_UI_ASSETS = ['assets/ui/kit_v2/modal_frame.svg',icon('castle'),icon('close'),icon('title-divider')];
