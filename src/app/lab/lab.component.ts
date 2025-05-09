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
import {
  BehaviorSubject,
  Observable,
  Subscription,
  interval,
  of,
  forkJoin,
  Subject,
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
} from 'rxjs/operators';
import { LabService } from '../services/lab.service';
import { UserService } from '../services/user.service';
import { FeedbackComponent } from '../feedback/feedback.component';
import { ChatbotComponent } from "../chatbot/chatbot.component";

/* ─── Types ──────────────────────────────────────────── */
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
}

interface LabInfo {
  lab_id: string;
  pod_ip: string | null;
  time_remaining: { hours: number; minutes: number; seconds: number } | null;
  status: string;
  index: number;
}

/* ─── Component ──────────────────────────────────────── */
@Component({
  selector: 'app-lab',
  standalone: true,
  imports: [CommonModule, FeedbackComponent, ChatbotComponent],
  templateUrl: './lab.component.html',
  styleUrls: ['./lab.component.scss'],
})
export class LabComponent implements OnInit, OnDestroy, AfterViewInit {
  /* state */
  labId: string | null = null;
  labInfo$ = new BehaviorSubject<LabInfo | null>(null);
  codeServerUrl: SafeResourceUrl | null = null;
  private iframeUrl$ = new Subject<string>();
  private lastIframeUrl: string | null = null;

  questions: Question[] = [];
  currentQuestionIndex = 0;
  get currentQuestion(): Question | null {
    return this.questions[this.currentQuestionIndex] || null;
  }

  /* UI flags */
  selectedOption: number | null = null;
  showFeedback = false;
  feedbackMessage = '';
  isAnswerCorrect = false;
  checkInProgress = false;
  hadSuccessfulConnection = false;
  lostConnectionCount = 0;
  isLoading = true;
  isInitializing = true;
  isLabActive = false;
  isApiConnected = true;
  errorMessage: string | null = null;
  timeRemaining$ = new BehaviorSubject<string>('');
  userProgressData: any = {};

  /* route params */
  moduleUuid: string | null = null;
  lessonUuid: string | null = null;

  /* subs */
  private timerSub?: Subscription;
  private pollSub?: Subscription;
  private apiSub?: Subscription;
  private progressSub?: Subscription;
  private iframeSub?: Subscription;

