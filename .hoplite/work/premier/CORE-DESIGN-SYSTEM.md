# Premier · Core — design system (redesign steps 1–2 of 8)

This document describes the foundation that every later redesign step builds on.
It is written for someone who has only this file and the files it names.

- Showcase (every token and component, live): `/core/showcase.html`
- Nothing in the product uses the system yet. Steps 1 and 2 only add files.
- Step 1 built the foundation (sections 1–11). Step 2 built the Core, the 3D scene behind the interface (section 12).
- The guarantees below are checked by `tests/core-foundation.test.js` and `tests/core-scene.test.js` (`npm test`).

---

## 1. Files

| File | What it holds |
| --- | --- |
| `public/core/core-tokens.css` | Every design decision as a named value, both themes, fonts. |
| `public/core/core-base.css` | Page canvas, the glass material, small details (selection, focus, scrollbars, links, caret), cursor rules. |
| `public/core/core-components.css` | All base components and their states. |
| `public/core/core-ui.js` | Behaviour: dialog, menu, tooltip, toast, confirmation capsule, tabs, select list, Core light. One global: `CoreUI`. |
| `public/core/cursor/*.svg` | The six cursor drawings (reference copies; the tokens embed the same drawings). |
| `public/core/core-scene.css` | The scene layer: the canvas, the quiet fallback glow, mini cores. Replaces the step 1 stand-in. |
| `public/core/core-scene.js` | The Core: 3D scene, mini cores, commands. One global: `Core`. No library, raw WebGL 1. |
| `public/core/showcase.html`, `showcase.css`, `showcase.js` | The showcase page. Classes `sc-*` are for that page only. |
| `tests/core-foundation.test.js` | Automated checks of the rules in sections 1–11. |
| `tests/core-scene.test.js`, `tests/core-scene-util.js` | Automated checks of section 12. |

Load order on a page that uses the system (after any old stylesheets that are still needed):

```html
<html lang="ru" class="core">
...
<link rel="stylesheet" href="/core/core-tokens.css?v=1">
<link rel="stylesheet" href="/core/core-base.css?v=1">
<link rel="stylesheet" href="/core/core-components.css?v=1">
<link rel="stylesheet" href="/core/core-scene.css?v=1">
<script defer src="/core/core-ui.js?v=1"></script>
<script defer src="/core/core-scene.js?v=1"></script>
<script defer src="/js/your-page.js?v=1"></script>   <!-- after the two above: it may call CoreUI and Core at once -->
...
<body>
<div class="core-scene" aria-hidden="true"></div>   <!-- first child of body; the script fills it -->
```

`?v=N` makes the server cache the file for a year (existing product convention). Raise the number in every page whenever the file changes.

Naming: tokens are `--core-*`, classes `.core-*`, attributes `data-core-*`, events `core:*`, the script global `CoreUI`. Names starting with `--_` are private to one rule. The old system uses `--p-*` and unprefixed classes, so the two never collide. Do not edit `public/tokens.css`; tests read it.

The stylesheets do nothing until an element has the class `core`. `<html class="core">` switches the whole page (dark scene, type, cursor, scrollbars). `class="core"` on a block switches only that block (type, cursor, details; no page background).

---

## 2. The idea in one page

One 3D object, the **Core**, lives behind the whole interface: a glowing cloud of points that shows what the AI is doing (section 12). Everything else is **dark glass floating above the Core**.

- **Material.** Surfaces are translucent blurred glass. The Core stays visible through them. Opaque fills are not used; code and long reading text sit on the densest glass.
- **Light.** The Core is the only light source. Every surface has a one-pixel edge that is brightest on the side facing the Core.
- **Three depths.** Far (panels), mid (windows), near (menus, tooltips, notifications). They differ in blur, brightness and shadow and in nothing else.
- **Birth.** A window grows out of the point that was clicked, with a slight 3D turn, and collapses back into a spark.
- **Focus.** While a window is open the Core recedes and dims and everything under the window is blurred.
- **Colour.** The scene is a very dark, slightly warm black. The Core is incandescent: amber, white-hot when the model thinks. Amber is light, not paint. Everything else is glass and neutral text.
- **Two voices.** Onest for people, JetBrains Mono for the machine.
- **Cursor.** A four-pointed spark, drawn by the browser's native cursor.
- **Light theme.** The same system drawn as ink on paper: warm paper scene, the Core in dark ink, glass as frosted white, edges as ink hairlines.

---

## 3. Rules

These are the rules later steps must keep. Each has a reason.

1. **One amber action per screen.** `core-btn--main` appears once per screen or window. Amber also marks "the AI is working right now" (`core-tag--heat`, loading points, a busy main button). Sanctioned amber besides those two: the text caret, the notification mark, and the limit ring, because they are literally pieces of the Core. Nothing else is amber: no amber links, selection, icons, borders or "on" states.
2. **"On" is light, not colour.** A checked checkbox, an enabled switch, a selected segment, tab, chip or row get brighter (`--core-on`, `--core-fill-*`). This keeps a settings window with ten switches from becoming ten amber dots.
3. **Status colours only for status.** `--core-ok`, `--core-warn`, `--core-bad` mean success, warning, error. A destructive button uses `--core-bad` on its text and edge, never a solid red fill.
4. **Voices.** Human voice (Onest): all interface text and prose. Machine voice (JetBrains Mono): terminal, file names, code, limits and counters, statuses, model names, keys, keyboard shortcuts, timestamps in lists. Unbounded is not used anywhere. Machine text has ligatures off so `=>` and `!=` stay literal.
5. **Text levels and contrast.** `--core-text` and `--core-text-2` keep at least 4.5:1 on every glass depth even with the brightest possible background directly behind the glass (tested against pure white in the dark theme and pure black in the light theme). `--core-text-3` keeps 4.5:1 at rest only, so use it for hints, placeholders and metadata, never for something the user must read to continue. Never put body text straight on the scene where the Core can pass behind it; give it a far panel.
6. **Depth by role, not by taste.** See the table in section 5. Do not invent a fourth depth.
7. **Blur is never nested.** A glass surface inside another glass surface gets no `backdrop-filter` (the stylesheet enforces this). An open dialog blurs the page once through its backdrop; the dialog pane itself does not blur.
8. **Motion is fast and calm.** Only the four duration tokens and three easing tokens. Nothing bounces, nothing is longer than 320 ms. Looping motion is reserved for "working" states. All of it stops under reduced motion.
9. **Three radii, nested.** `lg` for windows and capsules, `md` for cards and menus, `sm` for controls and menu items. `lg − 8 = md`, `md − 6 = sm`, so an inner corner is concentric with its outer one when the padding is 8 or 6. Pills use `--core-r-full`.
10. **Spacing on the 4 px grid.** Use `--core-s-*`. The two half-steps (`s-05` = 2 px, `s-15` = 6 px) exist for optical corrections and concentric insets only.
11. **Keyboard focus is always visible.** A 2 px ring in `--core-focus` (warm white on dark, ink on light) with a 2 px offset. Text fields show the same colour on their border plus a soft halo.
12. **Touch targets are at least 44 px.** At `(pointer: coarse)` or widths up to 600 px, controls grow to 44 px and small ones get an invisible 44 px hit area. Fields use 16 px text there so iOS does not zoom.
13. **Never write `cursor: pointer`.** Use `cursor: var(--core-cursor-action)`. See section 8.

