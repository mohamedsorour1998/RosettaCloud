import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BehaviorSubject,
  Observable,
  Subscription,
  interval,
  of,
  forkJoin,
  Subject,
  fromEvent,
} from 'rxjs';
import {
  catchError,
  delay,
  filter,
  map,
  retryWhen,
  switchMap,
  take,
  tap,
  debounceTime,
  distinctUntilChanged,
  takeUntil,
} from 'rxjs/operators';
import { LabService } from '../services/lab.service';
import { UserService } from '../services/user.service';
import { ChatbotService, AiQuota } from '../services/chatbot.service';
import { FeedbackComponent } from '../feedback/feedback.component';
import { ChatbotComponent } from '../chatbot/chatbot.component';
import { ThemeService } from '../services/theme.service';

/**
 * Question interface defines the structure of lab questions
 */
interface Question {
  id: number;
  question: string;
  type: 'mcq' | 'check';
  options?: string[];
  correctAnswer?: string;
  completed: boolean;
  visited: boolean;
  disabledOptions: number[];
  wrongAttempt: boolean;
  attemptCount: number;
}

/**
 * Lab information interface
 */
interface LabInfo {
  lab_id: string;
  pod_ip: string | null;
  hostname: string | null;
  url: string | null;
  time_remaining: { hours: number; minutes: number; seconds: number } | null;
  status: string;
  pod_name: string | null;
}

@Component({
  selector: 'app-lab',
  standalone: true,
  imports: [CommonModule, FormsModule, FeedbackComponent, ChatbotComponent],
  templateUrl: './lab.component.html',
  styleUrls: ['./lab.component.scss'],
})
export class LabComponent implements OnInit, OnDestroy, AfterViewInit {
  // Lab related properties
  labId: string | null = null;
  labInfo$ = new BehaviorSubject<LabInfo | null>(null);
  codeServerUrl: SafeResourceUrl | null = null;
  private iframeUrl$ = new Subject<string>();
  private lastIframeUrl: string | null = null;

  // Questions related properties
  questions: Question[] = [];
  currentQuestionIndex = 0;
  get currentQuestion(): Question | null {
    return this.questions[this.currentQuestionIndex] || null;
  }
  selectedOption: number | null = null;
  showFeedback = false;
  feedbackMessage = '';
  isAnswerCorrect = false;
  checkInProgress = false;

  // Status related properties
  hadSuccessfulConnection = false;
  lostConnectionCount = 0;
  isLoading = true;
  isInitializing = true;
  isLabActive = false;
  isApiConnected = true;
  errorMessage: string | null = null;
  /**
   * Set to true when lab creation is rejected with HTTP 403 (weekly quota
   * exhausted). Triggers a dedicated UI state: hides the AI chat panel (which
   * has no lab context and would confuse the user) and shows a quota-specific
   * message instead of the generic "Oops! Something went wrong" + retry button.
   * Reset to false when the user navigates away or explicitly re-initialises.
   */
  isQuotaExhausted = false;

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

  timeRemaining$ = new BehaviorSubject<string>('');

  // UI related properties
  showInstructions = false;
  isMobile = false;
  showSidebar = false;
  showChatbot = false;

  // Onboarding
  showOnboarding = false;
  onboardingStep = 0;
  readonly onboardingSteps = [
    {
      title: 'Your dedicated K8s cluster is starting',
      body: 'RosettaCloud is provisioning a fresh Kubernetes cluster just for you. This takes about 10 seconds. You\'ll have full kubectl, docker, and helm access.',
      icon: 'bi-diagram-3-fill',
    },
    {
      title: 'VS Code is your workspace',
      body: 'The panel on the right is a full VS Code IDE. Open a terminal with Ctrl+` and start running real commands.',
      icon: 'bi-code-square',
    },
    {
      title: 'Ask the AI tutor anytime',
      body: 'The chatbot guides you through hints — it won\'t give you the answer, but it will help you think. Try: "I\'m stuck on question 1, give me a hint."',
      icon: 'bi-robot',
    },
    {
      title: 'Snap & Ask — screenshot your terminal',
      body: 'Use the camera icon in the chatbot to screenshot your terminal. The AI will analyse exactly what you see and explain what went wrong.',
      icon: 'bi-camera-fill',
    },
  ];

  // NPS feedback
  showNps = false;
  npsRating = 0;
  npsFeedback = '';
  npsSubmitted = false;

  // Lab hours metering
  labStartTime: number | null = null;
  labSecondsElapsed = 0;
  /** Total seconds the session is budgeted for, captured from the first quota fetch. */
  sessionBudgetSeconds = 0;
  private labTimerInterval: ReturnType<typeof setInterval> | null = null;

  // Weekly quota
  /**
   * Last server-fetched value of remaining weekly lab minutes. This is the
   * BASELINE — the effective live value shown in the UI is derived from this
   * plus the elapsed wall-clock time since the fetch (see quotaDisplay).
   * Without the elapsed-time decrement the chip would freeze at whatever
   * the last poll returned and only tick down once per polling interval.
   */
  weeklyMinutesRemaining: number | null = null;
  /**
   * Epoch ms when weeklyMinutesRemaining was last refreshed from the server.
   * Used by quotaDisplay / quotaMinutesEffective to compute a live countdown
   * between server polls. Re-set every time fetchLabQuota lands a response.
   */
  weeklyMinutesFetchedAt: number = 0;
  weeklyMinutesLimit = 120;
  private quotaInterval: ReturnType<typeof setInterval> | null = null;

  // AI message quota
  aiQuota: AiQuota | null = null;

