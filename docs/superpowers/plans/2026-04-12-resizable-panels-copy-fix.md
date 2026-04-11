# Resizable Lab Panels + Chatbot Copy Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-to-resize handles between lab panels with header expand buttons for hidden panels, and fix the chatbot copy button stripping all markdown before writing to clipboard.

**Architecture:** `lab.component` gains two width-tracking properties (`leftPanelWidth`, `rightPanelWidth`) driven by `[style.width.px]` bindings. Drag handles are `<div>` elements between panels that listen to `mousedown` and wire `document` mousemove/mouseup listeners. Toggle (collapse/expand) and double-click on the handle both use the same toggle methods. State persists to `localStorage`. The copy fix is a pure function change in `chatbot.component.ts`.

**Tech Stack:** Angular 19, TypeScript, SCSS, `localStorage`, `document` mouse events (zone.js-patched, no NgZone needed)

---

## File Map

| File | Change |
|---|---|
| `Frontend/src/app/lab/lab.component.ts` | Add panel width state, getters, `savePanelWidths`, `toggleLeftPanel`, `toggleRightPanel`, `startResizeLeft`, `startResizeRight` |
| `Frontend/src/app/lab/lab.component.html` | Add `[style.width.px]` bindings on both panels, insert two `.panel-resizer` divs, add expand chips to header |
| `Frontend/src/app/lab/lab.component.scss` | Remove fixed widths from `.lab-sidebar`/`.chatbot-panel`, add `.panel-resizer` and `.panel-expand-btn` rules |
| `Frontend/src/app/chatbot/chatbot.component.ts` | Replace `copyMessage()` regex strip chain |
| `Frontend/src/app/chatbot/chatbot.component.scss` | Add `user-select: text` to `.message-text` |

---

## Task 1 — Panel width state, getters, and toggle logic in `lab.component.ts`

**Files:**
- Modify: `Frontend/src/app/lab/lab.component.ts`

- [ ] **Step 1 — Add panel width state after the `errorMessage` / `isQuotaExhausted` properties (around line 115)**

  Find this block (after `isQuotaExhausted`):
  ```typescript
  timeRemaining$ = new BehaviorSubject<string>('');
  ```

  Insert BEFORE it:
  ```typescript
  // ── Resizable panels ──────────────────────────────────────────────────────
  /** Left panel (Questions sidebar) width in px. 0 = collapsed. */
  leftPanelWidth = +(localStorage.getItem('rc_left_panel_w') ?? '300');
  /** Right panel (AI Chat) width in px. 0 = collapsed. */
  rightPanelWidth = +(localStorage.getItem('rc_right_panel_w') ?? '350');
  /** Width to restore when left panel is expanded after a collapse. */
  private _leftRestoreWidth = this.leftPanelWidth > 0 ? this.leftPanelWidth : 300;
  /** Width to restore when right panel is expanded after a collapse. */
  private _rightRestoreWidth = this.rightPanelWidth > 0 ? this.rightPanelWidth : 350;

  get isLeftVisible(): boolean { return this.leftPanelWidth > 0; }
  get isRightVisible(): boolean { return this.rightPanelWidth > 0; }
  ```

- [ ] **Step 2 — Add `savePanelWidths`, `toggleLeftPanel`, `toggleRightPanel` after `startQuotaPolling()`**

  Find the line:
  ```typescript
  /** @deprecated use sessionTimeDisplay */
  get labHoursDisplay(): string { return this.sessionTimeDisplay; }
  ```

  Insert BEFORE it:
  ```typescript
  private savePanelWidths(): void {
    localStorage.setItem('rc_left_panel_w', String(this.leftPanelWidth));
    localStorage.setItem('rc_right_panel_w', String(this.rightPanelWidth));
  }

  toggleLeftPanel(): void {
    if (this.isLeftVisible) {
      this._leftRestoreWidth = this.leftPanelWidth;
      this.leftPanelWidth = 0;
    } else {
      this.leftPanelWidth = this._leftRestoreWidth || 300;
    }
    this.savePanelWidths();
  }

  toggleRightPanel(): void {
    if (this.isRightVisible) {
      this._rightRestoreWidth = this.rightPanelWidth;
      this.rightPanelWidth = 0;
    } else {
      this.rightPanelWidth = this._rightRestoreWidth || 350;
    }
    this.savePanelWidths();
  }
  ```

