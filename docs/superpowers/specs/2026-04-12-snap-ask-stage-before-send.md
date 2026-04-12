# Design: Snap & Ask — Stage Before Send

**Date:** 2026-04-12
**Status:** Approved

---

## 1. Problem

When a user clicks "Snap & Ask", the screenshot is captured and sent to the backend immediately with a hardcoded clarifying text (`"I need help with this. What am I doing wrong?"`). The user has no chance to edit the message before it is dispatched.

**Goal:** After the screenshot is captured, stage the image and pre-fill the input box with the default text so the user can edit and press Send when ready.

---

## 2. User Flow (New)

1. User clicks **Snap & Ask** → browser screen picker → screenshot captured (existing behavior unchanged).
2. `openChatPanel()` is called (existing behavior unchanged).
3. Instead of calling `sendImageMessage()` immediately, `lab.component.ts` calls `chatbotSv.stagePendingImage(base64)`.
4. `ChatbotService` emits a `pendingImageStaged$` event carrying `{ base64, defaultText }`.
5. `ChatbotComponent` reacts:
   - Stores `pendingImageData = base64`.
   - Sets `currentMessage = defaultText` (`"I need help with this. What am I doing wrong?"`).
   - Selects all text in the `<textarea>` so typing immediately replaces the default.
6. A **full-width preview card** appears above the input area showing a thumbnail of the screenshot, the label "Screenshot attached", and a ✕ remove button.
7. User edits the text (or keeps the default) → presses Enter or clicks Send.
8. `sendMessage()` detects `pendingImageData` → calls `chatbotSv.sendImageMessage(pendingImageData, text)` → clears `pendingImageData`.
9. **✕ button** → clears `pendingImageData` only; typed text is preserved.
10. **New snap while one is pending** → replaces the staged image silently (no warning needed).

---

## 3. Architecture

### 3.1 `ChatbotService` changes

```typescript
// New Subject — emits once per staged screenshot
private pendingImageStagedSubject = new Subject<{ base64: string; defaultText: string }>();
pendingImageStaged$ = this.pendingImageStagedSubject.asObservable();

// New public method — called by lab.component.ts instead of sendImageMessage()
stagePendingImage(
  base64: string,
  defaultText = 'I need help with this. What am I doing wrong?'
): void {
  this.pendingImageStagedSubject.next({ base64, defaultText });
}
```

`sendImageMessage()` is kept as-is — it is now called by `ChatbotComponent.sendMessage()` rather than by `lab.component.ts`.

### 3.2 `ChatbotComponent` changes

**New property:**
```typescript
pendingImageData: string | null = null;
```

**`ngOnInit` subscription:**
```typescript
this.chatbotSv.pendingImageStaged$.pipe(takeUntil(this.destroy$)).subscribe(({ base64, defaultText }) => {
  this.pendingImageData = base64;
  this.currentMessage = defaultText;
  setTimeout(() => {
    this.messageInput.nativeElement.select();
    this.adjustTextareaHeight();
  });
});
```

**Modified `sendMessage()`:**
```typescript
sendMessage(): void {
  const text = this.currentMessage.trim();
  if (!text || this.isLoading) return;

  if (this.pendingImageData) {
    this.chatbotSv.sendImageMessage(this.pendingImageData, text);
    this.pendingImageData = null;
  } else {
    this.chatbotSv.sendMessage(text);
  }

  this.currentMessage = '';
  this.adjustTextareaHeight();
}
```

**New `clearPendingImage()` method:**
```typescript
clearPendingImage(): void {
  this.pendingImageData = null;
}
```

Note: `destroy$` is the existing `Subject<void>` used for `takeUntil` cleanup. If it doesn't exist, add `private destroy$ = new Subject<void>()` + `ngOnDestroy` call.

### 3.3 `ChatbotComponent` template changes

Add the preview card immediately above `.input-area`:

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
```

### 3.4 `ChatbotComponent` SCSS additions

```scss
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

### 3.5 `lab.component.ts` change

In `analyzeTerminal()`, replace:
```typescript
this.chatbotSv.sendImageMessage(base64, 'I need help with this. What am I doing wrong?');
```
with:
```typescript
this.chatbotSv.stagePendingImage(base64);
```

---

## 4. Edge Cases

| Scenario | Behaviour |
|---|---|
| New snap while image is pending | `pendingImageData` is overwritten; preview card shows new screenshot |
| ✕ clicked | `pendingImageData = null`, preview card hidden; `currentMessage` unchanged |
| Send with empty text (user clears textarea) | Send button disabled (`!currentMessage.trim()`) — same guard as today |
| User opens another lab tab | Pending image is lost (in-memory only, acceptable) |
| Quota exhausted (403) | `<aside *ngIf="!isQuotaExhausted">` — chatbot is not mounted, `stagePendingImage()` emits into void; no crash |

---

## 5. Files Changed

| File | Nature of change |
|---|---|
| `Frontend/src/app/services/chatbot.service.ts` | Add `pendingImageStagedSubject`, `pendingImageStaged$`, `stagePendingImage()` |
| `Frontend/src/app/chatbot/chatbot.component.ts` | Add `pendingImageData`, subscribe to `pendingImageStaged$`, modify `sendMessage()`, add `clearPendingImage()` |
| `Frontend/src/app/chatbot/chatbot.component.html` | Add `.pending-image-card` above `.input-area` |
| `Frontend/src/app/chatbot/chatbot.component.scss` | Add `.pending-image-card` rules |
| `Frontend/src/app/lab/lab.component.ts` | Swap `sendImageMessage()` → `stagePendingImage()` in `analyzeTerminal()` |

No new components, no new routes, no backend changes.
