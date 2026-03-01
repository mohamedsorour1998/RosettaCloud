# Hackathon Features Design: Multimodal Screenshot Analysis + Proactive Hints

**Date:** 2026-03-01
**Status:** Approved
**Context:** Amazon Nova Hackathon — Agentic AI + Multimodal categories

---

## Feature 1 — Multimodal Terminal Analysis

### Problem
The lab terminal runs inside a cross-origin iframe (`*.labs.dev.rosettacloud.app`), so the frontend cannot silently capture its content. Students hit cryptic errors and have to describe them in text, which is slow and imprecise.

### Solution
A browser Screen Capture API flow: student clicks one button, selects their tab, and their terminal screenshot is sent to Nova as a vision content block — appearing in chat as a normal user message with image thumbnail.

### Data Flow

```
Student clicks "Analyze Terminal" (lab header button)
  → navigator.mediaDevices.getDisplayMedia({video: true, preferCurrentTab: true})
  → Browser shows tab-picker popup
  → Capture first frame to offscreen <canvas>
  → canvas.toDataURL('image/jpeg', 0.8) → base64 string
  → Stop stream immediately (no lingering share indicator)
  → ChatbotService.sendImageMessage(base64, "Help me with this")
      → Adds user message to chat (image thumbnail + text)
      → POST /chat with { type: 'chat', message: "Help me with this", image: base64 }
  → FastAPI /chat:
      → Detects image field
      → Builds Nova content block: [{ text: message }, { image: { format: 'jpeg', source: { bytes: base64 } } }]
      → Passes as multimodal payload to AgentCore
  → Tutor agent receives multimodal message → analyzes screenshot → responds
```

### Changes Required

**Frontend — `lab.component.html`**
- Add "Analyze Terminal" button to lab header actions (beside Instructions/Refresh/Terminate)
- Icon: `bi-camera` or `bi-eye`

**Frontend — `lab.component.ts`**
- Add `analyzeTerminal()` method using `getDisplayMedia`
- Captures one frame, calls `chatbotService.sendImageMessage()`, opens chat panel

**Frontend — `chatbot.service.ts`**
- Add `sendImageMessage(base64: string, text: string): void`
- Adds user message with `imageData` field to the messages array
- POSTs `{ type: 'chat', message: text, image: base64 }`

**Frontend — `chatbot.component.ts` / `.html`**
- Render image thumbnails in user messages when `message.imageData` is present

**Frontend — `ChatMessage` interface**
- Add optional `imageData?: string` field

**Backend — `app/main.py`**
- `ChatRequest` gains `image: str = ""` optional field
- In `/chat` handler: if `image` is set, build multimodal content for the AgentCore payload

**Backend — `agents/agent.py`**
- In `invoke()`: detect `image` in payload, pass as Nova vision content block alongside the text message

### UX Detail
The chat bubble shows a small image thumbnail (max 200px wide) above or inline with the message text. The student sees their screenshot + "Help me with this" as their own message, then the tutor's analysis below it.

---

## Feature 2 — Proactive Hints (after 2 failed attempts)

### Problem
Students can fail a question multiple times and never ask for help, getting frustrated silently. The tutor agent should proactively offer a contextual hint after the second failure.

### Solution
Frontend tracks `attemptCount` per question. On the 2nd wrong attempt, the chatbot panel opens automatically and a hint request fires — displayed as if the student sent it themselves.

### Data Flow

```
Student submits wrong answer (MCQ or practical check)
  → wrongAttempt = true, attemptCount++
  → If attemptCount === 2:
      → openChatPanel() (if not already open)
      → chatbotService.sendProactiveHint(questionNumber, questionText, questionType)
          → Adds user message: "I'm stuck on Question N — can you give me a hint?"
          → POST /chat with { type: 'hint', message: '...', question_number: N }
  → FastAPI /chat:
      → type: 'hint' treated like 'chat' for routing purposes
      → Agent receives: "Student is stuck on question N after 2 failed attempts.
         Give a targeted hint — no spoilers. Question: <text>"
  → Tutor agent responds with contextual hint
```

### Changes Required

**Frontend — `lab.component.ts`**
- Add `attemptCount: number` to `Question` interface (initialized to `0`)
- Increment `attemptCount` in:
  - MCQ wrong answer path (currently sets `wrongAttempt = true`)
  - Practical check wrong answer path (currently sets `wrongAttempt = true`)
- After increment, check `if (q.attemptCount === 2)` → call `openChatPanel()` + `chatbotService.sendProactiveHint(...)`
- Persist `attemptCount` in `saveQuestionState()` / restore in `loadQuestionState()` (sessionStorage)

**Frontend — `chatbot.service.ts`**
- Add `sendProactiveHint(questionNumber: number, questionText: string, questionType: string): void`
- Adds user message: `"I'm stuck on Question ${questionNumber} — can you give me a hint?"`
- POSTs `{ type: 'hint', message: '...', question_number: questionNumber }`

**Backend — `app/main.py`**
- `type: 'hint'` routes normally (no special handling needed — the message already contains context)

**Backend — `agents/agent.py`**
- In `_classify()`: add `'hint'` type shortcut → always routes to `tutor`

### UX Detail
The chat panel slides open (if closed). A message appears as the student's own bubble: *"I'm stuck on Question 3 — can you give me a hint?"* The tutor responds immediately with a targeted hint. This feels natural — like the student asked themselves.

---

## Implementation Order

1. Backend: `ChatRequest.image` field + multimodal content block in `/chat`
2. Backend: `agents/agent.py` — multimodal payload + `hint` type routing
3. Frontend: `ChatMessage.imageData` + chat bubble image rendering
4. Frontend: `chatbot.service.ts` — `sendImageMessage()` + `sendProactiveHint()`
5. Frontend: `lab.component.ts` — `analyzeTerminal()` + `attemptCount` tracking
6. Frontend: `lab.component.html` — "Analyze Terminal" button

## Non-Goals
- Storing screenshots (base64 only lives in the HTTP request)
- Continuous screen monitoring
- Hint after 1st attempt (too aggressive)
- Video analysis (single frame is sufficient)