---

## 4. Tokens

All values live in `core-tokens.css`. The showcase prints the live values. The light theme redefines colours, glass and cursor; type, radii, spacing and motion are shared.

**Editing note.** The light block appears twice in the file (system setting and `data-theme="light"`), and the no-blur block three times. Keep the copies identical; the test fails if they differ.

### 4.1 Themes

The mechanism is the product's existing one: the system setting decides, and `data-theme="dark"` or `data-theme="light"` on `<html>` forces a theme. Dark is the primary theme and the fallback.

### 4.2 Light source

| Token | Meaning |
| --- | --- |
| `--core-x`, `--core-y` | Centre of the Core in percent of the viewport (0–100). Set on `<html>` only. |
| `--core-light` | Strength of the Core's light on the interface. 1 at rest. |
| `--core-at-x`, `--core-at-y` | Where a surface sits in the viewport, in percent. Defaults to the centre (50, 50). Set on the surface or a container. |

### 4.3 Colour roles

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--core-scene` | `#0B0A08` | `#F1ECE3` | Page background under everything. |
| `--core-glass-far` / `-mid` / `-near` | dark tints, 58 / 60 / 72 % | white tints, 56 / 66 / 82 % | Fill of each depth. |
| `--core-glass-dense` | `rgb(9 8 7 / .9)` | `rgb(250 247 241 / .92)` | Dense glass for code and long reading. |
| `--core-solid-far` … `-dense` | opaque | opaque | Same surfaces without blur (fallback). |
| `--core-edge` | `#FFE9CF` | `#1B1714` | Colour of the lit edge (light on dark, ink on paper). |
| `--core-fill-1` / `-2` / `-3` | warm white 5 / 9 / 14 % | ink 4.5 / 8 / 12 % | Layers on top of glass: hover / pressed, selected / thumb, strong. |
| `--core-well` | black 26 % | ink 3.5 % | Recess of a text field or segmented control. |
| `--core-line`, `--core-line-2` | warm white 8 / 17 % | ink 9 / 20 % | Hairline divider / control border. |
| `--core-scrim`, `--core-scrim-blur` | | | Dimming and blur under a dialog. |
| `--core-text`, `--core-text-2`, `--core-text-3` | `#F4EEE5`, `#C6BDB1`, `#9C9388` | `#1B1714`, `#4F4840`, `#6B635A` | Primary, secondary, hint. |
| `--core-text-on-heat` | `#1C1308` | `#1B1206` | Text on the main button. |
| `--core-on`, `--core-on-ink` | | | Fill and mark of a checked / enabled control. |
| `--core-heat-1` … `--core-heat-5` | ember `#A63A12`, flame `#E8590C`, amber `#FF8B2C`, glow `#FFB65C`, white-hot `#FFF0D6` | deeper values for paper | The heat scale. `heat-2` is the old brand orange. |
| `--core-point`, `--core-point-hot` | `heat-3`, `heat-5` | ink | Colour of a Core particle in the interface (loading points, notification mark). |
| `--core-ok`, `--core-warn`, `--core-bad` (+ `-soft`) | green, yellow, rose | deeper | Status text and its tinted background. |
| `--core-focus`, `--core-select`, `--core-caret` | | | Focus ring, text selection, caret. |
| `--core-scroll`, `--core-scroll-hover` | | | Scrollbar thumb. |
| `--core-syn-*` | | | Code colours: comment, keyword, string, number, func, type, punct. |

### 4.4 Depth

| Token | Far | Mid | Near | Dense |
| --- | --- | --- | --- | --- |
| `--core-blur-*` | 36 px | 24 px | 14 px | 24 px |
| `--core-bright-*` (dark) | .5 | .52 | .52 | .5 |
| `--core-backdrop-*` | full `backdrop-filter` value built from the two above | | | |
| `--core-shadow-*` | barely there | soft and deep | tight and dark | uses its depth's |
| `--core-edge-*` (peak edge brightness) | .26 | .42 | .6 | uses its depth's |

`--core-edge-shade` is the share of that brightness on the side turned away from the Core, `--core-edge-even` the share when the Core is directly behind the surface, `--core-sheen` the faint glow inside the glass on the Core's side.

The brightness and contrast numbers inside `--core-backdrop-*` are what make text readable when the Core is white-hot behind a pane. If you change a glass fill or a backdrop value, run the test: it recomputes the worst case.

### 4.5 Type

Six sizes per voice. Sizes are in `rem`, so the user's browser font size is respected; do not set `font-size` on `<html>`.

| Step | Human (Onest) | Machine (JetBrains Mono) | Line | Default weight | Use |
| --- | --- | --- | --- | --- | --- |
| 1 | 12 | 11 | 16 | 400 / 500 | Captions, hints, counters, tags. |
| 2 | 14 | 13 | 20 | 400 | Interface default: buttons, fields, menus, rows; code. |
| 3 | 16 | 15 | 24 | 400 | Prose, chat answers, large fields. |
| 4 | 20 | 18 | 28 | 600 / 500 | Window and section titles. |
| 5 | 28 | 26 | 36 | 600 / 500 | Page titles, large numbers. |
| 6 | 40 | 36 | 44 | 600 / 500 | Hero text. |

Machine sizes are one notch smaller so lowercase letters of the two fonts match in height on one line.

- Shorthands: `font: var(--core-human-3)`, `font: var(--core-machine-2)`. Classes: `.core-human-1…6`, `.core-machine-1…6`.
- Pieces: `--core-fs-N`, `--core-fsm-N`, `--core-lh-N`, weights `--core-w-1` (400), `--core-w-2` (500), `--core-w-3` (600), tracking `--core-track-4/5/6` for the three large steps.
- The `font` shorthand resets ligature settings. If you set a machine font with `font:` in new CSS, add `font-variant-ligatures: none` after it.

### 4.6 Radii, spacing, sizes

- Radii: `--core-r-sm` 8, `--core-r-md` 14, `--core-r-lg` 22, `--core-r-full` for pills.
- Spacing: `--core-s-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-10` 40, `-12` 48, `-16` 64, `-24` 96; half-steps `-05` 2 and `-15` 6.
- Control heights: `--core-h-sm` 28, `--core-h-md` 36, `--core-h-lg` 44 (they become 36 / 44 / 48 on touch and phone widths). `--core-hit` 44 is the minimum touch target. Icons: `--core-icon` 16, `--core-icon-lg` 20.

### 4.7 Motion

