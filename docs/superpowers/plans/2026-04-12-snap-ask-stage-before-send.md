# Snap & Ask — Stage Before Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user captures a screenshot via Snap & Ask, stage the image and pre-fill the input textarea with default text instead of sending immediately, so the user can edit and press Send when ready.

**Architecture:** `ChatbotService` gains a `Subject` that emits a staged-image event; `ChatbotComponent` subscribes, stores `pendingImageData`, pre-fills the textarea, shows a dismissible preview card above the input, and routes the pending image through `sendMessage()`. `lab.component.ts` is changed to call `stagePendingImage()` instead of `sendImageMessage()`.

**Tech Stack:** Angular 19, TypeScript, RxJS `Subject`, `Subscription[]` teardown pattern (matches existing code), SCSS BEM-ish classes.

---

## File Map

| File | Change |
|---|---|
| `Frontend/src/app/services/chatbot.service.ts` | Add `Subject` import, `pendingImageStagedSubject`, `pendingImageStaged$`, `stagePendingImage()` |
| `Frontend/src/app/chatbot/chatbot.component.ts` | Add `pendingImageData`, subscribe to `pendingImageStaged$`, modify `sendMessage()`, add `clearPendingImage()` |
| `Frontend/src/app/chatbot/chatbot.component.html` | Add `.pending-image-card` block immediately before `<!-- Input Area -->` |
| `Frontend/src/app/chatbot/chatbot.component.scss` | Append `.pending-image-card` rules before the print `@media` block |
| `Frontend/src/app/lab/lab.component.ts` | Swap `sendImageMessage(base64, '...')` → `stagePendingImage(base64)` on line 1401 |

---

## Task 1 — Add `stagePendingImage()` to `ChatbotService`

**Files:**
- Modify: `Frontend/src/app/services/chatbot.service.ts`

- [ ] **Step 1 — Add `Subject` to the rxjs import on line 3**

  Find:
  ```typescript
  import { BehaviorSubject, Observable, of, throwError, timer } from 'rxjs';
  ```

  Replace with:
  ```typescript
  import { BehaviorSubject, Observable, of, Subject, throwError, timer } from 'rxjs';
  ```

- [ ] **Step 2 — Add the subject and observable after `sources$` (around line 48)**

  Find:
  ```typescript
    public connected$ = of(true);
    public sources$ = of<Source[]>([]);
  ```

  Replace with:
  ```typescript
    public connected$ = of(true);
    public sources$ = of<Source[]>([]);

    // ── Snap & Ask staging ──────────────────────────────────────────────────
    private pendingImageStagedSubject = new Subject<{ base64: string; defaultText: string }>();
    /** Emits once each time a screenshot is staged (Snap & Ask capture). */
    public pendingImageStaged$ = this.pendingImageStagedSubject.asObservable();
  ```

- [ ] **Step 3 — Add `stagePendingImage()` method**

  Find the `sendImageMessage` method signature (line ~111):
  ```typescript
    public sendImageMessage(base64: string, text: string = 'Help me understand what I see in my terminal'): void {
  ```

  Insert the following NEW method immediately BEFORE `sendImageMessage`:
  ```typescript
    /**
     * Stages a screenshot for the user to review/edit before sending.
     * Called by lab.component.ts after capture; does NOT send to backend.
     */
    public stagePendingImage(
      base64: string,
      defaultText = 'I need help with this. What am I doing wrong?'
    ): void {
      this.pendingImageStagedSubject.next({ base64, defaultText });
    }

  ```

- [ ] **Step 4 — Verify build**

  ```bash
  cd /home/sorour/RosettaCloud/Frontend
  node_modules/.bin/ng build --configuration=development 2>&1 | grep -E "error TS|ERROR"
  ```

  Expected: no output (zero errors).

---

## Task 2 — Wire `ChatbotComponent` to the staged-image event

**Files:**
- Modify: `Frontend/src/app/chatbot/chatbot.component.ts`

- [ ] **Step 1 — Add `pendingImageData` property after `showClearConfirmation` (around line 39)**

  Find:
  ```typescript
    showClearConfirmation = false;
  ```

  Replace with:
  ```typescript
    showClearConfirmation = false;
    /** Base64 JPEG staged by Snap & Ask, cleared after send or dismiss. */
    pendingImageData: string | null = null;
  ```

