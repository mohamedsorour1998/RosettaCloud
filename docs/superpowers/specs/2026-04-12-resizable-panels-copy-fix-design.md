# Design: Resizable Lab Panels + Chatbot Copy Fix

**Date:** 2026-04-12  
**Status:** Approved

---

## 1. Problem

### 1a. Fixed-width panels
`lab.component` has a 3-column flex layout with hard-coded widths:
- Left (Questions sidebar): `300px` fixed
- Center (iframe): `flex: 1`
- Right (AI chat): `350px` fixed

Users cannot resize either side panel. When working in the terminal they can't reclaim the space taken by the panels, and when reading AI responses they can't widen the chat.

### 1b. Copy button produces markdown-polluted text
`copyMessage()` strips triple-backtick fences and inline backticks but leaves `**bold**`, `## headers`, `_italic_`, `~~strikethrough~~` etc. Pasting produces unreadable markdown syntax.

---

## 2. Solution

### 2a. Resizable panels

**Collapsed state:** panel hides completely (0 px). Header bar shows a small expand button (`[▶ Questions]` / `[◀ AI Chat]`) when a panel is hidden.

**Components changed:** `lab.component.ts`, `lab.component.html`, `lab.component.scss`

#### State (TypeScript)

```
leftPanelWidth: number   // default 300, localStorage key 'rc_left_panel_w'
rightPanelWidth: number  // default 350, localStorage key 'rc_right_panel_w'
_leftRestoreWidth: number   // saved before collapse
_rightRestoreWidth: number  // saved before collapse

get isLeftVisible()  => leftPanelWidth > 0
get isRightVisible() => rightPanelWidth > 0
```

#### Drag resize

- `startResizeLeft(e: MouseEvent)` / `startResizeRight(e: MouseEvent)`:
  - Bind `mousemove` and `mouseup` to `document` (not the element, avoids cursor escape)
  - On `mousemove`: `newWidth = startWidth + (e.clientX - startX)` for left; `newWidth = startWidth - (e.clientX - startX)` for right
  - Clamp: left `[150, containerWidth * 0.4]`; right `[220, containerWidth * 0.45]`
  - On `mouseup`: save to `localStorage`, unbind listeners
- During drag set `document.body.style.userSelect = 'none'`; restore on mouseup (prevents text selection flash)
- Set `document.body.style.cursor = 'col-resize'` during drag; restore on mouseup (prevents cursor flicker when mouse moves fast)

#### Toggle collapse

```typescript
toggleLeftPanel() {
  if (isLeftVisible) { _leftRestoreWidth = leftPanelWidth; leftPanelWidth = 0; }
  else { leftPanelWidth = _leftRestoreWidth || 300; }
  saveToLocalStorage();
}
// same pattern for right
```

#### Template changes

```html
<!-- Left panel: bind width, hide when 0 -->
<aside class="lab-sidebar"
       [style.width.px]="leftPanelWidth"
       [style.minWidth.px]="leftPanelWidth"
       [style.display]="isLeftVisible ? '' : 'none'"
       ...>

<!-- Left resizer handle — always visible so user can re-open by dragging -->
<div class="panel-resizer panel-resizer--left"
     (mousedown)="startResizeLeft($event)">
  <div class="resizer-line"></div>
</div>

<!-- center: unchanged -->

<!-- Right resizer handle -->
<div class="panel-resizer panel-resizer--right"
     (mousedown)="startResizeRight($event)">
  <div class="resizer-line"></div>
</div>

<!-- Right panel: bind width, keep existing *ngIf for quota -->
<aside *ngIf="!isQuotaExhausted"
       class="chatbot-panel"
       [style.width.px]="rightPanelWidth"
       [style.minWidth.px]="rightPanelWidth"
       [style.display]="isRightVisible ? '' : 'none'"
       ...>
```

Header expand buttons (shown only when panels are hidden):
```html
<!-- in .lab-status area -->
<button *ngIf="!isLeftVisible" class="panel-expand-btn" (click)="toggleLeftPanel()">
  <i class="bi bi-layout-sidebar"></i> Questions
</button>
<button *ngIf="!isRightVisible && !isQuotaExhausted" class="panel-expand-btn panel-expand-btn--right" (click)="toggleRightPanel()">
  AI Chat <i class="bi bi-layout-sidebar-reverse"></i>
</button>
```