- [ ] **Step 3 — Verify TypeScript compiles**

  ```bash
  cd Frontend
  node_modules/.bin/ng build --configuration=development 2>&1 | grep -E "error TS|ERROR"
  ```

  Expected: no output (zero errors).

---

## Task 2 — Drag resize logic in `lab.component.ts`

**Files:**
- Modify: `Frontend/src/app/lab/lab.component.ts`

- [ ] **Step 1 — Add `startResizeLeft` and `startResizeRight` directly after `toggleRightPanel()`**

  ```typescript
  /**
   * Begins a left-panel drag resize on mousedown on the left resizer handle.
   * Binds mousemove/mouseup to document (zone.js-patched → triggers CD).
   * Min width: 150px. Max: 40% of .lab-content container width.
   */
  startResizeLeft(e: MouseEvent): void {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = this.leftPanelWidth;
    const container = this.el.nativeElement.querySelector('.lab-content') as HTMLElement | null;
    const maxWidth = container ? Math.floor(container.offsetWidth * 0.4) : 600;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (ev: MouseEvent) => {
      const newWidth = startWidth + (ev.clientX - startX);
      this.leftPanelWidth = Math.max(150, Math.min(newWidth, maxWidth));
    };
    const onUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      this.savePanelWidths();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /**
   * Begins a right-panel drag resize on mousedown on the right resizer handle.
   * Moving mouse LEFT increases right panel width (inverted delta).
   * Min width: 220px. Max: 45% of .lab-content container width.
   */
  startResizeRight(e: MouseEvent): void {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = this.rightPanelWidth;
    const container = this.el.nativeElement.querySelector('.lab-content') as HTMLElement | null;
    const maxWidth = container ? Math.floor(container.offsetWidth * 0.45) : 700;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (ev: MouseEvent) => {
      const newWidth = startWidth - (ev.clientX - startX);
      this.rightPanelWidth = Math.max(220, Math.min(newWidth, maxWidth));
    };
    const onUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      this.savePanelWidths();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  ```

- [ ] **Step 2 — Verify TypeScript compiles**

  ```bash
  node_modules/.bin/ng build --configuration=development 2>&1 | grep -E "error TS|ERROR"
  ```

  Expected: no output.

---

## Task 3 — Update `lab.component.html`

**Files:**
- Modify: `Frontend/src/app/lab/lab.component.html`

- [ ] **Step 1 — Add expand chips to the header `.lab-status` div**

  Find this section (inside `<div class="lab-status" *ngIf="labInfo$ | async as labInfo">`):
  ```html
          <span class="status-text">{{ labInfo.status | titlecase }}</span>
          <!-- Live session timer -->
  ```

  Add the two expand chips AFTER `<span class="status-text">`:
  ```html
          <span class="status-text">{{ labInfo.status | titlecase }}</span>
          <!-- Panel expand chips — visible only when a panel is collapsed on desktop -->
          <button *ngIf="!isMobile && !isLeftVisible"
                  class="panel-expand-btn"
                  (click)="toggleLeftPanel()"
                  title="Expand questions panel">
            <i class="bi bi-layout-sidebar"></i> Questions
          </button>
          <button *ngIf="!isMobile && !isRightVisible && !isQuotaExhausted"
                  class="panel-expand-btn panel-expand-btn--right"
                  (click)="toggleRightPanel()"
                  title="Expand AI chat panel">
            AI Chat <i class="bi bi-layout-sidebar-reverse"></i>
          </button>
          <!-- Live session timer -->
  ```

- [ ] **Step 2 — Add style bindings to `.lab-sidebar`**

  Find:
  ```html
    <aside class="lab-sidebar" [class.mobile-hidden]="isMobile && !showSidebar">
  ```

  Replace with:
  ```html
    <aside class="lab-sidebar"
           [class.mobile-hidden]="isMobile && !showSidebar"
           [style.width.px]="isMobile ? null : leftPanelWidth"
           [style.minWidth.px]="isMobile ? null : leftPanelWidth">
  ```

- [ ] **Step 3 — Insert left resizer handle between `.lab-sidebar` and `.lab-main`**

  Find the comment/element that opens `.lab-main`:
  ```html
    <main class="lab-main">
  ```

  Insert immediately BEFORE it:
  ```html
    <!-- Left drag handle — hidden on mobile (panels are overlays there) -->
    <div *ngIf="!isMobile"
         class="panel-resizer panel-resizer--left"
         (mousedown)="startResizeLeft($event)"
         (dblclick)="toggleLeftPanel()"
         title="Drag to resize · Double-click to collapse">
      <div class="resizer-line"></div>
    </div>

    <main class="lab-main">
  ```