  // User data properties
  userProgressData: any = {};
  moduleUuid: string | null = null;
  lessonUuid: string | null = null;

  // Subscriptions
  private timerSub?: Subscription;
  private pollSub?: Subscription;
  private apiSub?: Subscription;
  private progressSub?: Subscription;
  private iframeSub?: Subscription;
  private themeSub?: Subscription;
  private aiQuotaSub?: Subscription;

  // Constants
  private readonly qStateKey = 'lab-question-state';
  private readonly pollInterval = 30000; // 30 seconds
  private readonly retryDelay = 5000; // 5 seconds

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private labSv: LabService,
    private userSv: UserService,
    private chatbotSv: ChatbotService,
    private themeService: ThemeService,
    private sanitizer: DomSanitizer,
    private el: ElementRef
  ) {
    // Check if user is on mobile device
    this.checkIsMobile();
  }

  ngOnInit(): void {
    // Initialize iframe subscription with debounce to prevent too many updates
    this.iframeSub = this.iframeUrl$
      .pipe(debounceTime(1000), distinctUntilChanged())
      .subscribe((url) => {
        console.log('Updating iframe URL:', url);
        if (url !== this.lastIframeUrl) {
          this.lastIframeUrl = url;
          this.codeServerUrl =
            this.sanitizer.bypassSecurityTrustResourceUrl(url);
          setTimeout(() => this.adjustIframe(), 1000);
        }
      });

    // Subscribe to API connection status
    if (this.labSv && this.labSv.connectionStatus$) {
      this.apiSub = this.labSv.connectionStatus$.subscribe((ok) => {
        if (ok) {
          this.hadSuccessfulConnection = true;
          this.lostConnectionCount = 0;
        } else if (this.hadSuccessfulConnection) {
          this.lostConnectionCount++;
        }
        this.isApiConnected = ok;
      });
    } else {
      console.error('Lab service or connection status not available');
      this.isApiConnected = false;
    }

    // Get module and lesson UUIDs from route params
    this.moduleUuid = this.route.snapshot.paramMap.get('moduleUuid');
    this.lessonUuid = this.route.snapshot.paramMap.get('lessonUuid');
    if (!this.moduleUuid || !this.lessonUuid) {
      this.errorMessage = 'Module or lesson information is missing';
      this.isLoading = false;
      return;
    }

    // Set user ID and lab context on chatbot service for agent context.
    // IMPORTANT: setUserId must be called synchronously here so that userId
    // is set before sendSessionStart fires (which fires only after async
    // loadQuestions resolves — but this ordering must remain consistent).
    this.chatbotSv.setUserId(this.labSv.getCurrentUserId());
    this.chatbotSv.setLabContext(this.moduleUuid as string, this.lessonUuid as string);

    // Track AI message quota so the lab toolbar chip stays current.
    this.aiQuotaSub = this.chatbotSv.aiQuota$.subscribe(q => { this.aiQuota = q; });

    // Initialize lab environment
    this.initLab();

    // Subscribe to theme changes for iframe adjustments
    this.themeSub = this.themeService.theme$.subscribe(() => {
      setTimeout(() => this.adjustIframe(), 300);
    });
  }

  ngAfterViewInit(): void {
    // Adjust iframe size after view is initialized
    setTimeout(() => this.adjustIframe(), 1000);
  }

  initOnboarding(): void {
    const seen = localStorage.getItem('rc_onboarding_seen');
    if (!seen) {
      this.showOnboarding = true;
      this.onboardingStep = 0;
    }
  }

  nextOnboardingStep(): void {
    if (this.onboardingStep < this.onboardingSteps.length - 1) {
      this.onboardingStep++;
    } else {
      this.dismissOnboarding();
    }
  }

  dismissOnboarding(): void {
    this.showOnboarding = false;
    localStorage.setItem('rc_onboarding_seen', '1');
    // NPS is no longer triggered here — it fires after lab termination so the
    // user has actually used the product before being asked for feedback.
  }

  triggerNps(): void {
    const seen = localStorage.getItem('rc_nps_seen');
    if (!seen) {
      setTimeout(() => { this.showNps = true; }, 2000);
    }
  }

  submitNps(): void {
    const entry = { rating: this.npsRating, feedback: this.npsFeedback, ts: Date.now() };
    const existing: object[] = JSON.parse(localStorage.getItem('rc_nps_data') || '[]');
    existing.push(entry);
    localStorage.setItem('rc_nps_data', JSON.stringify(existing));
    localStorage.setItem('rc_nps_seen', '1');
    this.npsSubmitted = true;
    setTimeout(() => { this.showNps = false; }, 2000);
  }

  startLabTimer(): void {
    this.labStartTime = Date.now();
    this.labSecondsElapsed = 0;
    this.sessionBudgetSeconds = 0; // re-captured on first quota fetch
    this.labTimerInterval = setInterval(() => {
      if (this.labStartTime) {
        this.labSecondsElapsed = Math.floor((Date.now() - this.labStartTime) / 1000);
      }
    }, 1000);
  }

  stopLabTimer(): void {
    if (this.labTimerInterval) {
      clearInterval(this.labTimerInterval);
      this.labTimerInterval = null;
    }
    if (this.quotaInterval) {
      clearInterval(this.quotaInterval);
      this.quotaInterval = null;
    }
  }

  get sessionTimeDisplay(): string {
    const remaining = Math.max(0, this.sessionBudgetSeconds - this.labSecondsElapsed);
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}h ${mm}m ${ss}s left` : `${mm}m ${ss}s left`;
  }

  /**
   * Effective live remaining minutes — the baseline from the last server
   * fetch minus the wall-clock minutes elapsed since that fetch. Clamped
   * to [0, baseline] so it can never go negative or overflow.
   *
   * Read by both the chip text (quotaDisplay) and the "quota-low" CSS
   * class guard in the template, so a user approaching zero sees the
   * colour change in real time without waiting for the next poll.
   *
   * Angular's default change detection re-evaluates getters on every
   * tick — labTimerInterval fires once per second and mutates
   * labSecondsElapsed, which triggers CD and makes this getter recompute.
   * That is what drives the live countdown in the chip.
   */
  get quotaMinutesEffective(): number {
    if (this.weeklyMinutesRemaining === null) return 0;
    if (!this.weeklyMinutesFetchedAt) return this.weeklyMinutesRemaining;
    const elapsedMin = Math.floor(
      (Date.now() - this.weeklyMinutesFetchedAt) / 60000
    );
    return Math.max(0, this.weeklyMinutesRemaining - elapsedMin);
  }

  get quotaDisplay(): string {
    if (this.weeklyMinutesRemaining === null) return '';
    const r = this.quotaMinutesEffective;
    if (r <= 0) return '0m left';
    const h = Math.floor(r / 60);
    const m = r % 60;
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  }

  get isAiQuotaExhausted(): boolean {
    return this.aiQuota !== null && this.aiQuota.messages_remaining <= 0;
  }

  get aiQuotaDisplay(): string {
    if (!this.aiQuota) return '';
    if (this.isAiQuotaExhausted) return '0 AI messages left';
    return `${this.aiQuota.messages_remaining} / ${this.aiQuota.messages_limit} AI messages left`;
  }

  fetchLabQuota(): void {
    const userId = this.labSv.getCurrentUserId();
    this.labSv.getLabQuota(userId).subscribe(q => {
      // The backend returns a value that already includes in-flight minutes
      // (close_lab_session path) — we simply record it as the new baseline
      // and reset the fetch timestamp so the local countdown restarts from
      // the server's authoritative value. This recalibration catches any
      // drift between the client clock and server clock as well as any
      // committed-minutes change from a recently-closed session.
      this.weeklyMinutesRemaining = q.minutes_remaining;
      this.weeklyMinutesFetchedAt = Date.now();
      this.weeklyMinutesLimit = q.minutes_limit;
      // Capture once — first quota response sets the session countdown budget.
      // Cap at POD_TTL_SECS (3600s = 1 hour): each lab runs at most 1 hour
      // regardless of how much weekly quota remains.
      if (!this.sessionBudgetSeconds) {
        this.sessionBudgetSeconds = Math.min(q.minutes_remaining * 60, 3600);
      }
    });
  }

  startQuotaPolling(): void {
    this.fetchLabQuota();
    // Poll every 60 seconds. The UI itself ticks every second from
    // labTimerInterval — so the value the user sees updates in real time
    // from the baseline, and the 60s poll only serves to recalibrate
    // against the authoritative server value (e.g. if another tab closed
    // a session or the user's clock is skewed).
    this.quotaInterval = setInterval(() => this.fetchLabQuota(), 60 * 1000);
  }

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
    const iframe = this.el.nativeElement.querySelector('.code-server-iframe') as HTMLIFrameElement | null;
    const chatPanel = this.el.nativeElement.querySelector('.chatbot-panel') as HTMLElement | null;

    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';
    document.body.style.cursor = 'col-resize';
    if (iframe) iframe.style.pointerEvents = 'none';
    // Explicitly exempt the AI chat panel so text inside it stays selectable
    // even while body has user-select:none during drag.
    if (chatPanel) {
      chatPanel.style.userSelect = 'text';
      (chatPanel.style as any).webkitUserSelect = 'text';
    }

    const onMove = (ev: MouseEvent) => {
      const newWidth = startWidth + (ev.clientX - startX);
      this.leftPanelWidth = Math.max(150, Math.min(newWidth, maxWidth));
    };
    const onUp = () => {
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('-webkit-user-select');
      document.body.style.cursor = '';
      if (iframe) iframe.style.pointerEvents = '';
      if (chatPanel) {
        chatPanel.style.removeProperty('user-select');
        chatPanel.style.removeProperty('-webkit-user-select');
      }
      this.savePanelWidths();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
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
    const iframe = this.el.nativeElement.querySelector('.code-server-iframe') as HTMLIFrameElement | null;
    const chatPanel = this.el.nativeElement.querySelector('.chatbot-panel') as HTMLElement | null;

    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';
    document.body.style.cursor = 'col-resize';
    if (iframe) iframe.style.pointerEvents = 'none';
    if (chatPanel) {
      chatPanel.style.userSelect = 'text';
      (chatPanel.style as any).webkitUserSelect = 'text';
    }

    const onMove = (ev: MouseEvent) => {
      const newWidth = startWidth - (ev.clientX - startX);
      this.rightPanelWidth = Math.max(220, Math.min(newWidth, maxWidth));
    };
    const onUp = () => {
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('-webkit-user-select');
      document.body.style.cursor = '';
      if (iframe) iframe.style.pointerEvents = '';
      if (chatPanel) {
        chatPanel.style.removeProperty('user-select');
        chatPanel.style.removeProperty('-webkit-user-select');
      }
      this.savePanelWidths();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  }

  /** @deprecated use sessionTimeDisplay */
  get labHoursDisplay(): string { return this.sessionTimeDisplay; }
  get labMinutesUsed(): number { return Math.floor(this.labSecondsElapsed / 60); }

  ngOnDestroy(): void {
    // Reset lab context on the chatbot service when navigating away
    this.chatbotSv.setLabContext('', '');

    // Clean up subscriptions to prevent memory leaks
    this.timerSub?.unsubscribe();
    this.pollSub?.unsubscribe();
    this.apiSub?.unsubscribe();
    this.progressSub?.unsubscribe();
    this.iframeSub?.unsubscribe();
    this.themeSub?.unsubscribe();
    this.aiQuotaSub?.unsubscribe();

    // Stop lab hours timer
    this.stopLabTimer();

    // Signal completion to all observables using takeUntil
    this.destroy$.next();
    this.destroy$.complete();

    // Clean up lab resources if component is destroyed through normal navigation
    this.cleanupLabResources();
  }

  // Add this method to handle async cleanup for normal navigation
  private cleanupLabResources(): void {
    if (this.labId && this.isLabActive) {
      // Clear storage
      sessionStorage.removeItem('activeLabId');
      sessionStorage.removeItem(this.qStateKey);

      // Async request for normal navigation scenarios
      this.labSv
        .terminateLab(this.labId, this.labSv.getCurrentUserId())
        .subscribe({
          next: () =>
            console.log('Lab terminated successfully on component destroy'),
          error: (err) =>
            console.error('Error terminating lab on destroy:', err),
        });
    }
  }

  /**
   * Initializes the lab environment
   * Checks for cached lab ID in session storage first
   */
  private initLab(): void {
    const cachedLab = sessionStorage.getItem('activeLabId');
    this.restoreQuestionState();

    if (cachedLab) {
      this.labId = cachedLab;
      this.loadLabInfo(cachedLab);
      return;
    }

    this.labSv
      .getActiveLabForUser()
      .pipe(
        tap((id) => {
          this.labId = id;
          sessionStorage.setItem('activeLabId', id);
          this.loadLabInfo(id);
        }),
        catchError(() => this.launchNewLab())
      )
      .subscribe();
  }

  /**
   * Launches a new lab instance
   */
  private launchNewLab(): Observable<unknown> {
    this.isInitializing = true;
    // Reset isLabActive so the handleLabInfo transition guard fires again
    // for the new pod (required for setupQuestion + sendSessionStart to re-trigger).
    this.isLabActive = false;
    return this.labSv.launchLab(this.labSv.getCurrentUserId()).pipe(
      tap((res) => {
        this.labId = res.lab_id;
        sessionStorage.setItem('activeLabId', res.lab_id);
        this.loadLabInfo(res.lab_id);
      }),
      catchError((err) => {
        const msg: string = err.message || 'Unknown';
        // The backend returns HTTP 403 with detail "Weekly free-tier lab quota
        // exhausted ...". lab.service.ts handleError converts HttpErrorResponse
        // to a plain Error, so we detect via the message string.
        if (
          msg.toLowerCase().includes('quota exhausted') ||
          msg.toLowerCase().includes('weekly free-tier')
        ) {
          this.isQuotaExhausted = true;
          this.errorMessage = msg;
          // Stop quota polling — no active lab, nothing left to measure.
          if (this.quotaInterval) {
            clearInterval(this.quotaInterval);
            this.quotaInterval = null;
          }
        } else {
          this.errorMessage = 'Error creating lab: ' + msg;
        }
        this.isLoading = false;
        return of(null);
      })
    );
  }

  /**
   * Loads lab information and starts polling
   */
  private loadLabInfo(labId: string): void {
    this.startPolling();
    this.loadQuestions();
  }

  /**
   * Starts polling for lab status updates
   */
  private startPolling(): void {
    if (!this.labId) return;
    this.pollSub?.unsubscribe();

    // Set up recurring polling with error handling
    this.pollSub = interval(this.pollInterval)
      .pipe(
        filter(() => this.isApiConnected),
        switchMap(() => this.labSv.getLabInfo(this.labId!)),
        retryWhen((errs) => errs.pipe(delay(this.retryDelay), take(3))),
        tap((info) => this.handleLabInfo(info))
      )
      .subscribe();

    // Initial lab info request
    this.labSv.getLabInfo(this.labId).subscribe(
      (info) => this.handleLabInfo(info),
      (err) => {
        const msg: string = err.message || '';
        if (msg.includes('lab not found') || msg.includes('not found')) {
          // Stale lab ID — clear and create a fresh one
          sessionStorage.removeItem('activeLabId');
          this.labId = null;
          this.launchNewLab().subscribe();
        } else {
          this.errorMessage = 'Error retrieving lab info: ' + msg;
          this.isLoading = false;
        }
      }
    );
  }

  /**
   * Handles lab information update
   */
  private handleLabInfo(info: LabInfo): void {
    if (!info) {
      this.errorMessage = 'Lab not found';
      this.isLoading = false;
      return;
    }

    console.log('Received lab info:', info);

    const currentInfo = this.labInfo$.getValue();
    const wasNotActive = !this.isLabActive;
    const statusChanged = !currentInfo || currentInfo.status !== info.status;
    this.labInfo$.next(info);

    // Handle error or terminated state (including error-404, error-500, etc.)
    if (info.status === 'terminated' || info.status.startsWith('error')) {
      sessionStorage.removeItem('activeLabId');
      this.labId = null;
      this.launchNewLab().subscribe();
      return;
    }

    // Handle running state
    if (info.status === 'running') {
      if (!this.labStartTime) {
        this.initOnboarding();
        this.startLabTimer();
        this.startQuotaPolling();
      }

      // Use url first if available, then pod_ip, then hostname
      let labUrl = info.url;
      if (!labUrl && info.pod_ip) {
        labUrl = info.pod_ip.includes('://')
          ? info.pod_ip
          : `https://${info.pod_ip}/`;
      } else if (!labUrl && info.hostname) {
        labUrl = `https://${info.hostname}/`;
      }

      if (labUrl && (this.lastIframeUrl !== labUrl || statusChanged)) {
        this.iframeUrl$.next(labUrl);
      }

      this.isLabActive = true;
      this.isLoading = false;
      this.isInitializing = false;

      // Set up timer if time remaining is available
      if (info.time_remaining) {
        this.updateTime(info.time_remaining);
        if (!this.timerSub || statusChanged) {
          this.startTimer(info.time_remaining);
        }
      } else {
        this.timeRemaining$.next('Time unknown');
      }

      // Set up first question when lab becomes active
      if (wasNotActive && this.questions.length > 0) {
        console.log('Lab became active, setting up question 1 automatically');
        this.setupQuestion(1);
        this.loadUserProgress();
        this.chatbotSv.sendSessionStart(this.moduleUuid!, this.lessonUuid!);
      }
    } else if (info.status === 'pending') {
      this.isInitializing = true;
      this.isLoading = true;
    } else if (info.status === 'error') {
      this.errorMessage = 'Lab encountered an error';
      this.isLoading = false;
    } else if (info.status === 'terminated') {
      this.errorMessage = 'Lab has been terminated';
      this.isLoading = false;
    }
  }

  /**
   * Loads user progress for this lab
   */
  private loadUserProgress(): void {
    if (!this.moduleUuid || !this.lessonUuid) return;

    const userId = this.labSv.getCurrentUserId();

    this.progressSub?.unsubscribe();
    this.progressSub = this.userSv
      .getUserProgress(userId, this.moduleUuid, this.lessonUuid)
      .subscribe({
        next: (progress) => {
          console.log('User progress loaded:', progress);
          this.userProgressData = progress;

          if (progress && Object.keys(progress).length > 0) {
            this.questions.forEach((question) => {
              const questionKey = question.id.toString();
              if (progress[questionKey] === true) {
                console.log(
                  `Marking question ${questionKey} as completed based on user progress`
                );
                question.completed = true;
                question.wrongAttempt = false;
              }
            });
            this.saveQuestionState();
          }
        },
        error: (err) => {
          console.error('Error loading user progress:', err);
        },
      });
  }

  /**
   * Loads questions for this lab
   */
  private loadQuestions(): void {
    if (!this.moduleUuid || !this.lessonUuid) return;

    // Load both questions and user progress
    forkJoin({
      questions: this.labSv.getQuestions(this.moduleUuid, this.lessonUuid),
      progress: this.userSv.getUserProgress(
        this.labSv.getCurrentUserId(),
        this.moduleUuid,
        this.lessonUuid
      ),
    }).subscribe({
      next: (result) => {
        // Transform API question format to our format
        this.questions = result.questions.questions.map(
          (q: any): Question => ({
            id: q.question_number,
            question: q.question,
            type: q.question_type?.toUpperCase() === 'MCQ' ? 'mcq' : 'check',
            options: q.answer_choices || [],
            correctAnswer: q.correct_answer,
            completed: false,
            visited: false,
            disabledOptions: [],
            wrongAttempt: false,
            attemptCount: 0,
          })
        );

        // Apply user progress to questions
        const progress = result.progress;
        if (progress && Object.keys(progress).length > 0) {
          this.questions.forEach((question) => {
            const questionKey = question.id.toString();
            if (progress[questionKey] === true) {
              console.log(
                `Question ${questionKey} is completed based on user progress`
              );
              question.completed = true;
              question.wrongAttempt = false;
            }
          });
        }

        // Restore saved question state and set up first question
        this.restoreQuestionState();
        if (this.questions.length && this.isLabActive) {
          this.setupQuestion(1);
        }
      },
      error: (err) =>
        console.error('Error loading questions or progress:', err),
    });
  }

  /**
   * Navigate to previous question
   */
  navigateToPrevQuestion(): void {
    if (this.currentQuestionIndex > 0) {
      this.resetUI();
      this.setupQuestion(this.currentQuestionIndex);
    }
  }

  /**
   * Navigate to next question
   */
  navigateToNextQuestion(): void {
    if (this.currentQuestionIndex < this.questions.length - 1) {
      this.resetUI();
      this.setupQuestion(this.currentQuestionIndex + 2);
    }
  }

  /**
   * Navigate to a specific question by number
   */
  navigateToQuestion(n: number): void {
    if (n >= 1 && n <= this.questions.length) {
      this.resetUI();
      this.setupQuestion(n);
    }
  }

  /**
   * Reset the answer attempt for the current question
   */
  resetAnswerAttempt(): void {
    this.selectedOption = null;
    this.showFeedback = false;
    this.feedbackMessage = '';
  }

  /**
   * Reset UI elements for question navigation
   */
  private resetUI(): void {
    this.selectedOption = null;
    this.showFeedback = false;
    this.feedbackMessage = '';
    this.isAnswerCorrect = false;

    // Special handling for last question
    if (this.currentQuestionIndex === this.questions.length - 1) {
      const lastQuestion = this.questions[this.currentQuestionIndex];
      if (lastQuestion && !lastQuestion.completed) {
        // Handle specific logic for last question if needed
      } else if (lastQuestion) {
        lastQuestion.wrongAttempt = false;
      }
    }
  }

  /**
   * Reset current question attempt
   */
  resetCurrentQuestionAttempt(): void {
    this.selectedOption = null;
    this.showFeedback = false;
    this.feedbackMessage = '';
    this.isAnswerCorrect = false;
  }

  /**
   * Set up a specific question
   */
  private setupQuestion(n: number): void {
    // Always update UI state so navigation works even while the lab is loading.
    this.resetUI();
    this.currentQuestionIndex = n - 1;
    this.questions[this.currentQuestionIndex].visited = true;
    this.saveQuestionState();

    // Scroll to top of question details
    setTimeout(() => {
      const element = document.querySelector('.question-details');
      if (element) {
        element.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 100);

    // The kubectl setup call requires a live pod — skip until lab is active.
    if (!this.labId || !this.isLabActive) return;

    const labInfo = this.labInfo$.getValue();
    if (!labInfo) return;

    console.log(
      `Setting up question ${n} with pod name: ${labInfo.pod_name || 'unknown'}`
    );
    this.labSv
      .setupQuestion(
        labInfo.pod_name || this.labId,
        this.moduleUuid!,
        this.lessonUuid!,
        n
      )
      .subscribe({
        error: (err) => console.error('Setup question error', err),
      });
  }

  /**
   * Check MCQ answer
   */
  checkMCQAnswer(): void {
    if (this.selectedOption === null) return;

    const q = this.currentQuestion!;
    this.showFeedback = true;
    const selectedAnswerText = q.options![this.selectedOption];
    const isCorrect = selectedAnswerText === q.correctAnswer;

    if (isCorrect) {
      this.isAnswerCorrect = true;
      this.feedbackMessage = 'Correct! Well done.';
      q.completed = true;
      q.wrongAttempt = false;

      // Update user progress if correct
      if (this.moduleUuid && this.lessonUuid) {
        this.userSv
          .updateUserProgress(
            this.labSv.getCurrentUserId(),
            this.moduleUuid,
            this.lessonUuid,
            q.id,
            true
          )
          .subscribe({
            next: () => console.log(`Progress saved for question ${q.id}`),
            error: (err) =>
              console.error(`Error saving progress: ${err.message}`),
          });
      }

      this.markCompleted(q.id);

      // Auto-grade via chatbot agent
      if (this.moduleUuid && this.lessonUuid) {
        this.chatbotSv.sendGradeMessage(
          this.moduleUuid, this.lessonUuid, q.id, 'correct'
        );
      }
    } else {
      this.isAnswerCorrect = false;
      this.feedbackMessage = 'Incorrect. Try again or skip.';
      if (!q.disabledOptions.includes(this.selectedOption)) {
        q.disabledOptions.push(this.selectedOption);
      }

      q.wrongAttempt = true;
      q.attemptCount = (q.attemptCount || 0) + 1;
      if (q.attemptCount === 2) {
        this.openChatPanel();
        this.chatbotSv.sendProactiveHint(q.id, q.question);
      }
      this.selectedOption = null;
    }
  }

  /**
   * Check question answer
   */
  checkAnswer(): void {
    if (
      !this.labId ||
      this.checkInProgress ||
      !this.isLabActive ||
      this.selectedOption === null
    )
      return;

    const q = this.currentQuestion!;
    if (q.type === 'mcq') {
      this.checkMCQAnswer();
      return;
    }

    const labInfo = this.labInfo$.getValue();
    if (!labInfo) return;

    this.checkInProgress = true;
    this.showFeedback = true;

    const payload = { selected_answer: q.options![this.selectedOption] };
    this.feedbackMessage = 'Checking your answer…';

    this.labSv
      .checkQuestion(
        labInfo.pod_name || this.labId,
        this.moduleUuid!,
        this.lessonUuid!,
        q.id,
        payload
      )
      .subscribe({
        next: (res) => {
          if (res.status === 'success' && res.completed) {
            this.isAnswerCorrect = true;
            this.feedbackMessage = 'Correct! Well done.';
            q.completed = true;
            q.wrongAttempt = false;
            this.markCompleted(q.id);
          } else {
            this.isAnswerCorrect = false;
            this.feedbackMessage = 'Incorrect. Try again or skip.';

            if (
              this.selectedOption !== null &&
              !q.disabledOptions.includes(this.selectedOption)
            ) {
              q.disabledOptions.push(this.selectedOption);
            }

            q.wrongAttempt = true;
            this.selectedOption = null;
          }
          this.checkInProgress = false;
        },
        error: (err) => {
          console.error(err);
          this.feedbackMessage = 'Error checking answer.';
          this.checkInProgress = false;
        },
      });
  }

  /**
   * Check question with solution
   */
  checkQuestion(questionNumber: number): void {
    if (!this.labId || this.checkInProgress || !this.isLabActive) return;

    const q = this.currentQuestion!;
    const labInfo = this.labInfo$.getValue();
    if (!labInfo) return;

    this.checkInProgress = true;
    this.showFeedback = true;

    // Changed this line to use a neutral feedback message with no error styling
    this.feedbackMessage = 'Checking your solution…';
    // We don't set isAnswerCorrect to false here anymore
    // The styling will now be neutral until we get the actual result

    this.labSv
      .checkQuestion(
        labInfo.pod_name || this.labId,
        this.moduleUuid!,
        this.lessonUuid!,
        questionNumber,
        undefined
      )
      .subscribe({
        next: (res) => {
          if (res.status === 'success' && res.completed) {
            this.isAnswerCorrect = true;
            this.feedbackMessage = 'Correct! Your solution works.';
            q.completed = true;
            q.wrongAttempt = false;
            this.markCompleted(questionNumber);

            // Auto-grade via chatbot agent
            if (this.moduleUuid && this.lessonUuid) {
              this.chatbotSv.sendGradeMessage(
                this.moduleUuid, this.lessonUuid, questionNumber, 'correct'
              );
            }
          } else {
            this.isAnswerCorrect = false;
            this.feedbackMessage =
              'Your solution is not working yet. Try again.';
            q.wrongAttempt = true;
            q.attemptCount = (q.attemptCount || 0) + 1;
            if (q.attemptCount === 2) {
              this.openChatPanel();
              this.chatbotSv.sendProactiveHint(questionNumber, q.question);
            }
          }
          this.checkInProgress = false;
        },
        error: (err) => {
          console.error(err);
          this.feedbackMessage = 'Error checking solution.';
          this.isAnswerCorrect = false;
          this.checkInProgress = false;
        },
      });
  }

  /**
   * Set selected option
   */
  setSelectedOption(i: number): void {
    const q = this.currentQuestion!;
    if (q.disabledOptions.includes(i)) return;
    if (this.showFeedback && !this.isAnswerCorrect) {
      this.showFeedback = false;
      this.feedbackMessage = '';
    }
    this.selectedOption = i;
  }

  /**
   * Mark a question as completed
   */
  private markCompleted(id: number): void {
    this.saveQuestionState();
    if (this.moduleUuid && this.lessonUuid) {
      this.userSv
        .updateUserProgress(
          this.labSv.getCurrentUserId(),
          this.moduleUuid,
          this.lessonUuid,
          id,
          true
        )
        .subscribe({
          next: () => console.log(`Progress saved for question ${id}`),
          error: (err) =>
            console.error(`Error saving progress: ${err.message}`),
        });
    }
  }

  /**
   * Save question state to session storage
   */
  private saveQuestionState(): void {
    try {
      sessionStorage.setItem(
        this.qStateKey,
        JSON.stringify({
          currentIndex: this.currentQuestionIndex,
          questions: this.questions.map((q) => ({
            completed: q.completed,
            visited: q.visited,
            disabledOptions: q.disabledOptions,
            wrongAttempt: q.wrongAttempt,
            attemptCount: q.attemptCount,
          })),
        })
      );
    } catch (e) {
      console.error('Error saving question state:', e);
    }
  }

  /**
   * Restore question state from session storage
   */
  private restoreQuestionState(): void {
    try {
      const raw = sessionStorage.getItem(this.qStateKey);
      if (!raw) return;

      const state = JSON.parse(raw);
      if (this.questions.length) {
        this.currentQuestionIndex = state.currentIndex || 0;
        state.questions.forEach((s: any, i: number) => {
          if (i < this.questions.length) {
            this.questions[i].completed = s.completed;
            this.questions[i].visited = s.visited;
            this.questions[i].disabledOptions = s.disabledOptions || [];
            this.questions[i].wrongAttempt = s.wrongAttempt || false;
            this.questions[i].attemptCount = s.attemptCount || 0;
          }
        });
      }
    } catch (e) {
      console.error('Error restoring question state:', e);
    }
  }

  /**
   * Initialize a new lab
   */
  public initializeNewLab(): void {
    try {
      sessionStorage.removeItem(this.qStateKey);
      sessionStorage.removeItem('activeLabId');
      this.questions = [];
      this.currentQuestionIndex = 0;
      this.selectedOption = null;
      this.showFeedback = false;
      this.feedbackMessage = '';
      this.isAnswerCorrect = false;
      this.errorMessage = null;
      this.isQuotaExhausted = false;
      this.labId = null;
    } catch (e) {
      console.error('Error clearing question state:', e);
    }
    this.launchNewLab().subscribe();
  }
  // Add to the class properties
  private destroy$ = new Subject<void>();

  // Add this to the constructor
  @HostListener('window:beforeunload', ['$event'])
  handleBeforeUnload(event: BeforeUnloadEvent): void {
    // Perform synchronous cleanup to ensure it runs before the page unloads
    this.synchronousLabCleanup();

    // Optional: Show confirmation dialog
    event.preventDefault();
    event.returnValue =
      'Your lab session will be terminated. Are you sure you want to leave?';
    return event.returnValue;
  }
  /**
   * Terminate current lab
   */
  terminateLab(): void {
    if (!this.labId) return;

    this.isLoading = true;
    this.labSv
      .terminateLab(this.labId, this.labSv.getCurrentUserId())
      .subscribe({
        next: () => {
          try {
            // Ask for NPS feedback now that the user has finished a session.
            this.triggerNps();

            sessionStorage.removeItem('activeLabId');
            sessionStorage.removeItem(this.qStateKey);
            this.questions = [];
            this.currentQuestionIndex = 0;

            // Navigate to dashboard and handle possible navigation errors
            this.router.navigate(['/dashboard']).then(
              (success) => {
                if (!success) {
                  console.error('Navigation to dashboard failed');
                  this.isLoading = false;
                  // Fallback - try reloading the application
                  window.location.href = '/dashboard';
                }
              },
              (err) => {
                console.error('Navigation error:', err);
                this.isLoading = false;
                // Fallback - try reloading the application
                window.location.href = '/dashboard';
              }
            );
          } catch (e) {
            console.error('Error during lab termination cleanup:', e);
            this.isLoading = false;
            // Fallback - try reloading the application
            window.location.href = '/dashboard';
          }
        },
        error: (err) => {
          console.error('Error terminating lab:', err);
          this.isLoading = false;
          this.errorMessage = 'Error terminating lab: ' + err.message;

          // Even if there's an error, try to navigate away
          setTimeout(() => {
            this.router.navigate(['/dashboard']).catch(() => {
              window.location.href = '/dashboard';
            });
          }, 2000);
        },
      });
  }

  /**
   * Start timer for lab countdown
   */
  private startTimer(t: {
    hours: number;
    minutes: number;
    seconds: number;
  }): void {
    this.timerSub?.unsubscribe();

    let seconds = t.hours * 3600 + t.minutes * 60 + t.seconds;
    this.timerSub = interval(1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (--seconds <= 0) {
          this.timeRemaining$.next('Expired');
          this.timerSub?.unsubscribe();
          return;
        }
        const h = Math.floor(seconds / 3600),
          m = Math.floor((seconds % 3600) / 60),
          s = seconds % 60;
        this.updateTime({ hours: h, minutes: m, seconds: s });
      });
  }

  /**
   * Update time display
   */
  private updateTime(t: { hours: number; minutes: number; seconds: number }) {
    this.timeRemaining$.next(`${t.hours}h ${t.minutes}m ${t.seconds}s`);
  }

  /**
   * Check if user is on mobile device
   */
  private checkIsMobile(): void {
    this.isMobile = window.innerWidth < 768;

    // Reset mobile UI state when switching to desktop
    if (!this.isMobile) {
      this.showSidebar = false;
      this.showChatbot = false;
    }
  }

  /**
   * Adjust iframe dimensions
   */
  private adjustIframe(): void {
    if (!this.isLabActive) return;

    try {
      const frame = this.el.nativeElement.querySelector('.code-server-iframe');
      if (frame) {
        frame.style.height = '100%';
      }
    } catch (e) {
      console.error('Error adjusting iframe:', e);
    }
  }

  /**
   * Get count of completed questions
   */
  getCompletedQuestionsCount(): number {
    return this.questions.filter((q) => q.completed).length;
  }

  /**
   * Toggle instructions panel
   */
  toggleInstructions(): void {
    this.showInstructions = !this.showInstructions;
  }

  /**
   * Capture a screenshot of the current tab and send to the AI chatbot for analysis
   */
  async analyzeTerminal(): Promise<void> {
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        preferCurrentTab: true,
      });

      const video = document.createElement('video');
      video.srcObject = stream;

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
        video.play();
      });

      const canvas = document.createElement('canvas');
      const maxW = 1280;
      const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);

      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      video.srcObject = null;

      const base64 = canvas.toDataURL('image/jpeg', 0.75);
      this.openChatPanel();
      this.chatbotSv.stagePendingImage(base64);
    } catch {
      // User cancelled or browser unsupported — fail silently
    }
  }

  /**
   * Toggle sidebar on mobile
   */
  toggleSidebar(): void {
    this.showSidebar = !this.showSidebar;
    if (this.showSidebar) {
      this.showChatbot = false;
    }
  }

  /**
   * Toggle chatbot on mobile
   */
  toggleChatbot(): void {
    this.showChatbot = !this.showChatbot;
    if (this.showChatbot) {
      this.showSidebar = false;
    }
  }

  /**
   * Open chat panel (used by feedback component to show grader response)
   */
  openChatPanel(): void {
    if (this.isMobile) {
      this.showChatbot = true;
      this.showSidebar = false;
    }
  }

  /**
   * Ask the AI to explain the current question
   */
  askAboutQuestion(): void {
    const q = this.currentQuestion;
    if (!q) return;
    if (this.isMobile) {
      this.showChatbot = true;
      this.showSidebar = false;
    }
    this.chatbotSv.sendMessage(
      `Can you explain Question ${q.id} to me? The question is: "${q.question}"`
    );
  }

  /**
   * Refresh lab
   */
  refreshLab(): void {
    if (!this.labId || !this.isLabActive || this.isLoading) return;

    this.isLoading = true;
    this.labSv.getLabInfo(this.labId).subscribe(
      (info) => {
        this.handleLabInfo(info);
        this.isLoading = false;
      },
      (err) => {
        console.error('Error refreshing lab:', err);
        this.isLoading = false;
      }
    );
  }
  // Sync cleanup for immediate browser actions
  private synchronousLabCleanup(): void {
    try {
      if (this.labId) {
        // Clear storage
        sessionStorage.removeItem('activeLabId');
        sessionStorage.removeItem(this.qStateKey);

        // Use synchronous XHR to ensure the request completes before page unload
        const xhr = new XMLHttpRequest();
        xhr.open(
          'DELETE',
          `${this.labSv.apiUrl}/labs/${
            this.labId
          }?user_id=${this.labSv.getCurrentUserId()}`,
          false
        ); // 'false' makes it synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send();

        console.log('Lab terminated synchronously on page unload');
      }
    } catch (e) {
      console.error('Error during synchronous lab cleanup:', e);
    }
  }
  /**
   * Manually retry connection
   */
  manualRetryConnection(): void {
    if (this.labId) {
      this.labSv.getLabInfo(this.labId).subscribe(
        (info) => {
          this.hadSuccessfulConnection = true;
          this.lostConnectionCount = 0;
          this.isApiConnected = true;
          this.handleLabInfo(info);
        },
        (err) => {
          console.error('Manual retry failed:', err);
        }
      );
    }
  }

  /**
   * Check if feedback button should be shown
   */
  get showFeedbackButton(): boolean {
    const totalCount = this.questions.length;
    if (totalCount === 0) return false;
    const completedCount = this.getCompletedQuestionsCount();
    // Show when all questions are complete, OR when the student has navigated
    // to the last question (whether they completed it or skipped to it).
    if (completedCount === totalCount) return true;
    return this.currentQuestionIndex === totalCount - 1;
  }

  /**
   * Check if API banner should be shown
   */
  get showApiBanner(): boolean {
    return (
      this.lostConnectionCount >= 3 &&
      this.isLabActive &&
      !this.isInitializing &&
      !this.isLoading
    );
  }
}