  private readonly qStateKey = 'lab-question-state';
  private readonly pollInterval = 30000; // 30 seconds between polls
  private readonly retryDelay = 5000; // 5 seconds between retries

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private labSv: LabService,
    private userSv: UserService,
    private sanitizer: DomSanitizer,
    private el: ElementRef
  ) {}

  /* ─── LIFECYCLE ───────────────────────────────────── */
  ngOnInit(): void {
    // Set up iframe URL updater with debounce
    this.iframeSub = this.iframeUrl$
      .pipe(
        debounceTime(1000), // Wait 1 second before processing URL changes
        distinctUntilChanged() // Only process when URL actually changes
      )
      .subscribe((url) => {
        console.log('Updating iframe URL:', url);
        if (url !== this.lastIframeUrl) {
          this.lastIframeUrl = url;
          this.codeServerUrl =
            this.sanitizer.bypassSecurityTrustResourceUrl(url);

          // Wait before trying to adjust iframe to allow it to load
          setTimeout(() => this.adjustIframe(), 1000);
        }
      });

    // Ensure service is available before subscribing
    if (this.labSv && this.labSv.connectionStatus$) {
      this.apiSub = this.labSv.connectionStatus$.subscribe((ok) => {
        if (ok) {
          this.hadSuccessfulConnection = true;
          this.lostConnectionCount = 0; // reset on any success
        } else if (this.hadSuccessfulConnection) {
          this.lostConnectionCount++; // count only after first success
        }
        this.isApiConnected = ok;
      });
    } else {
      console.error('Lab service or connection status not available');
      this.isApiConnected = false;
    }

    // Continue with the rest of the initialization
    this.moduleUuid = this.route.snapshot.paramMap.get('moduleUuid');
    this.lessonUuid = this.route.snapshot.paramMap.get('lessonUuid');
    if (!this.moduleUuid || !this.lessonUuid) {
      this.errorMessage = 'Module or lesson information is missing';
      this.isLoading = false;
      return;
    }
    this.initLab();
  }

  ngAfterViewInit(): void {
    // No immediate iframe adjustment - will be triggered after URL is set
  }

  ngOnDestroy(): void {
    // Clean up all subscriptions
    this.timerSub?.unsubscribe();
    this.pollSub?.unsubscribe();
    this.apiSub?.unsubscribe();
    this.progressSub?.unsubscribe();
    this.iframeSub?.unsubscribe();
  }

  /* ─── LAB INIT / POLLING ─────────────────────────── */
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

  private launchNewLab(): Observable<unknown> {
    this.isInitializing = true;
    return this.labSv.launchLab(this.labSv.getCurrentUserId()).pipe(
      tap((res) => {
        this.labId = res.lab_id;
        sessionStorage.setItem('activeLabId', res.lab_id);
        this.loadLabInfo(res.lab_id);
      }),
      catchError((err) => {
        this.errorMessage = 'Error creating lab: ' + (err.message || 'Unknown');
        this.isLoading = false;
        return of(null);
      })
    );
  }

  private loadLabInfo(labId: string): void {
    this.startPolling();
    this.loadQuestions();
  }

  private startPolling(): void {
    if (!this.labId) return;
    this.pollSub?.unsubscribe();

    this.pollSub = interval(this.pollInterval)
      .pipe(
        filter(() => this.isApiConnected),
        switchMap(() => this.labSv.getLabInfo(this.labId!)),
        retryWhen((errs) => errs.pipe(delay(this.retryDelay), take(3))),
        tap((info) => this.handleLabInfo(info))
      )
      .subscribe();

    /* first snapshot immediately */
    this.labSv.getLabInfo(this.labId).subscribe(
      (info) => this.handleLabInfo(info),
      (err) => {
        this.errorMessage = 'Error retrieving lab info: ' + err.message;
        this.isLoading = false;
      }
    );
  }

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

    // Update internal state
    this.labInfo$.next(info);

    /* auto-recover from dead labs */
    if (['error', 'terminated'].includes(info.status)) {
      // remove stale lab reference
      sessionStorage.removeItem('activeLabId');
      this.labId = null;
      // launch a brand-new lab
      this.launchNewLab().subscribe();
      return; // stop processing the dead lab
    }

    if (info.status === 'running' && info.pod_ip) {
      // Format URL properly
      const url = info.pod_ip.includes('://')
        ? info.pod_ip
        : `https://${info.pod_ip}/`;

      // Only update the iframe URL if it's changed or the status has changed
      if (this.lastIframeUrl !== url || statusChanged) {
        // Push to the debounced URL handler
        this.iframeUrl$.next(url);
      }

      // Update status flags
      this.isLabActive = true;
      this.isLoading = false;
      this.isInitializing = false;

      // Handle timer
      if (info.time_remaining) {
        this.updateTime(info.time_remaining);

        // Only start a new timer if we don't have one running or the status just changed
        if (!this.timerSub || statusChanged) {
          this.startTimer(info.time_remaining);
        }
      } else {
        this.timeRemaining$.next('Time unknown');
      }

      // If the lab just became active and we have questions, set up question 1
      if (wasNotActive && this.questions.length > 0) {
        console.log('Lab became active, setting up question 1 automatically');
        this.setupQuestion(1);

        // Also load user progress to update completed questions
        this.loadUserProgress();
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

  /* --- Load User Progress --- */
  private loadUserProgress(): void {
    if (!this.moduleUuid || !this.lessonUuid) return;

    const userId = this.labSv.getCurrentUserId();

    this.progressSub?.unsubscribe();
    this.progressSub = this.userSv
      .getUserProgress(userId, this.moduleUuid, this.lessonUuid)
      .subscribe({
        next: (progress) => {
          console.log('User progress loaded:', progress);
          // Store progress data for feedback component
          this.userProgressData = progress;

          if (progress && Object.keys(progress).length > 0) {
            // Update questions with completion status
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

  /* ─── QUESTIONS ─────────────────────────────────── */
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
        // Map questions from API
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
          })
        );

        // Apply user progress to mark completed questions
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

        // Restore any session state (may override progress from API)
        this.restoreQuestionState();

        // Only set up question 1 if lab is already active, otherwise it will be done
        // when the lab becomes active in handleLabInfo
        if (this.questions.length && this.isLabActive) {
          this.setupQuestion(1);
        }
      },
      error: (err) =>
        console.error('Error loading questions or progress:', err),
    });
  }

  /* ─── Navigation helpers ────────────────────────── */
  navigateToPrevQuestion(): void {
    if (this.currentQuestionIndex > 0) {
      this.resetUI();
      this.setupQuestion(this.currentQuestionIndex);
    }
  }

  navigateToNextQuestion(): void {
    if (this.currentQuestionIndex < this.questions.length - 1) {
      this.resetUI();
      this.setupQuestion(this.currentQuestionIndex + 2);
    }
  }

  navigateToQuestion(n: number): void {
    if (n >= 1 && n <= this.questions.length) {
      this.resetUI();
      this.setupQuestion(n);
    }
  }

  /* ─── Question setup / UI reset ─────────────────── */
  resetAnswerAttempt(): void {
    const currentQuestion = this.questions[this.currentQuestionIndex];
    this.selectedOption = null;
    this.showFeedback = false;
    this.feedbackMessage = '';

    // Don't reset wrongAttempt flag - we still want to show retry button
  }
  // Modify the resetUI method around line 412
  private resetUI(): void {
    this.selectedOption = null;
    this.showFeedback = false;
    this.feedbackMessage = '';
    this.isAnswerCorrect = false;

    // If this is the last question and it had a wrong attempt,
    // make sure the wrongAttempt flag is preserved for UI display purposes
    if (this.currentQuestionIndex === this.questions.length - 1) {
      const lastQuestion = this.questions[this.currentQuestionIndex];
      if (lastQuestion && !lastQuestion.completed) {
        // Keep the wrongAttempt flag if we're staying on the same question
        // This ensures the retry UI remains visible
      } else {
        // Reset wrongAttempt only if we're changing questions or it's completed
        lastQuestion.wrongAttempt = false;
      }
    }
  }

  // Add this helper method
  resetCurrentQuestionAttempt(): void {
    this.selectedOption = null;
    this.showFeedback = false;
    this.feedbackMessage = '';
    this.isAnswerCorrect = false;

    // Don't reset the wrongAttempt flag to preserve UI state
  }

  private setupQuestion(n: number): void {
    if (!this.labId || !this.isLabActive) return;

    const labInfo = this.labInfo$.getValue();
    if (!labInfo) return;

    this.resetUI();
    this.currentQuestionIndex = n - 1;
    this.questions[this.currentQuestionIndex].visited = true;
    this.saveQuestionState();

    setTimeout(() => {
      const element = document.querySelector('.question-details');
      if (element) {
        element.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 100);

    // Always call setup for all question types
    console.log(`Setting up question ${n} with pod index: ${labInfo.index}`);
    this.labSv
      .setupQuestion(
        this.labId,
        this.moduleUuid!,
        this.lessonUuid!,
        n,
        labInfo.index
      )
      .subscribe({
        error: (err) => console.error('Setup question error', err),
      });
  }

  checkMCQAnswer(): void {
    if (this.selectedOption === null) return;

    const q = this.currentQuestion!;
    this.showFeedback = true;

    // Get the selected answer text
    const selectedAnswerText = q.options![this.selectedOption];

    // Compare with the correct answer
    const isCorrect = selectedAnswerText === q.correctAnswer;

    if (isCorrect) {
      this.isAnswerCorrect = true;
      this.feedbackMessage = 'Correct! Well done.';
      q.completed = true;
      q.wrongAttempt = false;

      // Track progress in user service
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
    } else {
      this.isAnswerCorrect = false;
      this.feedbackMessage = 'Incorrect. Try again or skip.';

      // Add the incorrect option to disabled options
      if (!q.disabledOptions.includes(this.selectedOption)) {
        q.disabledOptions.push(this.selectedOption);
      }

      q.wrongAttempt = true;
      this.selectedOption = null;
    }
  }

  checkAnswer(): void {
    if (
      !this.labId ||
      this.checkInProgress ||
      !this.isLabActive ||
      this.selectedOption === null
    )
      return;

    const q = this.currentQuestion!;

    // For MCQ questions, check locally without API call
    if (q.type === 'mcq') {
      this.checkMCQAnswer();
      return;
    }

    // For Check questions, use the original API call logic
    const labInfo = this.labInfo$.getValue();
    if (!labInfo) return;

    this.checkInProgress = true;
    this.showFeedback = true;

    const payload = { selected_answer: q.options![this.selectedOption] };
    this.feedbackMessage = 'Checking your answer…';

    this.labSv
      .checkQuestion(
        this.labId,
        this.moduleUuid!,
        this.lessonUuid!,
        q.id,
        payload,
        labInfo.index
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

  checkQuestion(questionNumber: number): void {
    if (!this.labId || this.checkInProgress || !this.isLabActive) return;

    const q = this.currentQuestion!;
    const labInfo = this.labInfo$.getValue();
    if (!labInfo) return;

    this.checkInProgress = true;
    this.showFeedback = true;
    this.feedbackMessage = 'Checking your answer…';

    this.labSv
      .checkQuestion(
        this.labId,
        this.moduleUuid!,
        this.lessonUuid!,
        questionNumber,
        undefined,
        labInfo.index
      )
      .subscribe({
        next: (res) => {
          if (res.status === 'success' && res.completed) {
            this.isAnswerCorrect = true;
            this.feedbackMessage = 'Correct! Well done.';
            q.completed = true;
            q.wrongAttempt = false;
            this.markCompleted(questionNumber);
          } else {
            this.isAnswerCorrect = false;
            this.feedbackMessage = 'Incorrect. Try again or skip.';
            q.wrongAttempt = true;
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

  /* selection click */
  setSelectedOption(i: number): void {
    const q = this.currentQuestion!;
    if (q.disabledOptions.includes(i)) return;
    if (this.showFeedback && !this.isAnswerCorrect) {
      this.showFeedback = false;
      this.feedbackMessage = '';
    }
    this.selectedOption = i;
  }

  /* ─── Completion / state persistence ─────────────── */
  private markCompleted(id: number): void {
    // Save to session storage
    this.saveQuestionState();

    // Update user progress in backend
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

  private saveQuestionState(): void {
    try {
      sessionStorage.setItem(
        this.qStateKey,
        JSON.stringify({
          currentIndex: this.currentQuestionIndex,
          questions: this.questions.map((q) => ({
            completed: q.completed,
            visited: q.visited,
          })),
        })
      );
    } catch (e) {
      console.error('Error saving question state:', e);
    }
  }

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
          }
        });
      }
    } catch (e) {
      console.error('Error restoring question state:', e);
    }
  }

  public initializeNewLab(): void {
    // Clear question state when starting a new lab
    try {
      sessionStorage.removeItem(this.qStateKey);
      this.questions = [];
      this.currentQuestionIndex = 0;
    } catch (e) {
      console.error('Error clearing question state:', e);
    }

    // Launch new lab
    this.launchNewLab().subscribe();
  }

  /* ─── Terminate ─────────────────────────────────── */
  terminateLab(): void {
    if (!this.labId) return;
    this.isLoading = true;
    this.labSv
      .terminateLab(this.labId, this.labSv.getCurrentUserId())
      .subscribe({
        next: () => {
          // Clear local storage
          try {
            sessionStorage.removeItem('activeLabId');
            sessionStorage.removeItem(this.qStateKey);
            this.questions = [];
            this.currentQuestionIndex = 0;
          } catch (e) {
            console.error('Error clearing session storage:', e);
          }

          // Navigate away
          this.router.navigate(['/dashboard']);
        },
        error: (err) => {
          this.isLoading = false;
          this.errorMessage = 'Error terminating lab: ' + err.message;
        },
      });
  }

  /* ─── Timer helpers ─────────────────────────────── */
  private startTimer(t: {
    hours: number;
    minutes: number;
    seconds: number;
  }): void {
    // Clean up existing timer if present
    this.timerSub?.unsubscribe();

    let seconds = t.hours * 3600 + t.minutes * 60 + t.seconds;
    this.timerSub = interval(1000).subscribe(() => {
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

  private updateTime(t: { hours: number; minutes: number; seconds: number }) {
    this.timeRemaining$.next(`${t.hours}h ${t.minutes}m ${t.seconds}s`);
  }

  /* ─── Misc helpers ──────────────────────────────── */
  @HostListener('window:resize')
  onResize() {
    // Debounce iframe adjustment to prevent too many calls
    setTimeout(() => this.adjustIframe(), 500);
  }

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

  getCompletedQuestionsCount(): number {
    return this.questions.filter((q) => q.completed).length;
  }

  get showApiBanner(): boolean {
    return (
      this.lostConnectionCount >= 3 && // 3 × polls ≈ offline for a while
      this.isLabActive && // lab is running
      !this.isInitializing && // not in init
      !this.isLoading // not in global spinner
    );
  }
  // New computed property to determine when to show the feedback button
  // Update the showFeedbackButton getter
  get showFeedbackButton(): boolean {
    // Show feedback button when either:
    // 1. User has reached the last question (whether completed or not)
    // 2. User has completed 75% or more of all questions
    const completedCount = this.getCompletedQuestionsCount();
    const totalCount = this.questions.length;

    return (
      totalCount > 0 &&
      // First condition: User is at the last question
      (this.currentQuestionIndex === this.questions.length - 1 ||
        // Second condition: User has completed at least 75% of questions
        completedCount / totalCount >= 0.75)
    );
  }
}