| Token | Value | Use |
| --- | --- | --- |
| `--core-dur-1` | 80 ms | Hover, press. |
| `--core-dur-2` | 140 ms | Switches, menus, tooltips, closing. |
| `--core-dur-3` | 220 ms | Birth of a window. |
| `--core-dur-4` | 320 ms | Notification flight, moving the Core's light. |
| `--core-ease-out` | `cubic-bezier(.16,1,.3,1)` | Appearing: leaves fast, settles softly. |
| `--core-ease-in` | `cubic-bezier(.5,0,.85,.25)` | Disappearing: collapses into a spark. |
| `--core-ease-move` | `cubic-bezier(.4,0,.2,1)` | Moving in place (thumb, ring). |
| `--core-ambient` | 2400 ms | Period of slow "breathing" loops. Not a transition. |

Reduced motion: when the system asks for it, or when `<html data-core-motion="reduce">` is set, the four durations become 0.01 ms and looping animations are removed. `core-ui.js` reads the same tokens, so scripted flights also become instant. Always take durations from tokens so this keeps working.

### 4.8 Layers, glyphs, cursor

- `--core-z-scene` −1, `--core-z-dialog` 2000, `--core-z-float` 2100 (menus, capsule), toasts and tooltips above that.
- `--core-glyph-spark`, `-check`, `-dash`, `-chevron`, `-close`: mask images. Paint them with `background: currentColor; mask: var(--core-glyph-spark) center/contain no-repeat`.
- Cursor tokens: section 8.

---

## 5. Glass

```html
<aside class="core-glass core-glass--far" data-core-at="left">…</aside>
<div class="core-glass">…</div>                       <!-- mid is the default -->
<div class="core-glass core-glass--near">…</div>
<div class="core-glass core-glass--dense">…</div>     <!-- combine with a depth if needed -->
```

| Depth | Class | Use it for |
| --- | --- | --- |
| Far | `core-glass--far` | Page chrome: sidebar, header, footer, section headers, any panel that carries text over the scene. |
| Mid | `core-glass` / `core-glass--mid`, `core-card`, `core-dialog__pane` | Windows: dialogs, cards, the chat input field, result window. |
| Near | `core-glass--near`, `core-menu`, `core-tip`, `core-toast`, `core-capsule` | Menus, tooltips, notifications, the confirmation capsule, popovers. |
| Dense | `core-glass--dense`, `core-code` | Readability, not depth: code blocks and long reading text. |

Components that are glass by definition (`core-card`, `core-menu`, `core-tip`, `core-toast`, `core-capsule`, `core-dialog__pane`, `core-code`) get the material without the `core-glass` class.

What the material consists of: the fill (`background`), the blur and dimming of whatever is behind (`backdrop-filter`), the shadow, and the edge drawn by `::after`. Because `::after` is taken, use `::before` for your own decoration on a glass element. Scrolling content must live in an inner element (`core-dialog__body`, `core-menu__scroll`, `pre`), otherwise the edge scrolls away with it. Set `border-radius` freely; the edge follows it.

### How the edge knows where the Core is

One place: `--core-x` and `--core-y` on `<html>`. The scene writes them whenever the Core changes place or state, so a page that runs the scene does not call this itself:

```js
CoreUI.light.set({ x: 50, y: 92 }, true);   // Core moved to the horizon; true = glide over 320 ms
CoreUI.light.set({ light: 1.2 });           // brighter edges; values above 1 are allowed
```

Every glass surface computes, in CSS, the direction from itself to that point and how far away it is, and lights its edge accordingly: far from the Core the edge is clearly directional; with the Core directly behind, the whole rim glows evenly.

A surface needs to know roughly where it is on screen (`--core-at-x`, `--core-at-y`):

- Default is the centre, which is right for the main column of content.
- Fixed chrome says where it lives: `data-core-at="left"`, `right`, `top`, `bottom` (combinable), or `data-core-at="core"` for "the Core is right behind me".
- Menus, tooltips, toasts and the capsule are positioned by `core-ui.js`, which sets their exact position.
- A dialog pane is treated as having the Core directly behind it, dimmed (`--core-light: .7`).

Limits to know:

- Change `--core-x/y/light` only when the screen changes state (empty chat, conversation, thinking), never every frame. They are inherited by the whole page, so each change restyles everything once; with the glide, once per frame for 320 ms.
- Browsers without CSS `atan2()` or `color-mix()` get an even hairline edge instead.

### Fallbacks

- No `backdrop-filter` support, or the system asks to reduce transparency, or `<html data-core-transparency="reduce">`: glass becomes the opaque `--core-solid-*` colours with the same edges and shadows, and the dialog backdrop stops blurring.
- Forced-colours (high contrast) mode: every glass surface shows a system-coloured outline.

### Contract with the scene

The scene (section 12) keeps this contract; a page only adds the container.

- The scene lives in `<div class="core-scene" aria-hidden="true">`, the first child of `<body>`. It is fixed, full-viewport, behind the content, and ignores the pointer. `html.core` paints the scene colour and makes `body` transparent, so nothing else is needed for the scene to show through. If the container is missing, the script creates it.
- The scene writes the Core's position with `CoreUI.light.set`.
- While a dialog is open, `<html>` has the attribute `data-core-focus` and receives the event `core:focus` with `detail.on`. The scene recedes, dims and renders about 12 times a second: the dialog backdrop is a full-viewport blur that is recomputed for every frame the scene paints.
- Step 1's `data-core-heat="think"` is replaced by `data-core-is="thinking"` (the scene sets it).
- The scene takes every colour from tokens: `--core-scene`, `--core-heat-1…5`, `--core-point`, `--core-text-3`.

---

## 6. Components

Every component is shown in every state on the showcase; its source is the reference markup. States use native pseudo-classes and ARIA attributes, so setting the attribute is setting the look:

| State | How |
| --- | --- |
| Hover, pressed, keyboard focus | Automatic. |
| Disabled | `disabled`, or `aria-disabled="true"` on non-form elements. |
| Loading | `aria-busy="true"`. |
| Error | `aria-invalid="true"` on the field. |
| Selected / on | `checked`, `aria-pressed`, `aria-selected`, `aria-checked`, `aria-current`. |

### Buttons

```html
<button class="core-btn core-btn--main">Main action</button>   <!-- one per screen -->
<button class="core-btn">Glass (default)</button>
<button class="core-btn core-btn--quiet">Quiet</button>
<button class="core-btn core-btn--danger">Destructive</button>
<button class="core-btn core-btn--icon core-btn--quiet" aria-label="Copy"><svg>…</svg></button>
```

Sizes: `core-btn--sm` (28), default (36), `core-btn--lg` (44); `core-btn--block` for full width. Works on `<a>` too. Icons are inline `<svg>` 16 px using `currentColor`. A busy button keeps its width, hides its label and shows three points with a running pulse. A disabled main button goes cold: no amber. A glass button placed straight on the scene blurs what is behind it; inside glass it does not.

### Fields