Also add double-click on resizer to toggle:
```html
(dblclick)="toggleLeftPanel()"  / (dblclick)="toggleRightPanel()"
```

#### SCSS changes

```scss
// Remove fixed width/min-width from .lab-sidebar and .chatbot-panel
// (JS drives them via [style.width.px])

.panel-resizer {
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  position: relative;
  background: transparent;
  z-index: 5;
  transition: background 0.15s;

  &:hover, &.dragging { background: rgba(var(--bs-primary-rgb), 0.08); }

  .resizer-line {
    position: absolute;
    top: 10%;
    bottom: 10%;
    left: 2px;
    width: 1px;
    background: transparent;
    transition: background 0.15s;
  }

  &:hover .resizer-line, &.dragging .resizer-line {
    background: var(--primary-color);
  }
}

.panel-expand-btn {
  // ghost chip in header
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-size: 0.75rem; padding: 0.2rem 0.6rem;
  border-radius: 999px; border: 1px solid rgba(var(--bs-primary-rgb), 0.3);
  background: rgba(var(--bs-primary-rgb), 0.08); color: var(--primary-color);
  cursor: pointer; white-space: nowrap;
  transition: background 0.2s;
  &:hover { background: rgba(var(--bs-primary-rgb), 0.15); }
  i { font-size: 0.8rem; }
}
```

#### Mobile: no change
Below 768px, panels are already `position: absolute` overlays. Resizer divs are hidden with `display: none` at that breakpoint.

#### Persistence
- Load from `localStorage` in `ngOnInit` before first render
- Save on drag end and on toggle

---

### 2b. Copy fix

`copyMessage(content: string)` gets the raw markdown string. Current strip is incomplete.

**Fix:** chain a full markdown-to-plaintext conversion before `navigator.clipboard.writeText`:

```typescript
const plainText = content
  // fenced code blocks: keep code, strip fences
  .replace(/```[\w]*\n?([\s\S]*?)```/g, '$1')
  // inline code
  .replace(/`([^`]+)`/g, '$1')
  // ATX headers (#, ##, ###…)
  .replace(/^#{1,6}\s+/gm, '')
  // bold+italic ***text*** or ___text___
  .replace(/\*{3}(.+?)\*{3}/g, '$1')
  .replace(/_{3}(.+?)_{3}/g, '$1')
  // bold **text** or __text__
  .replace(/\*{2}(.+?)\*{2}/g, '$1')
  .replace(/_{2}(.+?)_{2}/g, '$1')
  // italic *text* or _text_
  .replace(/\*(.+?)\*/g, '$1')
  .replace(/_(.+?)_/g, '$1')
  // strikethrough ~~text~~
  .replace(/~~(.+?)~~/g, '$1')
  // markdown links [text](url) → text
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  // unordered list markers (- item, * item, + item)
  .replace(/^[\s]*[-*+]\s+/gm, '')
  // ordered list markers (1. item, 2. item)
  .replace(/^[\s]*\d+\.\s+/gm, '')
  // blockquotes
  .replace(/^>\s+/gm, '')
  // horizontal rules
  .replace(/^[-*_]{3,}\s*$/gm, '')
  // trim leading/trailing whitespace on each line
  .replace(/^\s+|\s+$/gm, (m) => m.includes('\n') ? '\n' : '')
  .trim();
```

Also ensure `user-select: text` is not accidentally blocked on `.chat-container` or message bubbles (add `user-select: text` explicitly to `.message-text` to be safe).

---

## 3. Constraints

- Mobile breakpoint (< 768px): resize handles hidden, existing mobile panel behavior unchanged
- `isQuotaExhausted` guard on chatbot panel preserved
- Right panel resizer only rendered when `!isQuotaExhausted`
- No external libraries added
- Existing `transition: all 0.3s ease` removed from `.lab-sidebar` and `.chatbot-panel` width (smooth drag conflicts with CSS transition; keep only for other properties)

---

## 4. Files changed

| File | Change |
|---|---|
| `lab.component.ts` | Panel width state, drag logic, toggle, localStorage |
| `lab.component.html` | Resizer divs, expand buttons, style bindings |
| `lab.component.scss` | `.panel-resizer`, `.panel-expand-btn`, remove fixed widths |
| `chatbot.component.ts` | `copyMessage()` full markdown strip |
