# ScriptDeck design language

This is the visual standard for every screen in ScriptDeck. People and review
bots both use it: changes that touch the UI must follow the rules marked
**MUST** and **MUST NOT**. The style tile (Midnight) is the picture of this
document; when they disagree, this document and
[`client/src/app/styles/tokens.css`](client/src/app/styles/tokens.css) win.

**Character:** nocturnal, literary, exact. A dark, quiet room for reading
scripts beside the frames they became. The script and the stills are the
content; the interface stays out of their way.

## 1. Tokens are the only source of values

- Components **MUST** take colors, fonts, type sizes, radii, shadows and
  durations from the custom properties in `tokens.css`.
- New or changed code **MUST NOT** hard-code hex, `rgb()` or font-family
  values. The exceptions are values that only make sense locally (a mask
  gradient's `#000`, an image filter) and the token definitions themselves.
  Some older styles still carry raw values; move them to tokens when you touch
  them.
- A new value **MUST** be added to `tokens.css` with a comment saying what it
  is for, then used by name. Prefer an existing token over a near-duplicate.

## 2. Color

Dark-only (`color-scheme: dark`). Blue is the single hue of the interface.

| Role | Token | Value | Use for |
| --- | --- | --- | --- |
| Background | `--color-bg` | `#0b0d13` | Page ground |
| Surface | `--color-surface` | `#161923` | Cards, panels, controls |
| Popover | `--color-popover` | `#1a1d27` | Menus, tooltips |
| Raised | `--color-surface-raised` | `#262a36` | Hovered or lifted surfaces |
| Text | `--color-text` | `#f3f4f8` | Primary text |
| Text soft | `--color-text-soft` | 80% text | Secondary text |
| Text muted | `--color-text-muted` | 56% text | Captions, meta, labels |
| Text subtle | `--color-text-subtle` | 32% text | Disabled text and placeholders **only** |
| Primary | `--color-primary` | `#35578f` | Fill of the main action (white text) |
| Accent | `--color-accent` | `#5c9dff` | Links, focus rings, active controls |
| Mark | `--color-mark` | `#8bb6ff` | Selection, ticked tags, scene marks, Begin/End |
| Lines | `--color-line`, `-control`, `-strong` | 9% / 13% / 24% white | Dividers, control borders, hover borders |

Status tones come in threes (text, `-soft` fill, `-line` border):
`--color-success`, `--color-warning`, `--color-danger`, `--color-ai`.

Rules:

- Text **MUST** meet WCAG AA: 4.5:1, or 3:1 at 24px and up. Every text token
  above passes on Background and Surface except Text subtle (2.7:1), which
  **MUST NOT** carry information.
- Status color **MUST** be paired with a word or icon; never color alone.
- Primary fill is for one main action per view. Destructive and AI actions
  use the outlined `danger` and `ai` button variants.
- New hues **MUST NOT** be introduced into the chrome. A new role reuses the
  blues above or adds a token in the same family.

## 3. Typography

Four faces, one job each. A face **MUST NOT** be used outside its role, and no
fifth face may be added without updating this document.

| Face | Token | Role |
| --- | --- | --- |
| **Gloock** (display serif) | `--font-display` | Titles only: the wordmark, the home headline, page titles, film titles. One weight: always `font-weight: 400`. |
| **Host Grotesk** (sans) | `--font-text` | The whole interface: navigation, body copy, buttons, fields, tags, filters, notices. Weights 400, 500, 600. |
| **Alegreya / Alegreya SC** (text serif) | `--scene-font`, `--scene-heading-font` | Captured scene text in the Reading and Midnight styles. SC for headings, cues and transitions. |
| **Courier Prime** (typewriter) | `--font-script`, `--font-slate` | The Cream script style, and Slate: small capitals labels, timecodes and counts. |

Why: one display serif and one text serif, separated by job, with a sans for
the interface. Controls never read as part of the screenplay beside them.
Newsreader was retired for this reason; do not reintroduce it.

**Slate** is ScriptDeck's label voice: Courier Prime, weight 700, uppercase,
`letter-spacing: var(--tracking-slate)` (0.14em). Use it for section labels,
navigation links, metadata keys (YEAR, DIRECTOR) and every timecode or count.
The current navigation item ends in a typed cursor (`LIBRARY_`). Slate
**MUST NOT** be used for sentences.

Sizes come from the scale: `--text-2xs` 0.72rem through `--text-xl`
1.75rem. Body copy is `--text-base` with line-height 1.5 to 1.6.

## 4. Scene text styles

Scene text is content, styled by the reader's choice through
`data-scene-text-style` (Midnight is the default, then Reading and Cream). Each
style **MUST** set every `--scene-*` and `--script-*` token so styles never
leak into each other. Components that show screenplay text **MUST** read
those tokens and **MUST NOT** set scene fonts or inks directly.

## 5. Components

- **Buttons** (`shared/ui/Button`): `primary`, `secondary`, `ghost`, `danger`,
  `ai`, `link`; sizes `sm` 28px, `md` 34px, `lg` 42px; radius `--radius-sm`.
  Hover changes fill or border only. Disabled turns neutral grey, never a
  faded version of its color. Use the component; do not restyle a `<button>`.
- **Focus**: every interactive element shows `2px solid var(--color-accent)`
  with a 2px offset on `:focus-visible`. Focus **MUST NOT** be removed without
  an equal replacement.
- **Search tags**: viewfinder corners (four 8px corner brackets in
  `--color-accent-line`, `--color-accent` on hover) around Slate text.
- **Scene tags** (`shared/ui/Badge`, neutral tone): pills on `--color-fill`.
- **Filter chips** (`shared/ui/Chip`): pills in the Accent trio
  (`--color-accent-soft` fill, `--color-accent-line` border).
- **Script viewer marks**: ticked tags, the markers toggle and the scene being
  edited take the Mark trio (`--color-mark`, `-soft`, `-line`).
- **Begin / End**: scene boundaries in the script are brackets in the Mark
  color, labelled in Slate.
- **Icons**: inline stroke SVG, 1.6px stroke, round caps and joins,
  `currentColor`. Icon-only buttons **MUST** have an `aria-label`.

## 6. Shape, depth and motion

- Radii: `--radius-xs` 4px (badges), `--radius-sm` 6px (buttons),
  `--radius-md` 8px (fields), `--radius-lg` 12px (cards), `--radius-pill`.
- Depth comes from surface steps and `--shadow-card`, `--shadow-popover`,
  `--shadow-modal`. No glows. Gradients are for function only: fades at an
  edge, scrims that keep text legible over artwork, and drawn marks (such as
  the search tag's corners). No decorative color gradients.
- Text over artwork uses `--shadow-text`.
- State changes use `--transition-fast` (160ms). Every animation **MUST**
  stop under `prefers-reduced-motion: reduce`.
- Stills keep their own aspect ratio; do not crop a frame to fill a grid.

## 7. Review checklist

A UI change is ready when:

- [ ] The change adds no hard-coded colors or font families outside `tokens.css`.
- [ ] Each face is used only for its role in section 3; nothing new is loaded
      in `client/src/app/styles/index.css`.
- [ ] Text contrast meets AA; Text subtle carries no information.
- [ ] At most one Primary-filled action per view.
- [ ] Interactive elements are real `<button>`/`<a>`/`<input>` with visible
      focus; icon-only controls have labels.
- [ ] Screenplay text reads `--scene-*` tokens, not its own fonts or colors.
- [ ] Motion respects `prefers-reduced-motion`.
- [ ] The page works at phone width (the header stacks below 780px).
