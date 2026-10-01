# UI v2 and courier runner implementation plan

Goal: Integrate the supplied v2 atlas with readable responsive UI and replace the loading interaction with a courier runner.
Architecture: Extract proportional transparent sprites into assets/ui/kit_v2/parts; apply one final scoped stylesheet. Keep simulation independent from canvas rendering and tie runner lifetime to the opening screen.
Tech stack: Native CSS, ES modules, Canvas, node:test.

- [x] Extract framed button, understated corners, divider and functional icons; document crop coordinates.
- [x] Test runner jump, collision, restart, frame-rate independence and fair obstacle spacing before implementing.
- [x] Add optional opening runner with touch/keyboard controls, best score and explicit entry button; stop animation on exit and background.
- [x] Apply responsive decoration, reserved text padding and mobile safe areas. Avoid sprite stretch and clickable decorations.
- [x] Run all native tests; inspect desktop, portrait and landscape screenshots and interaction; commit and open a draft PR.