```html
<label class="core-field">
  <span class="core-field__label">Label</span>
  <input class="core-input" type="text" aria-invalid="true" aria-describedby="e1">
  <span class="core-field__error" id="e1">What is wrong</span>   <!-- or core-field__hint -->
</label>

<textarea class="core-input" rows="3"></textarea>
<select class="core-input">…</select>

<div class="core-inputbox" aria-busy="true"><svg>…</svg><input type="search"></div>   <!-- icon, prefix or button inside -->
```

On a desktop pointer `select.core-input` opens a glass list instead of the system one (keyboard: arrows, Home, End, first letter, Enter, Esc). The real `<select>` stays in the page and fires `input` and `change`, so existing code keeps working. Add `data-core-native` to keep the system list. Phones always get the system picker.

### Checkbox, radio, switch

```html
<label class="core-check"><input type="checkbox"><span>Text</span></label>
<label class="core-radio"><input type="radio" name="n"><span>Text</span></label>
<label class="core-switch"><input type="checkbox" role="switch"><span>Text</span></label>
```

The input itself is the drawn control, so `checked`, `indeterminate`, `disabled`, `aria-invalid` just work. The switch knob is a spark: small and dim when off, bright when on, with a quarter turn on the way. A switch without visible text needs `aria-label` on the input.

### Segmented control and tabs

```html
<div class="core-seg" role="radiogroup" aria-label="Period">
  <label class="core-seg__item"><input type="radio" name="p" checked><span>Month</span></label>
  <label class="core-seg__item"><input type="radio" name="p"><span>Year</span></label>
</div>

<div class="core-tabs" role="tablist" aria-label="Account">
  <button class="core-tab" role="tab" id="t1" aria-controls="p1" aria-selected="true">Profile</button>
  <button class="core-tab" role="tab" id="t2" aria-controls="p2" aria-selected="false" tabindex="-1">Plan</button>
</div>
<div class="core-tabpanel" role="tabpanel" id="p1" aria-labelledby="t1">…</div>
<div class="core-tabpanel" role="tabpanel" id="p2" aria-labelledby="t2" hidden>…</div>
```

Segments switch a mode of one screen and are real radio buttons (listen for `change`). Up to six items; the thumb slides. `button.core-seg__item` with `aria-pressed` is also supported. Tabs switch sections; `core-ui.js` handles clicks, arrow keys, Home and End, toggles the panels and fires `core:tab` on the tab.

### Chip, tag, badge

```html
<button class="core-chip" aria-pressed="true">Chip</button>
<span class="core-tag">gpt</span> <span class="core-tag core-tag--ok">ok</span> <span class="core-tag core-tag--heat">thinking</span>
<span class="core-badge">3</span> <span class="core-badge core-badge--dot"></span>
<kbd class="core-kbd">Ctrl K</kbd>
```

A chip is clickable and selectable. A tag only informs, in the machine voice; tones `--ok`, `--warn`, `--bad`; `--heat` is the "AI is working" tag. A badge counts; variants `--quiet`, `--ok`, `--warn`, `--bad`, `--dot`.

### Card and list row

```html
<div class="core-card"><h3 class="core-card__title">…</h3><p class="core-card__text">…</p><span class="core-card__meta">…</span></div>
<button class="core-card core-card--action" aria-pressed="true">…</button>

<ul class="core-list">
  <li><a class="core-row core-row--action" href="…" aria-current="page">
    <svg>…</svg>
    <span class="core-row__body"><span class="core-row__title">Title</span><span class="core-row__sub">Sub</span></span>
    <span class="core-row__trail">14:02</span>
  </a></li>
</ul>
```

### Menu and tooltip

```html
<button class="core-btn" data-core-menu="#m1" aria-haspopup="menu" aria-expanded="false">Actions</button>
<div class="core-menu" id="m1" role="menu" hidden>
  <div class="core-menu__label">Group</div>
  <button class="core-menu__item" role="menuitem" data-value="rename"><svg>…</svg><span>Rename</span><span class="core-menu__hint">F2</span></button>
  <button class="core-menu__item" role="menuitemcheckbox" aria-checked="false"><span>Pin</span></button>
  <hr class="core-menu__sep">
  <button class="core-menu__item core-menu__item--danger" role="menuitem"><span>Delete</span></button>
</div>

<button data-core-tip="Tooltip text" data-core-tip-key="Ctrl K">…</button>
```

- The menu element can sit anywhere; on first open it is moved into a top layer so nothing clips it. Listen on the menu: `menu.addEventListener('core:select', e => e.detail.item / e.detail.value)`, or put ordinary `click` handlers on items.
- `menuitemradio` items inside `role="group"` behave as one choice; `menuitemcheckbox` toggles. `data-core-keep` keeps the menu open after a choice. `data-core-align="end"` and `data-core-side="top"` on the trigger change placement. A long menu wraps its items in `core-menu__scroll`.
- Keyboard: arrows, Home, End, first letter, Enter or Space, Esc (returns focus to the trigger), Tab closes.
- Tooltips appear on hover after 400 ms and at once on keyboard focus, never on touch. Inside `.core`, an ordinary `title` attribute is converted to a Core tooltip the first time the pointer reaches it (the text is kept as `aria-label` when the element has no text). `data-core-native` on the element or an ancestor turns that off.

### Notification toast

```js
CoreUI.toast('Text');
CoreUI.toast({ text: 'Saved', tone: 'ok' });                       // tone: 'ok' | 'warn' | 'bad'
const t = CoreUI.toast({ text: 'Chat deleted', action: { label: 'Undo', onClick() {} }, duration: 8000 });
t.dismiss();
```

The capsule flies out of the Core's position (`--core-x/y`), rests at the top centre, and flies back. Hover or focus pauses the timer; a click dismisses. `duration: 0` keeps it until dismissed. At most three are visible. Errors are announced as alerts to screen readers.

### Dialog

```html
<button class="core-btn" data-core-open="#d1">Open</button>

<div class="core-dialog" id="d1" hidden>
  <div class="core-dialog__pane" role="dialog" aria-modal="true" aria-labelledby="d1t">
    <div class="core-dialog__head">
      <h2 class="core-dialog__title" id="d1t">Title</h2>
      <button class="core-btn core-btn--icon core-btn--quiet" data-core-close aria-label="…"><svg>…</svg></button>
    </div>
    <div class="core-dialog__body">…</div>
    <div class="core-dialog__foot">
      <button class="core-btn core-btn--quiet" data-core-close>Cancel</button>
      <button class="core-btn core-btn--main" data-core-close="saved">Save</button>
    </div>
  </div>
</div>
```

```js
CoreUI.dialog.open('#d1', { origin: event });   // origin: an event, an element or {x, y}; optional
CoreUI.dialog.close('#d1', 'value');            // returns a promise
el.addEventListener('core:close', e => e.detail.value);
el.addEventListener('core:beforeclose', e => e.preventDefault());   // veto
```

