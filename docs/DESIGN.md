# Ghost HUD / Schematic Glass — Framework Style Guide (Layout-Agnostic)
Version: 1.1  
Scope: **Visual language + component rules** for a UI framework. Does **not** assume any single page layout.  
Goal: Any new screen or widget can vary in structure while still reading as the same “ghost lab HUD” system.

---

## 0) Style Identity (portable)
A quiet operator UI made of **fogged-glass surfaces**, **hairline schematic markings**, **micro-label typography**, and **atmospheric depth** (haze + grain + dust). Contrast comes from **opacity layering**, not loud color.

---

## 1) Global Principles (apply everywhere)
- **Opacity is hierarchy:** the UI is built from 6–8 opacity levels; avoid hard color blocks.
- **Lines are hairline:** 1px rules and brackets; no thick borders.
- **Text is off-white:** never pure white; micro text is lower opacity.
- **Accent is rare:** 1 accent hue used only for selection/state/primary affordance.
- **Atmosphere is mandatory:** background haze + subtle grain + occasional dust points.
- **Measured geometry:** spacing feels instrument-calibrated (consistent steps, aligned baselines).

---

## 2) Tokens (colors, opacity, radii, spacing)

### 2.1 Color Tokens (defaults)
Base:
- `--bg-900: #2C2F3C`
- `--bg-800: #363A4A`
- `--mist-600: #4A5067`
- `--mist-500: #69708A`

Text:
- `--text-strong: #D3D6E0`
- `--text-soft: rgba(211,214,224,0.78)`
- `--text-micro: rgba(211,214,224,0.62)`

Rules / borders:
- `--rule-1: rgba(211,214,224,0.14)`
- `--rule-2: rgba(211,214,224,0.10)`

Panels:
- `--panel-fill: rgba(105,112,138,0.20)`
- `--panel-fill-2: rgba(105,112,138,0.14)`
- `--panel-header: rgba(105,112,138,0.18)`

Accent:
- `--accent: #93C0FF`

### 2.2 Opacity Ladder (do not invent new steps)
Use these steps for fills/lines/overlays:
- `O0 = 0.04` (grain only)
- `O1 = 0.06` (ghost UI hints)
- `O2 = 0.10` (secondary rules)
- `O3 = 0.14` (primary hairlines)
- `O4 = 0.20` (panel fill)
- `O5 = 0.32` (hover emphasis)
- `O6 = 0.78–0.92` (text)

### 2.3 Geometry Tokens
- Border thickness: `1px` (hairline)
- Corner bracket length: `10–18px`
- Bracket offset: `6–12px`
- Radius: **0–6px** (mostly squared; slight rounding allowed)
- Spacing scale (recommended): `4 / 8 / 12 / 16 / 24 / 32 / 40`

---

## 3) Typography System (layout-independent)
### 3.1 Roles (use these roles everywhere)
- **Brand/Context label** (small uppercase, wide tracking)
- **Module title** (uppercase or title case, mild tracking)
- **Body** (sentence case, readable line height)
- **Readout** (numeric/status tokens; mono optional)

### 3.2 Tracking (must)
- Micro labels: `letter-spacing: 0.14em–0.24em`
- Titles: `0.06em–0.14em`
- Body: `0.00em–0.02em`

### 3.3 Weight & color
- Prefer regular/light.
- Use `--text-strong` for main labels, `--text-micro` for metadata.
- Avoid pure white and bold-heavy blocks.

---

## 4) Material System (the “glass” language)
### 4.1 Surface Types
Define all UI surfaces as one of these:

1) **Ghost Surface**
- Fill: `--panel-fill-2` (O1–O2 range)
- Border: `--rule-2`
- Blur: heavy (if available)
- Purpose: background layers, inactive modules, “stack depth”

2) **Primary Glass Surface**
- Fill: `--panel-fill` (O4)
- Border: `--rule-1` (O3)
- Shadow: soft ambient only
- Purpose: readable cards, panes, modals, sidebars

3) **Header Strip / Rail**
- Fill: `--panel-header`
- Divider: `--rule-2`
- Purpose: section headers, table headers, control rails

4) **Overlay / Scrim**
- A gentle fog veil used behind modals:
- Fill: `rgba(44,47,60,0.35–0.55)` (only place where higher opacity is allowed)

### 4.2 Lighting rules
- No glossy highlights.
- No heavy drop shadows.
- Any glow must be extremely subtle and usually tied to `--accent`.

---

## 5) Schematic Language (applies to ALL components)
### 5.1 Hairline Rules
- Always 1px.
- Use `--rule-1` for primary dividers, `--rule-2` for secondary.

### 5.2 Corner Brackets (optional but signature)
Use on:
- Primary panes
- Focused modules
- Active selection regions
Do not use on every element (avoid clutter).

### 5.3 Calibration marks / ticks
- Tiny line segments near edges or along rails.
- Opacity O1–O2.
- Used sparingly to imply measurement.

### 5.4 Micro annotations
- Tiny, low-opacity labels for metadata (IDs, modes, counts).
- Always uppercase + tracking.

---

## 6) Component Design Rules (portable patterns)
Each component should declare:
- **Surface type** (Ghost / Primary / Rail / Overlay)
- **Emphasis state** (Idle / Hover / Active / Disabled)
- **Readout style** (Text / Numeric / Icon)

