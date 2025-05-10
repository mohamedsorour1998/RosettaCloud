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
import { ChatbotComponent } from '../chatbot/chatbot.component';
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
@Component({
  selector: 'app-lab',
  standalone: true,
  imports: [CommonModule, FeedbackComponent, ChatbotComponent],
  templateUrl: './lab.component.html',
  styleUrls: ['./lab.component.scss'],
})
export class LabComponent implements OnInit, OnDestroy, AfterViewInit {
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
  moduleUuid: string | null = null;
  lessonUuid: string | null = null;
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
  ngOnInit(): void {
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
          setTimeout(() => this.adjustIframe(), 1000);
        }
      });
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
    this.moduleUuid = this.route.snapshot.paramMap.get('moduleUuid');
    this.lessonUuid = this.route.snapshot.paramMap.get('lessonUuid');
    if (!this.moduleUuid || !this.lessonUuid) {
      this.errorMessage = 'Module or lesson information is missing';
      this.isLoading = false;
      return;
    }
    this.initLab();
  }

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    this.timerSub?.unsubscribe();
    this.pollSub?.unsubscribe();
    this.apiSub?.unsubscribe();
    this.progressSub?.unsubscribe();
    this.iframeSub?.unsubscribe();
  }
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
    this.labInfo$.next(info);
    if (['error', 'terminated'].includes(info.status)) {
      sessionStorage.removeItem('activeLabId');
      this.labId = null;
      this.launchNewLab().subscribe();
      return; // stop processing the dead lab
    }

    if (info.status === 'running' && info.pod_ip) {
      const url = info.pod_ip.includes('://')
        ? info.pod_ip
        : `https://${info.pod_ip}/`;
      if (this.lastIframeUrl !== url || statusChanged) {
        this.iframeUrl$.next(url);
      }
      this.isLabActive = true;
      this.isLoading = false;
      this.isInitializing = false;
      if (info.time_remaining) {
        this.updateTime(info.time_remaining);
        if (!this.timerSub || statusChanged) {
          this.startTimer(info.time_remaining);
        }
      } else {
        this.timeRemaining$.next('Time unknown');
      }
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
  private loadQuestions(): void {
    if (!this.moduleUuid || !this.lessonUuid) return;
    forkJoin({
      questions: this.labSv.getQuestions(this.moduleUuid, this.lessonUuid),
      progress: this.userSv.getUserProgress(
        this.labSv.getCurrentUserId(),
        this.moduleUuid,
        this.lessonUuid
      ),
    }).subscribe({
      next: (result) => {
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
        this.restoreQuestionState();
        if (this.questions.length && this.isLabActive) {
          this.setupQuestion(1);
        }
      },
      error: (err) =>
        console.error('Error loading questions or progress:', err),
    });
  }
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
  resetAnswerAttempt(): void {
    const currentQuestion = this.questions[this.currentQuestionIndex];
    this.selectedOption = null;
    this.showFeedback = false;
    this.feedbackMessage = '';
  }
  private resetUI(): void {
    this.selectedOption = null;
    this.showFeedback = false;
    this.feedbackMessage = '';
    this.isAnswerCorrect = false;
    if (this.currentQuestionIndex === this.questions.length - 1) {
      const lastQuestion = this.questions[this.currentQuestionIndex];
      if (lastQuestion && !lastQuestion.completed) {
      } else {
        lastQuestion.wrongAttempt = false;
      }
    }
  }
  resetCurrentQuestionAttempt(): void {
    this.selectedOption = null;
    this.showFeedback = false;
    this.feedbackMessage = '';
    this.isAnswerCorrect = false;
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
    const selectedAnswerText = q.options![this.selectedOption];
    const isCorrect = selectedAnswerText === q.correctAnswer;

    if (isCorrect) {
      this.isAnswerCorrect = true;
      this.feedbackMessage = 'Correct! Well done.';
      q.completed = true;
      q.wrongAttempt = false;
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
  setSelectedOption(i: number): void {
    const q = this.currentQuestion!;
    if (q.disabledOptions.includes(i)) return;
    if (this.showFeedback && !this.isAnswerCorrect) {
      this.showFeedback = false;
      this.feedbackMessage = '';
    }
    this.selectedOption = i;
  }
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
    try {
      sessionStorage.removeItem(this.qStateKey);
      this.questions = [];
      this.currentQuestionIndex = 0;
    } catch (e) {
      console.error('Error clearing question state:', e);
    }
    this.launchNewLab().subscribe();
  }
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
          } catch (e) {
            console.error('Error clearing session storage:', e);
          }
          this.router.navigate(['/dashboard']);
        },
        error: (err) => {
          this.isLoading = false;
          this.errorMessage = 'Error terminating lab: ' + err.message;
        },
      });
  }
  private startTimer(t: {
    hours: number;
    minutes: number;
    seconds: number;
  }): void {
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
  @HostListener('window:resize')
  onResize() {
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
  get showFeedbackButton(): boolean {
    const completedCount = this.getCompletedQuestionsCount();
    const totalCount = this.questions.length;

    return (
      totalCount > 0 &&
      (this.currentQuestionIndex === this.questions.length - 1 ||
        completedCount / totalCount >= 0.75)
    );
  }
}