- The pane is born from the click point (keyboard: from the focused control) and collapses back to it; a spark flashes there.
- Esc and a click on the backdrop close it; `data-core-static` on the shell disables both. Focus moves into the window, stays inside (the rest of the page is made `inert`), and returns to the opener. The page behind does not scroll. Dialogs can stack.
- Widths: `core-dialog--sm` 400, default 520, `core-dialog--lg` 720. Up to 600 px wide the dialog becomes a sheet from the bottom with stacked full-width buttons.
- Place the shell as a direct child of `<body>`. Use `autofocus` to choose the first focused control.

### Confirmation capsule (replaces `confirm`, `alert`, `prompt`)

```js
if (!(await CoreUI.confirm('Delete this chat?'))) return;
if (!(await CoreUI.confirm({ text: 'Delete this chat?', ok: 'Delete', danger: true }))) return;
const name = await CoreUI.prompt({ text: 'New name', value: current });   // string, or null if cancelled
await CoreUI.alert('The file is too large.');
```

A small near-glass capsule appears next to the pointer (or the focused control), modal, without dimming the page. Enter confirms, Esc and a click elsewhere cancel. With `danger: true` the confirm button is destructive and Cancel has focus. Options: `text`, `ok`, `cancel`, `danger`, `main`, `value`, `placeholder`, `type`, `at`.

Two things to know when replacing the ~35 native calls:

- The native functions block; these return promises. The calling function becomes `async` and the call gets `await`. Check each call site for code that relied on blocking.
- Default button labels are «ОК» / «Отмена» when `<html lang>` starts with `ru`, otherwise "OK" / "Cancel": the labels the browser shows in its own boxes today. Pass `ok` / `cancel` to use product wording.

### Limit ring

```html
<span class="core-ring" role="meter" aria-label="…" aria-valuemin="0" aria-valuemax="100" aria-valuenow="62" style="--core-ring-v:.62"></span>
<span class="core-limit"><span class="core-ring core-ring--sm" …></span><span><b>62</b>/100</span></span>
```

`--core-ring-v` is the remaining share, 0 to 1. The ring shortens and the small core cools from glow to ember as the limit is spent; at `aria-valuenow="0"` it is ash. Sizes: `--sm` 20, default 28, `--lg` 48. Changing the value animates.

### Loading

```html
<div class="core-gather" role="status" aria-busy="true" aria-label="…">
  <span class="core-gather__line"></span>
  <span class="core-gather__line" style="--w:70%"></span>
  <span class="core-gather__block" style="--h:120px"></span>
  <span class="core-gather__dot" style="--w:36px"></span>
</div>
```

Points gather into the shape of the content that is coming, then breathe slowly. Build the shape from lines (text), blocks (images, cards) and dots (avatars) with `--w` and `--h`. Use this instead of spinners and grey bars. Buttons, input boxes and switches have their own busy state.

### Table, divider, avatar

```html
<div class="core-table-wrap"><table class="core-table">
  <thead><tr><th>Key</th><th class="core-num">Requests</th></tr></thead>
  <tbody><tr aria-selected="true"><td>…</td><td class="core-num">12 480</td></tr></tbody>
</table></div>

<hr class="core-divider">  <span class="core-divider core-divider--v"></span>  <div class="core-divider core-divider--label">or</div>
<span class="core-avatar">AK</span>  <span class="core-avatar core-avatar--lg"><img src="…" alt="…"></span>
```

`core-num` cells are machine voice, right-aligned, tabular.

### Code block

```html
<div class="core-code">
  <div class="core-code__head"><span class="core-code__name">server.js</span><span>javascript</span><button class="core-btn core-btn--icon core-btn--quiet core-btn--sm" aria-label="…">…</button></div>
  <pre><code>…</code></pre>
</div>
```

Dense glass, machine voice, no ligatures. The header is optional. highlight.js classes (`hljs-keyword`, `hljs-string`, …) are already mapped to `--core-syn-*`; `core-syn-*` classes do the same by hand. In the light theme the block is the densest paper, not a dark slab: the light theme is ink on paper throughout.

### Text helpers

`.core-prose` styles long reading text (paragraphs, headings, lists, quotes, inline code, links). `.core-link` is a link outside prose. `.core-text-2`, `.core-text-3` set text levels. `.core-sr` hides text visually but keeps it for screen readers.

---

## 7. Small details

All apply inside `.core`.

- **Selection:** neutral light (`--core-select`), not amber.
- **Focus ring:** 2 px `--core-focus`, offset 2 px. One rule deliberately out-ranks the old `!important` rule in `public/tokens.css`, so pages in transition already show the new ring.
- **Placeholder:** `--core-text-3`.
- **Caret:** amber (`--core-caret`). One token to change if this exception is not wanted.
- **Links:** text colour with a thin underline that brightens on hover. No amber, no visited colour.
- **Scrollbars:** a thin light thread with no track, brighter on hover. Desktop pointers only; phones keep system scrollbars.

---

## 8. Cursor

Three forms, drawn by the browser's own `cursor` property, so there is no script, no lag and no trail:

| Form | Token | Where | System fallback |
| --- | --- | --- | --- |
| Spark | `--core-cursor` | Default. | `default` |
| The same spark turned 45° | `--core-cursor-action` | Anything clickable. | `pointer` |
| Thin vertical bar | `--core-cursor-text` | Text that can be selected or edited. | `text` |

- 32 × 32 px image, figure about 16 px, hotspot exactly at the centre (16, 16).
- One solid colour that follows the surface, like text does: warm white on dark glass, ink on paper. On the incandescent main button the spark is ink (`--core-cursor-action-on-heat`), because white on amber would vanish.
- System cursors stay for everything without a branded form: `not-allowed` on disabled controls, `progress` on busy ones, and whatever a page sets for resizing, dragging and waiting.
- The rules exist only under `@media (any-pointer: fine)`. Touch devices get no cursor rules at all.
- Inside an `<iframe>` (the live preview) the embedded document controls the cursor.

How elements get a form:

- `core-base.css` assigns the forms to standard elements: links, buttons, form controls and ARIA roles get the action form; paragraphs, headings, list items, table cells, code and fields get the bar. These rules have zero specificity, so any explicit `cursor` in a page's own CSS wins.
- For a custom clickable element add the class `core-click`; for custom selectable text, `core-selectable`.
- Old CSS full of `cursor: pointer` keeps showing the system hand until it is migrated. When restyling a component, replace `cursor: pointer` with `cursor: var(--core-cursor-action)`. Step 8 should search for leftovers.

---

## 9. `CoreUI` reference

| Call | Does |
| --- | --- |
| `CoreUI.dialog.open(target, { origin })`, `.close(target, value)`, `.top()` | Dialogs. |
| `CoreUI.menu.open(target, anchor, { side, align })`, `.close(refocus)` | Menus. `anchor` is an element or `{x, y}`. |
| `CoreUI.tip.show(element, text, key)`, `.hide()` | Tooltip by hand. |
| `CoreUI.toast(textOrOptions)` → `{ el, dismiss }` | Notification. |
| `CoreUI.confirm(o)`, `.alert(o)`, `.prompt(o)` → promise | Confirmation capsule. |
| `CoreUI.tabs.select(tab)` | Select a tab from code. |
| `CoreUI.light.set({ x, y, light }, smooth)`, `.get()` | The Core's light. |
| `CoreUI.origin(eventOrElement)` | Point a surface is born from. |
| `Core.*` | The scene: section 12. |