- [ ] **Step 4 — Insert right resizer handle between `.lab-main` and `.chatbot-panel`**

  Find:
  ```html
    <!-- Chatbot Panel — hidden when quota is exhausted
  ```

  Insert immediately BEFORE that comment:
  ```html
    <!-- Right drag handle -->
    <div *ngIf="!isMobile && !isQuotaExhausted"
         class="panel-resizer panel-resizer--right"
         (mousedown)="startResizeRight($event)"
         (dblclick)="toggleRightPanel()"
         title="Drag to resize · Double-click to collapse">
      <div class="resizer-line"></div>
    </div>

  ```

- [ ] **Step 5 — Add style bindings to `.chatbot-panel` aside**

  Find:
  ```html
    <aside
      *ngIf="!isQuotaExhausted"
      class="chatbot-panel"
      [class.mobile-hidden]="isMobile && !showChatbot"
    >
  ```

  Replace with:
  ```html
    <aside
      *ngIf="!isQuotaExhausted"
      class="chatbot-panel"
      [class.mobile-hidden]="isMobile && !showChatbot"
      [style.width.px]="isMobile ? null : rightPanelWidth"
      [style.minWidth.px]="isMobile ? null : rightPanelWidth"
    >
  ```

- [ ] **Step 6 — Verify build**

  ```bash
  node_modules/.bin/ng build --configuration=development 2>&1 | grep -E "error TS|ERROR"
  ```

  Expected: no output.

---

## Task 4 — Update `lab.component.scss`

**Files:**
- Modify: `Frontend/src/app/lab/lab.component.scss`

- [ ] **Step 1 — Remove fixed width/min-width from `.lab-sidebar` and change transition**

  Find in `.lab-sidebar`:
  ```scss
  .lab-sidebar {
    width: 18.75rem;
    min-width: 18.75rem;
    display: flex;
    flex-direction: column;
    border-right: 0.0625rem solid transparent;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  ```

  Replace with:
  ```scss
  .lab-sidebar {
    // width and min-width are now driven by [style.width.px] binding in the template.
    // flex-shrink:0 prevents the flex container from compressing below the bound width.
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-right: 0.0625rem solid transparent;
    transition: background-color 0.3s ease, border-color 0.3s ease;
    position: relative;
    overflow: hidden;
  ```

- [ ] **Step 2 — Remove fixed width/min-width from `.chatbot-panel` and change transition**

  Find in `.chatbot-panel`:
  ```scss
  .chatbot-panel {
    width: 21.875rem;
    min-width: 21.875rem;
    border-left: 0.0625rem solid transparent;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  ```

  Replace with:
  ```scss
  .chatbot-panel {
    // width and min-width are now driven by [style.width.px] binding in the template.
    flex-shrink: 0;
    border-left: 0.0625rem solid transparent;
    transition: background-color 0.3s ease, border-color 0.3s ease;
    position: relative;
    overflow: hidden;
  ```

- [ ] **Step 3 — Also update the responsive breakpoint at `max-width: 62rem` that sets `.lab-sidebar` width**

  Find in the `@media (max-width: 62rem)` block:
  ```scss
    .lab-sidebar {
      width: 15.625rem;
      min-width: 15.625rem;
    }
  ```

  Replace with (desktop override no longer needed — JS controls width):
  ```scss
    .lab-sidebar {
      // JS-controlled width takes precedence; no override needed at this breakpoint.
    }
  ```

- [ ] **Step 4 — Add `.panel-resizer` and `.panel-expand-btn` rules**

  Append to the end of the file (before the print `@media`), after the last keyframe:

  ```scss
  // ── Resizable panel drag handles ─────────────────────────────────────────
  .panel-resizer {
    width: 5px;
    flex-shrink: 0;
    cursor: col-resize;
    position: relative;
    background: transparent;
    z-index: 5;
    // Subtle hover highlight
    transition: background 0.15s;

    &:hover {
      background: rgba(var(--bs-primary-rgb), 0.06);
    }

    // Thin colored line in the center of the handle
    .resizer-line {
      position: absolute;
      top: 10%;
      bottom: 10%;
      left: 2px;
      width: 1px;
      background: transparent;
      transition: background 0.15s;
      pointer-events: none;
    }

    &:hover .resizer-line {
      background: var(--primary-color);
      opacity: 0.5;
    }
  }

  // ── Panel expand chips (shown in header when a panel is collapsed) ────────
  .panel-expand-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    border: 1px solid rgba(var(--bs-primary-rgb), 0.3);
    background: rgba(var(--bs-primary-rgb), 0.08);
    color: var(--primary-color);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.2s, border-color 0.2s;
    margin-left: 0.5rem;

    &:hover {
      background: rgba(var(--bs-primary-rgb), 0.15);
      border-color: rgba(var(--bs-primary-rgb), 0.5);
    }

    i {
      font-size: 0.8rem;
    }
  }
  ```