- [ ] **Step 2 — Subscribe to `pendingImageStaged$` inside `ngOnInit`**

  Find the last `this.subscriptions.push(` block inside `ngOnInit` — it ends with:
  ```typescript
      this.chatbotService.connected$.subscribe((isConnected) => {
        this.isConnected = isConnected;
      })
    );
  }
  ```

  Replace that closing `);` + `}` pair with:
  ```typescript
      this.chatbotService.connected$.subscribe((isConnected) => {
        this.isConnected = isConnected;
      })
    );

    this.subscriptions.push(
      this.chatbotService.pendingImageStaged$.subscribe(({ base64, defaultText }) => {
        this.pendingImageData = base64;
        this.currentMessage = defaultText;
        // Let Angular update the DOM, then select all text so typing replaces the default.
        setTimeout(() => {
          if (this.messageInput?.nativeElement) {
            this.messageInput.nativeElement.focus();
            this.messageInput.nativeElement.select();
            this.adjustTextareaHeight();
          }
        });
      })
    );
  }
  ```

- [ ] **Step 3 — Add `clearPendingImage()` method after `sendSuggestion()`**

  Find:
  ```typescript
    sendSuggestion(suggestion: string): void {
      // Set the message as the current message
      this.currentMessage = suggestion;

      // Then send it immediately
      this.sendMessage();
    }
  ```

  Insert immediately AFTER it:
  ```typescript

    /** Dismisses the staged screenshot without clearing the typed text. */
    clearPendingImage(): void {
      this.pendingImageData = null;
    }
  ```

- [ ] **Step 4 — Modify `sendMessage()` to route through `sendImageMessage` when image is pending**

  Find the entire `sendMessage()` method body:
  ```typescript
    sendMessage(): void {
      const message = this.currentMessage.trim();
      if (!message) return;
      this.shouldAutoScroll = true;

      this.chatbotService.sendMessage(message);
      this.currentMessage = '';

      // Focus the input and adjust height
      if (this.messageInput?.nativeElement) {
        this.messageInput.nativeElement.focus();
        this.adjustTextareaHeight();
      }
    }
  ```

  Replace with:
  ```typescript
    sendMessage(): void {
      const message = this.currentMessage.trim();
      if (!message) return;
      this.shouldAutoScroll = true;

      if (this.pendingImageData) {
        this.chatbotService.sendImageMessage(this.pendingImageData, message);
        this.pendingImageData = null;
      } else {
        this.chatbotService.sendMessage(message);
      }
      this.currentMessage = '';

      // Focus the input and adjust height
      if (this.messageInput?.nativeElement) {
        this.messageInput.nativeElement.focus();
        this.adjustTextareaHeight();
      }
    }
  ```

- [ ] **Step 5 — Verify build**

  ```bash
  cd /home/sorour/RosettaCloud/Frontend
  node_modules/.bin/ng build --configuration=development 2>&1 | grep -E "error TS|ERROR"
  ```

  Expected: no output.

---

## Task 3 — Add preview card to `chatbot.component.html`

**Files:**
- Modify: `Frontend/src/app/chatbot/chatbot.component.html`

- [ ] **Step 1 — Insert preview card before the `<!-- Input Area -->` comment (line ~236)**

  Find:
  ```html
      <!-- Input Area -->
      <div class="input-area">
  ```

  Replace with:
  ```html
      <!-- Staged screenshot preview — shown when Snap & Ask has captured but not yet sent -->
      <div *ngIf="pendingImageData" class="pending-image-card">
        <img [src]="pendingImageData" alt="Staged screenshot" class="pending-thumb" />
        <div class="pending-info">
          <span class="pending-label">Screenshot attached</span>
          <span class="pending-type">terminal capture · jpeg</span>
        </div>
        <button class="pending-remove-btn"
                (click)="clearPendingImage()"
                title="Remove screenshot">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>

      <!-- Input Area -->
      <div class="input-area">
  ```

- [ ] **Step 2 — Verify build**

  ```bash
  cd /home/sorour/RosettaCloud/Frontend
  node_modules/.bin/ng build --configuration=development 2>&1 | grep -E "error TS|ERROR"
  ```

  Expected: no output.

---

## Task 4 — Style the preview card in `chatbot.component.scss`

**Files:**
- Modify: `Frontend/src/app/chatbot/chatbot.component.scss`

- [ ] **Step 1 — Append rules before the print `@media` block**

  Find the line that begins the print media query near the bottom of the file:
  ```scss
  // Print styles
  @media print {
  ```

  Insert the following block immediately BEFORE it:
  ```scss
  // ── Snap & Ask staged-image preview card ─────────────────────────────────
  .pending-image-card {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    background: rgba(var(--bs-primary-rgb), 0.08);
    border-top: 1px solid rgba(var(--bs-primary-rgb), 0.2);

    .pending-thumb {
      width: 4.5rem;
      height: 2.875rem;
      object-fit: cover;
      border-radius: 0.3rem;
      border: 1px solid rgba(var(--bs-primary-rgb), 0.25);
      flex-shrink: 0;
    }

    .pending-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      overflow: hidden;
    }

    .pending-label {
      font-size: 0.75rem;
      color: var(--primary-color);
      font-weight: 500;
    }

    .pending-type {
      font-size: 0.65rem;
      color: var(--text-secondary, #8888aa);
    }

    .pending-remove-btn {
      background: none;
      border: none;
      color: var(--text-secondary, #8888aa);
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 0.25rem;
      line-height: 1;
      transition: color 0.15s;
      flex-shrink: 0;

      &:hover {
        color: #ff6b6b;
      }
    }
  }

  ```