### 6.1 Buttons
#### Primary button (rare)
- Still mostly outlined.
- Accent used as outline + faint inner tint.
- No big filled neon rectangles.

#### Secondary / default button
- Outline: `--rule-1`
- Text: `--text-soft`
- Hover: border increases to O5; text slightly brightens.

#### Icon button
- Square hitbox, minimal outline, optional bracket corners on focus.

### 6.2 Inputs
- Glass surface field with hairline border.
- Placeholder text at `--text-micro`.
- Focus ring uses `--accent` at low opacity (thin).

### 6.3 Toggles / segmented controls
- Selected state uses `--accent` (outline or subtle fill tint).
- Unselected state stays neutral (`--rule-2`).

### 6.4 Tables (native to this style)
- Table header is a **Rail** surface.
- Row separators are hairlines (O2–O3).
- Numeric columns can use mono readouts.
- Hover row: faint fog fill (O1–O2), not a strong highlight.

### 6.5 Tabs
- Use rail line + small indicator tick.
- Selected tab: slightly brighter text + subtle accent underline.

### 6.6 Cards / modules
- Always defined by fill opacity + hairlines.
- Internal spacing is generous; content blocks separated by rules.

### 6.7 Badges / chips
- Outline only, tiny uppercase label, wide tracking.
- Accent badge is allowed but only for “state”.

### 6.8 Alerts
- Still quiet. Use accent variations sparingly:
  - Info: `--accent`
  - Warning/error should be muted versions (do not introduce saturated red unless necessary)
- Prefer icon + label + hairline box, not loud banners.

### 6.9 Sense Weather widget (default gradient)
- `--sense-grad-top`: `rgba(232, 246, 255, 0.82)` / `#E8F6FF`
- `--sense-grad-mid`: `rgba(118, 166, 212, 0.46)` / `#76A6D4`
- `--sense-grad-bottom`: `rgba(20, 35, 56, 0.66)` / `#142338`
- Gradient stack: `radial-gradient(130% 110% at 50% -12%, var(--sense-grad-top) 0%, var(--sense-grad-mid) 32%, rgba(0, 0, 0, 0) 72%), linear-gradient(180deg, var(--sense-grad-mid) 0%, var(--sense-grad-bottom) 100%)`

---

## 7) State System (interaction language)
### 7.1 Hover
- Increase border opacity to O5.
- Optionally add faint accent glow (very low opacity).
- No scale-up animations.

### 7.2 Active/Selected
- Add bracket corners OR accent outline (choose one; don’t stack).
- Increase text opacity slightly.

### 7.3 Disabled
- Reduce text to `--text-micro`
- Border to `--rule-2`
- Fill to ghost surface

---

## 8) Atmosphere Layer (global, not layout)
These are **environment layers** your framework should be able to render behind any layout.

### 8.1 Background gradient
- `--bg-900` to `--bg-800` with slight center lift.

### 8.2 Haze
- Large radial fog behind primary attention region(s).
- Must remain subtle.

### 8.3 Grain
- Monochrome noise at O0.

### 8.4 Dust
- Sparse points, slow drift if animated.
- Avoid starfield density; keep subdued.

---

## 9) Layout Independence: How to Apply the Style to Any Screen
When generating a new UI layout, do this checklist:
1) Choose surfaces for each region (Primary / Ghost / Rail).
2) Assign typography roles (micro label, title, body, readout).
3) Apply schematic accents (rules, brackets, ticks) sparingly.
4) Ensure accent is used only for state/primary affordance.
5) Keep contrast low; rely on opacity layering.
6) Add atmospheric background layers globally.

---

## 10) “Do / Don’t” for Agent Generation
### Do
- Use translucent panels, hairline rules, wide-tracked micro labels.
- Use calm blue-gray palette with off-white text.
- Use tables, readouts, and measured spacing.
- Use subtle blur and haze for depth.

### Don’t
- Neon cyberpunk palette
- Thick borders
- Heavy shadows
- Dense UI clutter
- Loud gradients or glowing outlines everywhere

---

## 11) Prompts for Agents (modular)
Use these building blocks, mixing as needed:

### 11.1 Global style prefix (always include)
Ghost HUD / schematic glass console UI, fogged translucent panels, hairline rules, corner brackets, micro-label typography with wide tracking, off-white text, blue-gray atmospheric background with haze + film grain + sparse dust, minimal cool-blue accent for selection/state only.

### 11.2 Component-level prompts (examples)
- **Table module:** glass rail header, hairline row separators, mono numeric readouts, subtle hover fog.
- **Control rail:** thin strip with micro labels and small outlined icon buttons.
- **Sidebar:** primary glass surface with section dividers, micro annotations, minimal accent focus.
- **Modal:** primary glass surface + fog scrim, bracket corners on active region.

---

## 12) Acceptance Tests (layout-agnostic)
A design matches this style if:
- It reads as **quiet lab HUD** (not neon sci-fi).
- Any region can be identified by **opacity + hairlines**, not thick borders.
- Micro labels are present and tracked.
- Accent color appears rarely and meaningfully.
- Background has haze + grain/dust so the scene isn’t flat.

---

End of framework style guide.
