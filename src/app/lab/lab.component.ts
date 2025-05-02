/* lab.component.ts */
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
import { BehaviorSubject, Observable, Subscription, interval, of } from 'rxjs';
import {
  catchError,
  delay,
  filter,
  map,
  retryWhen,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { LabService } from '../services/lab.service';

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
}

/* ─── Component ──────────────────────────────────────── */
@Component({
  selector: 'app-lab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './lab.component.html',
  styleUrls: ['./lab.component.scss'],
})
export class LabComponent implements OnInit, OnDestroy, AfterViewInit {
  /* state */
  labId: string | null = null;
  labInfo$ = new BehaviorSubject<LabInfo | null>(null);
  codeServerUrl: SafeResourceUrl | null = null;

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

  /* route params */
  moduleUuid: string | null = null;
  lessonUuid: string | null = null;

  /* subs */
  private timerSub?: Subscription;
  private pollSub?: Subscription;
  private apiSub?: Subscription;

  private readonly qStateKey = 'lab-question-state';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private labSv: LabService,
    private sanitizer: DomSanitizer,
    private el: ElementRef
  ) {}

  /* ─── LIFECYCLE ───────────────────────────────────── */
  ngOnInit(): void {
    this.apiSub = this.labSv.connectionStatus$.subscribe((ok) => {
      if (ok) {
        this.hadSuccessfulConnection = true;
        this.lostConnectionCount = 0; // reset on any success
      } else if (this.hadSuccessfulConnection) {
        this.lostConnectionCount++; // count only after first success
      }
      this.isApiConnected = ok;
    });

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
    setTimeout(() => this.adjustIframe(), 500);
  }

  ngOnDestroy(): void {
    this.timerSub?.unsubscribe();
    this.pollSub?.unsubscribe();
    this.apiSub?.unsubscribe();
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

    this.pollSub = interval(10000)
      .pipe(
        filter(() => this.isApiConnected),
        switchMap(() => this.labSv.getLabInfo(this.labId!)),
        retryWhen((errs) => errs.pipe(delay(2000), take(3))),
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
      const url = info.pod_ip.includes('://')
        ? info.pod_ip
        : `https://${info.pod_ip}/`;
      this.codeServerUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      this.isLabActive = true;
      this.isLoading = false;
      this.isInitializing = false;
      setTimeout(() => this.adjustIframe(), 500);

      if (info.time_remaining) {
        this.updateTime(info.time_remaining);
        this.startTimer(info.time_remaining);
      } else this.timeRemaining$.next('Time unknown');
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

  /* ─── QUESTIONS ─────────────────────────────────── */
  private loadQuestions(): void {
    if (!this.moduleUuid || !this.lessonUuid) return;

    this.labSv.getQuestions(this.moduleUuid, this.lessonUuid).subscribe(
      (data) => {
        this.questions = data.questions.map(
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
        this.restoreQuestionState();
        if (this.questions.length) this.setupQuestion(1);
      },
      (err) => console.error('Error loading questions', err)
    );
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
  private resetUI(): void {
    this.selectedOption = null;
    this.showFeedback = false;
    this.feedbackMessage = '';
    this.isAnswerCorrect = false;
  }

  private setupQuestion(n: number): void {
    if (!this.labId || !this.isLabActive) return;

    this.resetUI();
    this.currentQuestionIndex = n - 1;
    this.questions[this.currentQuestionIndex].visited = true;
    this.saveQuestionState();

    setTimeout(
      () => document.querySelector('.question-details')?.scrollTo(0, 0),
      100
    );

    this.labSv
      .setupQuestion(this.labId, this.moduleUuid!, this.lessonUuid!, n)
      .subscribe({
        error: (err) => console.error('Setup question error', err),
      });
  }

  /* ─── SUBMIT / CHECK logic ───────────────────────── */
  checkAnswer(): void {
    if (
      !this.labId ||
      this.checkInProgress ||
      !this.isLabActive ||
      this.selectedOption === null
    )
      return;
    const q = this.currentQuestion!;
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
        payload
      )
      .subscribe({
        next: (res) => {
          if (res.status === 'success' && res.completed) {
            this.isAnswerCorrect = true;
            this.feedbackMessage = 'Correct! ' + (res.message || 'Well done.');
            q.completed = true;
            q.wrongAttempt = false;
            this.markCompleted(q.id);
          } else {
            this.isAnswerCorrect = false;
            this.feedbackMessage =
              'Incorrect. ' + (res.message || 'Try again or skip.');
            /* after */
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
    this.checkInProgress = true;
    this.showFeedback = true;
    this.feedbackMessage = 'Checking your answer…';

    this.labSv
      .checkQuestion(
        this.labId,
        this.moduleUuid!,
        this.lessonUuid!,
        questionNumber
      )
      .subscribe({
        next: (res) => {
          if (res.status === 'success' && res.completed) {
            this.isAnswerCorrect = true;
            this.feedbackMessage =
              'Correct! ' + (res.message || 'All tests passed.');
            q.completed = true;
            q.wrongAttempt = false;
            this.markCompleted(questionNumber);
          } else {
            this.isAnswerCorrect = false;
            this.feedbackMessage =
              res.message || 'Not yet correct. Try again or skip.';
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
      this.feedbackMessage = ''; /* keep q.wrongAttempt true for Skip */
    }
    this.selectedOption = i;
  }

  /* ─── Completion / state persistence ─────────────── */
  private markCompleted(id: number): void {
    this.saveQuestionState();
  }

  private saveQuestionState(): void {
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
  }
  private restoreQuestionState(): void {
    const raw = sessionStorage.getItem(this.qStateKey);
    if (!raw) return;
    try {
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
    } catch {
      /* ignore */
    }
  }
  public initializeNewLab(): void {
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
          sessionStorage.removeItem('activeLabId');
          sessionStorage.removeItem(this.qStateKey);
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
  @HostListener('window:resize') onResize() {
    this.adjustIframe();
  }
  private adjustIframe(): void {
    if (!this.isLabActive) return;
    const frame = this.el.nativeElement.querySelector('.code-server-iframe');
    if (frame) {
      frame.style.height = '100%';
    }
  }
  getCompletedQuestionsCount(): number {
    return this.questions.filter((q) => q.completed).length;
  }
  get showApiBanner(): boolean {
    return (
      this.lostConnectionCount >= 3 && // 3 × 10-sec polls ≈ 30 s offline
      this.isLabActive && // lab is running
      !this.isInitializing && // not in init
      !this.isLoading // not in global spinner
    );
  }
}
