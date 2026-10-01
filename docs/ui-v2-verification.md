# V2 UI and courier runner

The five supplied atlases are preserved. `tools/extractUiV2.py` extracts proportional transparent parts with documented coordinates. UI layers use restrained jade/bronze colors, nine-slice buttons and small icons. Dense battle elements retain lightweight borders and do not receive decorative overlays.

Opening is now an optional courier runner. Space, Up or touch jumps; collision offers a retry. Entry is immediate, loading continues in the background, and the home menu can reopen the runner. Best score persists on collision and exit. Canvas scaling is uniform, and animation/listeners are stopped on exit or suspended when hidden.

Verification: 148 native tests pass, including four runner tests. Chromium screenshots inspected at 1440×900, 390×844, 844×390 and 320×568 for opening, home, preparation and battle. Browser lifecycle checks cover keyboard entry/jump, touch, Escape, reopening, exit freeze, orientation resize and rulebook close. No page errors and no horizontal document overflow observed. Screenshots and local QA scripts live in ignored `.qa/`.
