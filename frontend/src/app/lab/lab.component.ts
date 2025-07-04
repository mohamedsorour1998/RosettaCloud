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
  imports: [CommonModule, FeedbackComponent, ChatbotComponent],
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
  timeRemaining$ = new BehaviorSubject<string>('');

  // UI related properties
  showInstructions = false;
  isMobile = false;
  showSidebar = false;
  showChatbot = false;

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

  // Constants
  private readonly qStateKey = 'lab-question-state';
  private readonly pollInterval = 30000; // 30 seconds
  private readonly retryDelay = 5000; // 5 seconds

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private labSv: LabService,
    private userSv: UserService,
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

  ngOnDestroy(): void {
    // Clean up subscriptions to prevent memory leaks
    this.timerSub?.unsubscribe();
    this.pollSub?.unsubscribe();
    this.apiSub?.unsubscribe();
    this.progressSub?.unsubscribe();
    this.iframeSub?.unsubscribe();
    this.themeSub?.unsubscribe();

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
        this.errorMessage = 'Error retrieving lab info: ' + err.message;
        this.isLoading = false;
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

    // Handle error or terminated state
    if (['error', 'terminated'].includes(info.status)) {
      sessionStorage.removeItem('activeLabId');
      this.labId = null;
      this.launchNewLab().subscribe();
      return;
    }

    // Handle running state
    if (info.status === 'running') {
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
    if (!this.labId || !this.isLabActive) return;

    const labInfo = this.labInfo$.getValue();
    if (!labInfo) return;

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
    } else {
      this.isAnswerCorrect = false;
      this.feedbackMessage = 'Incorrect. Try again or skip.';
      if (!q.disabledOptions.includes(this.selectedOption)) {
        q.disabledOptions.push(this.selectedOption);
      }

      q.wrongAttempt = true;
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
          } else {
            this.isAnswerCorrect = false;
            this.feedbackMessage =
              'Your solution is not working yet. Try again.';
            q.wrongAttempt = true;
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
      this.questions = [];
      this.currentQuestionIndex = 0;
      this.selectedOption = null;
      this.showFeedback = false;
      this.feedbackMessage = '';
      this.isAnswerCorrect = false;
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
    const completedCount = this.getCompletedQuestionsCount();
    const totalCount = this.questions.length;

    return (
      totalCount > 0 &&
      (this.currentQuestionIndex === this.questions.length - 1 ||
        completedCount / totalCount >= 0.75)
    );
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