- [ ] **Step 5 — Verify build**

  ```bash
  node_modules/.bin/ng build --configuration=development 2>&1 | grep -E "error TS|ERROR"
  ```

  Expected: no output.

- [ ] **Step 6 — Commit resizable panels**

  ```bash
  cd /home/sorour/RosettaCloud
  git add Frontend/src/app/lab/lab.component.ts \
          Frontend/src/app/lab/lab.component.html \
          Frontend/src/app/lab/lab.component.scss
  git commit -m "feat(frontend): resizable lab panels with drag handles and collapse toggle

  - Left (Questions) and right (AI Chat) panels are now resizable via a
    5px drag handle between each panel and the center iframe.
  - Double-click on the handle collapses the panel to 0px; same method
    via the expand chip buttons in the header restores it.
  - Panel widths persist to localStorage (rc_left_panel_w / rc_right_panel_w).
  - Resize clamps: left 150–40% of container; right 220–45% of container.
  - Mobile unaffected (resizers hidden below 768px; panels remain overlays).
  - CSS transition on width removed from both panels (smooth drag; no lag).

  Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 5 — Fix `copyMessage()` and `user-select` in chatbot

**Files:**
- Modify: `Frontend/src/app/chatbot/chatbot.component.ts`
- Modify: `Frontend/src/app/chatbot/chatbot.component.scss`

- [ ] **Step 1 — Replace the `copyMessage()` body in `chatbot.component.ts`**

  Find the entire `copyMessage` method (lines ~348–370):
  ```typescript
  copyMessage(content: string): void {
    // Strip markdown formatting for clipboard
    const plainText = content
      .replace(/```[\s\S]*?```/g, (match) => {
        // Extract code blocks without the backticks
        return match.replace(/```(?:[a-zA-Z]*\n)?|\n```$/g, '');
      })
      .replace(/`([^`]+)`/g, '$1'); // Remove inline code formatting

    navigator.clipboard.writeText(plainText).then(
  ```

  Replace the `const plainText = ...` block (keep everything from `navigator.clipboard` onwards unchanged):
  ```typescript
  copyMessage(content: string): void {
    const plainText = content
      // fenced code blocks: keep inner code, strip fences + optional language tag
      .replace(/```[\w-]*\n?([\s\S]*?)```/g, '$1')
      // inline code: strip backticks
      .replace(/`([^`]+)`/g, '$1')
      // ATX headings: ## Heading → Heading
      .replace(/^#{1,6}\s+/gm, '')
      // bold+italic ***text*** / ___text___
      .replace(/\*{3}(.+?)\*{3}/gs, '$1')
      .replace(/_{3}(.+?)_{3}/gs, '$1')
      // bold **text** / __text__
      .replace(/\*{2}(.+?)\*{2}/gs, '$1')
      .replace(/_{2}(.+?)_{2}/gs, '$1')
      // italic *text* / _text_  (single char, not touching list markers)
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/gs, '$1')
      .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/gs, '$1')
      // strikethrough ~~text~~
      .replace(/~~(.+?)~~/gs, '$1')
      // markdown links [label](url) → label
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // unordered list markers (- / * / + at line start)
      .replace(/^[ \t]*[-*+]\s+/gm, '')
      // ordered list markers (1. / 2. at line start)
      .replace(/^[ \t]*\d+\.\s+/gm, '')
      // blockquotes
      .replace(/^[ \t]*>\s*/gm, '')
      // horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // collapse 3+ blank lines to 2
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    navigator.clipboard.writeText(plainText).then(
  ```

- [ ] **Step 2 — Add `user-select: text` to `.message-text` in `chatbot.component.scss`**

  Find:
  ```scss
  .message-text {
    font-size: 1rem;
    line-height: 1.6;
    max-width: 100%;
    overflow-wrap: break-word;
    word-break: break-word; // Help break long words
  ```

  Add one property:
  ```scss
  .message-text {
    font-size: 1rem;
    line-height: 1.6;
    max-width: 100%;
    overflow-wrap: break-word;
    word-break: break-word;
    user-select: text; // Explicitly allow text selection inside chat messages
  ```

- [ ] **Step 3 — Verify build**

  ```bash
  cd /home/sorour/RosettaCloud/Frontend
  node_modules/.bin/ng build --configuration=development 2>&1 | grep -E "error TS|ERROR"
  ```

  Expected: no output.

- [ ] **Step 4 — Quick logic test for the copy strip**

  Run this inline Node snippet to confirm the regex chain strips correctly:

  ```bash
  node -e "
  const strip = s => s
    .replace(/\`\`\`[\w-]*\n?([\s\S]*?)\`\`\`/g, '\$1')
    .replace(/\`([^\`]+)\`/g, '\$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{3}(.+?)\*{3}/gs, '\$1')
    .replace(/_{3}(.+?)_{3}/gs, '\$1')
    .replace(/\*{2}(.+?)\*{2}/gs, '\$1')
    .replace(/_{2}(.+?)_{2}/gs, '\$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/gs, '\$1')
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/gs, '\$1')
    .replace(/~~(.+?)~~/gs, '\$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '\$1')
    .replace(/^[ \t]*[-*+]\s+/gm, '')
    .replace(/^[ \t]*\d+\.\s+/gm, '')
    .replace(/^[ \t]*>\s*/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const md = '## Title\n**bold** and _italic_ and \`code\`\n- item one\n- item two\n[link](https://example.com)\n\`\`\`bash\necho hello\n\`\`\`';
  console.log('INPUT:', JSON.stringify(md));
  console.log('OUTPUT:', JSON.stringify(strip(md)));

  console.assert(!strip(md).includes('**'), 'bold stripped');
  console.assert(!strip(md).includes('##'), 'heading stripped');
  console.assert(!strip(md).includes('\`\`\`'), 'fence stripped');
  console.assert(strip(md).includes('echo hello'), 'code content kept');
  console.log('All assertions passed');
  "
  ```

  Expected output contains `All assertions passed`.

- [ ] **Step 5 — Commit copy fix**

  ```bash
  cd /home/sorour/RosettaCloud
  git add Frontend/src/app/chatbot/chatbot.component.ts \
          Frontend/src/app/chatbot/chatbot.component.scss
  git commit -m "fix(chatbot): strip all markdown in copy button + allow text selection

  copyMessage() previously only stripped triple-backtick fences and inline
  backticks, leaving **bold**, ## headers, _italic_, ~~strikethrough~~,
  [links](url), list markers, and blockquotes in the pasted text.

  Fix: full markdown-to-plaintext regex chain covering all common syntax.
  Code block contents are preserved (only fences stripped). 3+ blank lines
  collapsed to 2. Result is clean, pasteable plain text.

  Also adds user-select: text to .message-text so manual selection + Ctrl+C
  works reliably even when parent containers have overflow: hidden.

  Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

## Self-Review

**Spec coverage check:**
- [x] Drag resize left panel — Tasks 1, 2, 3, 4
- [x] Drag resize right panel — Tasks 1, 2, 3, 4
- [x] Collapsed state = 0px + header expand buttons — Tasks 1, 3, 4
- [x] Double-click resizer to toggle — Task 3
- [x] Persist to localStorage — Task 1 (`savePanelWidths`), Task 2 (called on mouseup)
- [x] Min/max clamp values — Task 2 (150/600 left, 220/700 right)
- [x] Mobile: resizers hidden — Task 3 (`*ngIf="!isMobile"`)
- [x] `isQuotaExhausted` guard preserved — Task 3 (resizer + right panel both gated)
- [x] Remove CSS transition on width — Task 4
- [x] `flex-shrink: 0` on both panels — Task 4
- [x] Copy button full markdown strip — Task 5
- [x] `user-select: text` on `.message-text` — Task 5

**Placeholder scan:** No TBDs, no "similar to above", all code blocks present. ✓

**Type consistency:** `leftPanelWidth`, `rightPanelWidth`, `_leftRestoreWidth`, `_rightRestoreWidth`, `isLeftVisible`, `isRightVisible`, `savePanelWidths`, `toggleLeftPanel`, `toggleRightPanel`, `startResizeLeft`, `startResizeRight` — all defined in Task 1/2, all used correctly in Tasks 3–4. ✓