Attributes: `data-core-open`, `data-core-close`, `data-core-static`, `data-core-menu`, `data-core-align`, `data-core-side`, `data-core-keep`, `data-core-tip`, `data-core-tip-key`, `data-core-tip-side`, `data-core-native`, `data-core-at`.
On `<html>`: `data-theme`, `data-core-motion="reduce"`, `data-core-transparency="reduce"`, `data-core-focus` (set by the script); scene: `data-core-scene`, `data-core-is`, `data-core-place`, `data-core-model`, `data-core-form`, `data-core-quality` (section 12).
Events: `core:open`, `core:beforeclose`, `core:close`, `core:select`, `core:tab`, `core:focus`, `core:scene`.

Everything is event delegation on `document`. Markup added later, including HTML built from strings, works without any init call. The script creates one element, `div.core-layers`, at the end of `<body>` for floating surfaces.

---

## 10. Applying the system to an existing page

Work on one screen at a time. The product must keep working after each step.

1. **Link the files** after the page's old stylesheets, with `?v=`, and add `class="core"` to `<html>`. In the RU page and its `public/en` mirror alike.
2. **Check what changed by itself:** page background and text colour, font, scrollbars, selection, focus ring, the default cursor. Old components keep their old look, because old rules are more specific than Core's element defaults.
3. **Add the scene**: the container (`core-scene`) as the first child of `<body>`, `core-scene.css`, `core-scene.js`, and the screen's place and state on `<html>` (section 12.9).
4. **Replace surfaces by role** using the depth table. Remove old backgrounds, borders, shadows and radii from the element and give it the glass class. Tell fixed chrome where it is (`data-core-at`).
5. **Replace components** with the Core markup above. Keep existing `id`s, `name`s, texts and handlers. Most product code toggles classes on existing elements, so often only class names and wrapper markup change.
6. **Replace values** in whatever CSS remains: colours, sizes, radii, spacing, durations become tokens. A leftover hex colour, pixel font size or `ms` duration in migrated CSS is a defect.
7. **Dialogs:** wrap the content in `core-dialog` / `core-dialog__pane` and open it with `CoreUI.dialog.open(el, { origin: event })` where the old code added an "open" class.
8. **Native boxes:** replace `confirm` / `alert` / `prompt` (section 6). Replace `title` tooltips only where the automatic conversion is not enough.
9. **Remove** the page's use of old tokens (`--p-*`) and old stylesheets once nothing on it needs them. Do not delete shared old files before step 8.
10. **Verify** at 1440 and 390 px, both themes, keyboard only, reduced motion, and with the Core at its brightest behind text. Run `npm test`.

Things that bite:

- Old stylesheets set `cursor: pointer`, `outline`, `z-index` up to four digits and `transition` on many elements. Floating Core surfaces sit at z-index 2000+.
- `backdrop-filter`, `transform`, `filter` and `contain` on an ancestor change how `position: fixed` children are placed. Keep dialogs as direct children of `<body>`.
- Do not add `backdrop-filter` in page CSS. Use the glass classes so the "never nested" rule holds.
- Do not write new interface texts. Components never contain text of their own, except the two default capsule labels described above.
- Existing tests read some pages and `public/tokens.css` as text. Run `npm test` after every page.
- The service worker (`public/sw.js`) caches only the folders listed in its `STATIC` pattern, and `/core/` is not among them. Pages work normally; Core files are simply fetched from the network each time. When the first product page starts using Core, add `core` to that pattern so the installed app keeps its offline cache complete (this covers `core-scene.js` and `core-scene.css` too).

---

## 11. Browser support and what has not been verified

Written for current Chrome, Edge, Yandex Browser, Safari and Firefox.

| Feature | Without it |
| --- | --- |
| `backdrop-filter` | Opaque glass. |
| `color-mix()`, CSS `atan2()` (2023) | Even hairline edge; fills still work. |
| `:has()` | Segmented thumb does not slide; the selected item is highlighted in place. |
| `@property` | The Core's light and the ring change without gliding. |
| `inert` | A scripted focus trap takes over. |
| SVG cursors | System cursors. |

Checked in Chrome only, without a GPU (see the change note for the list). Not checked on real hardware or in other browsers:

- The cursor on high-density screens and outside Chrome. In a real Chrome window at normal density the three forms, both colours and the hotspot were captured and measured (the figure's centre lands within half a pixel of the pointer position). A Safari-only block serves a double-size drawing to older Safari on Retina; it is untested.
- Scrolling smoothness. Software rendering says nothing about a real GPU. The design limits the cost (no nested blur, one blur layer per dialog, few glass surfaces on screen at once) but it needs a look on an ordinary laptop and a phone, especially with the real 3D scene behind.
- Safari and Firefox rendering in general, the glass select list outside Chrome, and screen-reader behaviour.

---

## 12. The Core (step 2)

The Core is one 3D object behind the whole interface: a cloud of several thousand points with real depth. It turns slowly, breathes, and shows what the AI does. In the dark theme the points are light: ember at the edges, hotter toward the centre, white-hot when the model thinks. In the light theme they are ink on paper: black stipple of different dot sizes, and the only colour, a burnt vermilion, appears when the AI works. The two themes use different drawing rules (light adds up; ink multiplies), not an inverted picture.

Live demo with every control: `/core/showcase.html`, section "Ядро". The showcase drives the Core only through the commands below.

### 12.1 Put it on a page

```html
<html lang="ru" class="core" data-core-place="horizon" data-core-is="rest" data-core-model="GPT-5">
...
<link rel="stylesheet" href="/core/core-scene.css?v=1">
<script defer src="/core/core-ui.js?v=1"></script>
<script defer src="/core/core-scene.js?v=1"></script>
...
<body><div class="core-scene" aria-hidden="true"></div>
```

- The three `data-core-*` attributes are optional. They set the first picture without script, and they place the light on glass edges correctly from the first paint. Defaults: `center`, `rest`, form `sphere`.
- The file only declares the commands when it loads. The scene itself starts after the page `load` event, in idle time, and only when the tab is visible. Commands sent earlier are not lost: they decide how the scene first appears. The canvas then fades in over 0.9 s.
- Nothing else is needed. The script creates the canvas, follows the theme, reduced motion, tab visibility and dialogs by itself.

### 12.2 Commands

One global object, `Core`. Every command returns `Core`, so calls can be chained. Unknown names are ignored.

| Command | Does |
| --- | --- |
| `Core.state(name, { target, ax, ay, hold })` | Sets the state (12.3). `hold` (ms): return to the previous state after that time. Without arguments: returns the current state. |
| `Core.pulse(kind)` | One-shot event: `'flash'`, `'error'`, `'key'` (12.3). |
| `Core.model(name)` | Takes the form of that AI model (12.4). Call it when the user picks a model. |
| `Core.form(id)` | Takes a form by its id, for screens without a model. |
| `Core.place(name)` or `Core.place({ x, y, size })` | Moves the Core (12.5). |
| `Core.target(elementOrPoint, { ax, ay })` | Where points lean and flow (12.6). `null` clears it. |
| `Core.set({ state, hold, target, ax, ay, model, form, place })` | Several of the above in one call. |
| `Core.quality(level)` | `'auto'` (default), `'high'`, `'mid'`, `'low'`, `'min'` (12.10). For the showcase and for a user setting, not for pages. |
| `Core.info()` | `{ mode, reason, state, shown, place, form, model, quality, auto, points, width, height, fps, ms, still, slow }`. |
| `Core.formOf(name)` | `{ form, variant }` that a model name gives, without changing anything. |
| `Core.mini.scan(root)`, `Core.mini.refresh()` | Mini cores (12.7). Normally not needed. |
| `Core.states`, `Core.pulses`, `Core.forms`, `Core.places`, `Core.qualities` | Lists of valid names. |
| `Core.test.lose()`, `.restore()`, `.glow(on)` | For the showcase and checks: lose and restore the graphics context, force the fallback glow. |

Event: `core:scene` on `<html>`, `detail.type` is `ready`, `mode`, `state` or `quality`; the rest of `detail` is `Core.info()`.

The scene keeps three attributes on `<html>` up to date, for CSS: `data-core-scene` = `boot` (not started), `live` (3D) or `glow` (fallback); `data-core-is` = the state shown now; `data-core-place` = the place shown now (`custom` for a point).

### 12.3 States

A state is a set of targets for a dozen smooth values (size, heat, rotation speed and so on). Every value moves on its own spring, so a change from any state to any other, also in the middle of another change, has no jump. A change takes about 1 to 1.5 s.

| State | What the user sees | Use it when | Frames per second |
| --- | --- | --- | --- |
| `rest` | Slow rotation (one turn in 90 s), breathing, a slow inner flow. | Nothing happens. | 30 |
| `listening` | The side of the cloud that faces the target reaches toward it; each `Core.pulse('key')` adds a small throb. | The user types. | 60 |
| `thinking` | The form contracts into a dense ball, turns five times faster, narrow bright bands run across it, colour heats toward white. | The request is sent, no text yet. | 60 |
| `answering` | About one point in seven leaves the cloud, flies along an arc to the target and fades there. | Text streams in. | 60 |
| `receded` | Smaller, dim, slow. | Set automatically while a dialog is open (with place `far`). Rarely set by hand. | 12 |
| `still` | Dim and motionless. After it settles, the loop stops: zero work. | Work-heavy screens: admin panel, tables. | 0 |

One-shot events do not change the state:

| Pulse | What the user sees | Length |
| --- | --- | --- |
| `flash` | One short hot pulse; glass edges brighten with it. | 0.7 s |
| `error` | The cloud scatters, cools, and gathers again. | 1.3 s |
| `key` | "The user typed": switches `rest` to `listening` and returns to `rest` 1.5 s after the last key. It does not interrupt `thinking` or `answering`. | — |

`Core.state('error')` and `Core.state('flash')` do the same as the pulses.

A chat page needs four lines:

```js
input.addEventListener('input', () => Core.target(input).pulse('key'));
onSend(() => Core.state('thinking'));
onFirstToken((messageEl) => Core.set({ state: 'answering', target: messageEl, ax: 0.1, ay: 1 }));
onDone(() => Core.state('rest'));          // onFail: Core.state('rest').pulse('error')
```

### 12.4 Forms and models

Eleven forms: `sphere`, `torus`, `spiral`, `lattice`, `helix`, `knot`, `bloom`, `orbits`, `ribbon`, `vortex`, `crystal`. A change of form flows for 1.9 s: each point has its place in both forms and its own delay, so the cloud pours from one into the other.

`Core.model(name)` derives the form from the model's display name. No list of models exists in the code:

- The **family** (which of the eleven) comes from the first word of the name: `gpt`, `claude`, `gemini`. Models of one lineage look related.
- The **variant** (four numbers: proportions, number of arms, petals, rings, turns, tilt) comes from the whole name. `Claude Opus 4.5` and `Claude Sonnet 4.5` are both knots, but different knots.
- Case, spaces and punctuation do not matter: `GPT-5`, `gpt 5` and `gpt-5` are one model. Any alphabet works.
- The same name gives the same cloud on every device, always. Renaming a model changes its form.

Do not reorder `FORM_IDS` in `core-scene.js` and do not change the hash: both would give every existing model another form. A test pins eleven known names. To add a twelfth form later, append it and reach it by `Core.form(id)` only.

### 12.5 Places

The Core travels between places in one continuous motion of about 1.2 s (position and size together, soft start and soft stop).

| Place | Geometry | Screen |
| --- | --- | --- |
| `center` | Centre at 50 % / 46 %, radius 30 % of the smaller side (110 to 330 px). | Empty chat. |
| `horizon` | Centre below the bottom edge; only a cap 120 to 230 px high (24 % of the height) rises above it. The reading area stays empty. When the Core contracts (`thinking`), it keeps its top edge, so the hot ball stays in view. | Conversation, behind the input field. |
| `full` | Radius 56 % of the screen diagonal: the cloud covers the corners. Calmer: 55 % brightness. | Login. |
| `far` | Centre of the screen, radius 19 % of the smaller side. | Set automatically under a dialog. |
| `{ x, y, size }` | `x`, `y` in percent of the viewport; `size` is the radius as a share of the smaller side (default 0.3). | Anything else. |

### 12.6 Targets

`listening` leans toward the target; `answering` sends the stream to it. A target is an element or a point in viewport pixels. For an element the scene reads its position at most five times a second and glides between readings, so a growing message is followed without work on the page side. `ax`, `ay` choose the point inside the element (0 to 1, default 0.5 / 0.5; values outside are allowed). Without a target: `listening` aims at the bottom centre of the screen, `answering` at 60 % of the height.

Give the stream a short way. In a conversation the Core is at the horizon and the newest text is just above the input field. Do not aim the stream at the top of a long text: it would cross the reading area.

### 12.7 Mini cores

Small cores for lists: the model menu, the status page, the limit ring. They are drawn on ordinary 2D canvases, not by the graphics card, so a page can hold any number of them (browsers allow only a few WebGL contexts per page). They use the same form generator as the big Core, with 60 to 170 points.

```html
<span class="core-mini" data-core-model="Claude Opus 4.5"></span>
<span class="core-mini core-mini--lg" data-core-model="GPT-5" data-core-cond="flicker"></span>
<span class="core-mini" data-core-form="torus" data-core-cond="dark"></span>
```

- Sizes: `core-mini--sm` 16, default 20, `core-mini--lg` 28, `core-mini--xl` 48 px.
- `data-core-cond`: `steady` (default: lit, turns slowly), `flicker` (dimmer, cooler, flickers; for a model with failures), `dark` (ash, motionless; for a model that is down). The three differ in brightness and density, not only in motion, so they stay distinct under reduced motion. Always put the status in words next to it.
- Change the attributes at any time; the mini core follows.
- They are found automatically, also in markup added later or built from strings. `Core.mini.scan(root)` exists for the rare case of a user stylesheet that disables animations (discovery uses an empty CSS animation as a marker).
- A mini core is decoration: it gets `aria-hidden="true"` unless you give it an `aria-label`.
- Only visible mini cores are drawn, 15 times a second; none when the tab is hidden.
- **Limit ring.** Every `.core-ring` gets a mini core inside automatically, in place of the drawn dot. It cools from glow to ember with `aria-valuenow`, and is ash at 0. Add `data-core-model` to the ring to give it the model's form.

### 12.8 Light on glass

The scene drives step 1's mechanism (`--core-x`, `--core-y`, `--core-light`) from the Core's real position, so the lit edges of all glass follow it:

- On a change of place the light glides (320 ms) in the middle of the Core's travel. Values are clamped to −10…110 (x) and −10…112 (y): at the horizon the light comes from below the screen edge.
- Light strength by state: `rest` 1, `listening` 1.05, `thinking` 1.2, `answering` 1.1, `still` 0.85. A `flash` adds 0.25 for a third of a second.
- The light changes only with place and state, never per frame (the rule of section 5).
- While a dialog is open the page light is left alone. Step 1 already treats the dialog pane as having the Core right behind it.
- Do not call `CoreUI.light.set` on a page that runs the scene.

### 12.9 Motion timing

The Core is the scene, not a control. Rule 8 (nothing longer than 320 ms) is for interface components and does not apply to it: a large object that crossed the screen in a third of a second would be violent. The Core's times are 0.7 to 1.9 s and are set in `core-scene.js`. The CSS side (canvas fade-in, fallback glow) uses two tokens of its own, `--core-scene-in` and `--core-scene-move`. Reduced motion switches all of it off.

Pointer: points near the cursor lean toward it by at most 6 px, and a click sends one ripple through the cloud. Mouse and pen only. It is meant to be noticed on the second day; do not strengthen it.

### 12.10 Readability: the brightness limit

Text never sits on the bare scene where the Core can pass (rule 5); it sits on glass. The Core is limited so that **every text level, including `--core-text-3`, keeps at least 4.5:1 on every glass depth at the brightest moment of the brightest state, in both themes**. This is stricter than section 3 rule 5, which promised `text-3` at rest only.

How it holds for any form, model, place, screen size and quality level: before a state begins, the scene estimates the densest spot of the cloud as it will look on screen (form, contraction, heat, depth, eight view angles, four sizes of the glass blur spot) and divides the brightness of every point by that estimate. Light per unit of area is therefore the same everywhere, and the constants `A_DARK`, `A_PAPER`, `FLASH` in `core-scene.js` set it once.

The strictest case is `text-3` on near glass (menus, tooltips) in the dark theme: it has 4.95:1 with nothing behind it, so the blurred Core behind a menu may add only a little light. This is why the Core is fine luminous dust and not a bright blob, and why white-hot is a colour here, not a floodlight. Consequences to know:

- If you raise `A_DARK`, `A_PAPER`, `FLASH`, a state's `bright`, or the aura constants, run the measuring test (below). Do not judge by eye.
- If the glass tokens change (fill, blur, `--core-bright-*`), run it too: the limit is computed against them.
- Measured lowest contrast over all forms, states and places: 4.56:1 in the dark theme, 4.95:1 in the light theme (details in the step 2 change note).

`tests/core-scene.test.js` contains this measurement: it renders real frames and applies the glass model of step 1 (blur, `saturate`, `contrast`, `brightness`, fill, sheen). It needs a WebGL implementation for Node and is skipped without it: `npm i --no-save gl`, then `node --test tests/core-scene.test.js`.

### 12.11 Performance and resilience

| Level | Points | Pixel density, up to | Canvas, up to | Frames per second: active / rest |
| --- | --- | --- | --- | --- |
| `high` | 14 000 | 2 | 4.4 MP | 60 / 30 |
| `mid` | 8 000 | 1.5 | 2.4 MP | 60 / 30 |
| `low` | 4 200 | 1 | 1.3 MP | 60 / 30 |
| `min` | 2 200 | 0.75 | 0.6 MP | 30 / 15, no aura |

- **Start level** from the device: desktop `high`; touch or small screens `mid`; 4 GB of memory or 4 processor cores or fewer, one level lower; 2 GB or "save data", `low`.
- **Self-measurement.** The scene times its own frames. When 20 of 50 frames are late it steps one level down. If `min` is still too slow it keeps a single still frame (`info().slow`). The result is remembered for a day (`localStorage`, key `core-q`), then one level higher is tried again. Fewer points look the same in brightness: points get larger and brighter to compensate.
- **Cost per frame.** One draw call for the points and one for the aura. All motion is computed in the vertex shader; the script sends about twenty numbers per frame. No per-frame layout reads, no per-frame style changes.
- **Draws as little as possible.** 30 frames a second at rest, 60 only while something changes; 12 under a dialog; none in `still`, with reduced motion, or in a hidden tab. Screens of 90 to 240 Hz are not followed above about 90.
- **Context loss.** The scene shows the fallback glow, rebuilds everything when the browser returns the context, and comes back.
- **No 3D.** No WebGL, a software-only WebGL (`failIfMajorPerformanceCaveat`), or a shader failure: `data-core-scene="glow"`, the quiet glow from step 1 drawn by CSS, at the same brightness limit. All commands keep working: the glow follows place and state, the light follows too. If the script never runs, CSS shows the glow by itself after four seconds.
- **Reduced motion** (system setting or `data-core-motion="reduce"`): one still frame per state. State and place changes apply at once; pulses are skipped.
- **Weight.** `core-scene.js` is 75 KB (26 KB gzipped), `core-scene.css` 8 KB. No library. A test fails above 90 KB.

### 12.12 Limits and what has not been verified

- Checked by rendering the real engine through a WebGL context in Node (ANGLE): every state, form, place, both themes, 1440 and 390 px wide, the brightness limit. Checked in Chrome without WebGL: the fallback, the control panel, mini cores, light on edges, reduced motion, a slowed processor.
- **Not checked: a real browser with a real graphics card.** Frame rates on real hardware, real context loss, the look of the Core through `backdrop-filter` glass, Safari, Firefox, a real phone. Look at the showcase on an ordinary laptop and a cheap phone before step 3.
- The stream of `answering` is thin by design; with a far target it is faint.
- Points are square sprites of 1.5 to about 12 px; on `min` the canvas is stretched and the dust is softer.
- Mini cores below 16 px lose their form; do not go smaller.
- The form of a model follows its name, not its id: a renamed model changes form.

Showcase address parameters, for checks: `theme=dark|light`, `motion=reduce`, `transparency=reduce`, `state=`, `place=`, `form=`, `model=`, `quality=`.