- [ ] **Step 2 — Verify build**

  ```bash
  cd /home/sorour/RosettaCloud/Frontend
  node_modules/.bin/ng build --configuration=development 2>&1 | grep -E "error TS|ERROR"
  ```

  Expected: no output.

---

## Task 5 — Update `lab.component.ts` + final build + commit

**Files:**
- Modify: `Frontend/src/app/lab/lab.component.ts`

- [ ] **Step 1 — Swap the `sendImageMessage` call on line 1401**

  Find (inside `analyzeTerminal()`):
  ```typescript
        this.chatbotSv.sendImageMessage(base64, 'I need help with this. What am I doing wrong?');
  ```

  Replace with:
  ```typescript
        this.chatbotSv.stagePendingImage(base64);
  ```

- [ ] **Step 2 — Run production build to confirm zero errors and no budget regressions**

  ```bash
  cd /home/sorour/RosettaCloud/Frontend
  node_modules/.bin/ng build --configuration=production 2>&1 | grep -E "error TS|ERROR|✘"
  ```

  Expected: no `error TS` or `ERROR` lines (pre-existing SCSS budget warning is acceptable).

- [ ] **Step 3 — Manual smoke-test checklist (browser)**

  Start dev server:
  ```bash
  cd /home/sorour/RosettaCloud/Frontend
  node_modules/.bin/ng serve --configuration=development
  ```

  Verify in browser at http://localhost:4200:
  1. Click **Snap & Ask** → select a screen → preview card appears above input with thumbnail
  2. Textarea is pre-filled with `"I need help with this. What am I doing wrong?"` and text is selected
  3. Edit the text → press **Enter** → message sends with image thumbnail in chat bubble, preview card disappears
  4. Snap again → click ✕ on preview card → card disappears, textarea text unchanged
  5. Snap twice quickly → second screenshot replaces first in the preview card
  6. Keep default text → click **Send** button → same result as Enter

- [ ] **Step 4 — Commit**

  ```bash
  cd /home/sorour/RosettaCloud
  git add Frontend/src/app/services/chatbot.service.ts \
          Frontend/src/app/chatbot/chatbot.component.ts \
          Frontend/src/app/chatbot/chatbot.component.html \
          Frontend/src/app/chatbot/chatbot.component.scss \
          Frontend/src/app/lab/lab.component.ts
  git commit -m "$(cat <<'EOF'
  feat(chatbot): stage Snap & Ask screenshot before sending

  Instead of firing the HTTP POST immediately on capture, the screenshot
  is now staged in a dismissible preview card above the input box and the
  default clarifying text is pre-filled in the textarea (selected, so
  typing replaces it). The user can edit the text then press Enter/Send.

  - ChatbotService.stagePendingImage() emits a pendingImageStaged$ event
  - ChatbotComponent subscribes, sets pendingImageData + pre-fills textarea
  - sendMessage() routes through sendImageMessage() when image is pending
  - clearPendingImage() dismisses the card without clearing typed text
  - New snap while one is pending replaces it silently
  - lab.component.ts: sendImageMessage() → stagePendingImage()

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Self-Review

**Spec coverage:**
- [x] Screenshot staged instead of sent immediately — Task 5 (lab swap) + Tasks 1–2 (service + component)
- [x] Default text pre-fills textarea — Task 2, Step 2 (`currentMessage = defaultText`)
- [x] Text selected so typing replaces it — Task 2, Step 2 (`nativeElement.select()`)
- [x] User can edit + Send → fires with image — Task 2, Step 4 (`sendMessage()` modified)
- [x] ✕ button clears image only — Task 3 template + Task 2, Step 3 (`clearPendingImage()`)
- [x] New snap replaces pending — natural: `pendingImageData` is simply overwritten by next emission
- [x] Full-width preview card with thumbnail — Tasks 3 + 4

**Placeholder scan:** No TBDs, all code blocks present. ✓

**Type consistency:**
- `pendingImageData: string | null` defined in Task 2 Step 1, used in Steps 3–4. ✓
- `stagePendingImage()` defined in Task 1 Step 3, called in Task 5 Step 1. ✓
- `clearPendingImage()` defined in Task 2 Step 3, bound in Task 3 Step 1. ✓
- `pendingImageStaged$` defined in Task 1 Step 2, subscribed in Task 2 Step 2. ✓
- `sendImageMessage()` unchanged signature — called by `sendMessage()` with `(this.pendingImageData, message)`. ✓
