import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, BehaviorSubject, interval, Subscription, of } from 'rxjs';
import {
  map,
  switchMap,
  tap,
  catchError,
  filter,
  delay,
  retryWhen,
  take,
} from 'rxjs/operators';
import { LabService } from '../services/lab.service';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

// Enhanced Question interface
interface Question {
  id: number;
  question: string;
  description: string;
  completed: boolean;
  visited: boolean;
}

// Enhanced LabInfo interface
interface LabInfo {
  lab_id: string;
  pod_ip: string | null;
  time_remaining: {
    hours: number;
    minutes: number;
    seconds: number;
  } | null;
  status: string;
}

@Component({
  selector: 'app-lab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './lab.component.html',
  styleUrls: ['./lab.component.scss'],
})
export class LabComponent implements OnInit, OnDestroy {
  labId: string | null = null;
  labInfo$ = new BehaviorSubject<LabInfo | null>(null);
  codeServerUrl: SafeResourceUrl | null = null;

  questions: Question[] = [];
  currentQuestionIndex = 0;
  get currentQuestion(): Question | null {
    return this.questions[this.currentQuestionIndex] || null;
  }

  isLoading = true;
  isInitializing = true;
  isLabActive = false;
  isApiConnected = true;
  errorMessage: string | null = null;
  timeRemaining$ = new BehaviorSubject<string>('');

  moduleUuid: string | null = null;
  lessonUuid: string | null = null;

  private timerSubscription: Subscription | null = null;
  private pollingSubscription: Subscription | null = null;
  private apiStatusSubscription: Subscription | null = null;
  private questionStateKey = 'lab-question-state';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private labService: LabService,
    private sanitizer: DomSanitizer,
    private el: ElementRef
  ) {}

  ngOnInit(): void {
    // Monitor API connection status
    this.apiStatusSubscription = this.labService.connectionStatus$.subscribe(
      (isConnected) => {
        this.isApiConnected = isConnected;
        // Only show error if not connected and no active lab is running
        if (!isConnected && !this.isLabActive) {
          this.errorMessage =
            'Connection to lab service unavailable. Please check your network.';
        } else if (
          isConnected &&
          this.errorMessage ===
            'Connection to lab service unavailable. Please check your network.'
        ) {
          this.errorMessage = null;
        }
      }
    );

    this.moduleUuid = this.route.snapshot.paramMap.get('moduleUuid');
    this.lessonUuid = this.route.snapshot.paramMap.get('lessonUuid');

    if (!this.moduleUuid || !this.lessonUuid) {
      this.errorMessage = 'Module or lesson information is missing';
      this.isLoading = false;
      return;
    }

    this.initializeLab();
  }

  // Initialize lab - either reuse an existing one or create a new one
  private initializeLab(): void {
    // Check for lab ID in session storage first (for persistence after page refresh)
    const storedLabId = sessionStorage.getItem('activeLabId');

    // Try to restore saved question state
    this.restoreQuestionState();

    if (storedLabId) {
      this.labId = storedLabId;
      this.loadLabInfo(storedLabId);
      return;
    }

    // If no stored lab ID, check for active lab
    this.labService
      .getActiveLabForUser()
      .pipe(
        tap((labId) => {
          this.labId = labId;
          sessionStorage.setItem('activeLabId', labId);
          this.loadLabInfo(labId);
        }),
        catchError(() => {
          return this.initializeNewLab();
        })
      )
      .subscribe();
  }

  private loadLabInfo(labId: string): void {
    this.startLabPolling();
    this.loadQuestions();
  }

  // Initialize a new lab
  public initializeNewLab(): Observable<any> {
    const userId = this.labService.getCurrentUserId();
    this.isInitializing = true;
    this.errorMessage = null;

    return this.labService.launchLab(userId).pipe(
      tap((response) => {
        if (response && response.lab_id) {
          this.labId = response.lab_id;
          sessionStorage.setItem('activeLabId', response.lab_id);
          this.startLabPolling();
          this.loadQuestions();
        } else {
          this.errorMessage = 'Failed to create lab';
          this.isLoading = false;
        }
      }),
      catchError((error) => {
        this.errorMessage = `Error creating lab: ${
          error.message || 'Unknown error'
        }`;
        this.isLoading = false;
        return of(null);
      })
    );
  }

  // Start polling for lab status updates
  private startLabPolling(): void {
    if (!this.labId) return;

    // Stop any existing polling
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
    }

    // Poll lab status every 10 seconds
    this.pollingSubscription = interval(10000)
      .pipe(
        filter(() => this.isApiConnected), // Only poll if API is connected
        switchMap(() => this.labService.getLabInfo(this.labId!)),
        retryWhen((errors) => errors.pipe(delay(2000), take(3))),
        tap((info) => this.handleLabInfoUpdate(info))
      )
      .subscribe();

    // Get initial lab info immediately
    this.labService.getLabInfo(this.labId).subscribe(
      (info) => this.handleLabInfoUpdate(info),
      (error) => {
        this.errorMessage = `Error retrieving lab information: ${error.message}`;
        this.isLoading = false;
      }
    );
  }

  // Handle lab info updates
  private handleLabInfoUpdate(info: LabInfo): void {
    if (!info) {
      this.errorMessage = 'Lab not found';
      this.isLoading = false;
      return;
    }

    this.labInfo$.next(info);

    if (info.status === 'running' && info.pod_ip) {
      // Lab is running, prepare the UI
      try {
        // Ensure proper URL formatting
        const labUrl = info.pod_ip.includes('://')
          ? info.pod_ip
          : `https://${info.pod_ip}/`;
        this.codeServerUrl =
          this.sanitizer.bypassSecurityTrustResourceUrl(labUrl);
        this.isLabActive = true;
        this.isLoading = false;
        this.isInitializing = false;
      } catch (error) {
        console.error('Error creating code server URL:', error);
        this.errorMessage = 'Failed to load lab environment';
        this.isLoading = false;
      }

      // Start countdown timer if we have time remaining info
      if (info.time_remaining) {
        this.updateTimeRemaining(info.time_remaining);
        this.startCountdownTimer(info.time_remaining);
      } else {
        this.timeRemaining$.next('Time unknown');
      }
    } else if (info.status === 'pending') {
      // Lab is still initializing
      this.isInitializing = true;
      this.isLoading = true;
    } else if (info.status === 'error') {
      this.errorMessage = 'Lab encountered an error during initialization';
      this.isLoading = false;
      this.isInitializing = false;
    } else if (info.status === 'terminated') {
      this.errorMessage = 'Lab has been terminated';
      this.isLoading = false;
      this.isInitializing = false;
      this.isLabActive = false;
    }
  }

  // Load questions for the current module/lesson
  private loadQuestions(): void {
    if (!this.moduleUuid || !this.lessonUuid) return;

    this.labService.getQuestions(this.moduleUuid, this.lessonUuid).subscribe(
      (data) => {
        if (data && data.questions) {
          this.questions = data.questions.map((q: any, index: number) => ({
            id: index + 1,
            question: q.question || `Question ${index + 1}`,
            description: q.description || 'No description available',
            completed: false,
            visited: false, // Track if the question has been visited
          }));

          // Try to restore saved question state
          this.restoreQuestionState();

          // Select first question if available
          if (this.questions.length > 0 && this.labId) {
            this.setupQuestion(1);
          }
        }
      },
      (error) => {
        console.error('Error loading questions:', error);
      }
    );
  }

  // Navigate to previous question
  navigateToPrevQuestion(): void {
    if (this.currentQuestionIndex > 0) {
      this.setupQuestion(this.currentQuestionIndex);
    }
  }

  // Navigate to next question
  navigateToNextQuestion(): void {
    if (this.currentQuestionIndex < this.questions.length - 1) {
      this.setupQuestion(this.currentQuestionIndex + 2);
    }
  }

  // Navigate to specific question
  navigateToQuestion(questionNumber: number): void {
    if (questionNumber >= 1 && questionNumber <= this.questions.length) {
      this.setupQuestion(questionNumber);
    }
  }

  // Setup a question
  setupQuestion(questionNumber: number): void {
    if (!this.labId || !this.isLabActive) return;

    const podName = this.labId; // Assuming pod name is the same as lab ID

    // Update UI first for responsive feel
    this.currentQuestionIndex = questionNumber - 1;

    // Mark current question as visited
    if (this.questions[this.currentQuestionIndex]) {
      this.questions[this.currentQuestionIndex].visited = true;
      this.saveQuestionState();
    }

    this.labService
      .setupQuestion(
        podName,
        this.moduleUuid!,
        this.lessonUuid!,
        questionNumber
      )
      .subscribe(
        (result) => {
          if (result.status !== 'success') {
            console.error('Question setup failed:', result.message);
          }
        },
        (error) => {
          console.error('Error setting up question:', error);
        }
      );
  }

  // Check a question
  checkQuestion(questionNumber: number): void {
    if (!this.labId || !this.isLabActive) return;

    const podName = this.labId;

    this.labService
      .checkQuestion(
        podName,
        this.moduleUuid!,
        this.lessonUuid!,
        questionNumber
      )
      .subscribe(
        (result) => {
          if (result.status === 'success' && result.completed) {
            if (this.questions[questionNumber - 1]) {
              this.questions[questionNumber - 1].completed = true;
              this.saveQuestionState();
            }
          }
        },
        (error) => {
          console.error('Error checking question:', error);
        }
      );
  }

  // Save question state to session storage
  private saveQuestionState(): void {
    if (!this.questions || !this.questions.length) return;

    const questionState = {
      currentIndex: this.currentQuestionIndex,
      questions: this.questions.map((q) => ({
        completed: q.completed,
        visited: q.visited,
      })),
    };

    sessionStorage.setItem(
      this.questionStateKey,
      JSON.stringify(questionState)
    );
  }

  // Restore question state from session storage
  private restoreQuestionState(): void {
    const savedState = sessionStorage.getItem(this.questionStateKey);
    if (!savedState) return;

    try {
      const state = JSON.parse(savedState);

      // Only restore if we have questions loaded
      if (this.questions && this.questions.length) {
        this.currentQuestionIndex = state.currentIndex || 0;

        // Update saved state for each question
        state.questions.forEach((savedQ: any, index: number) => {
          if (index < this.questions.length) {
            this.questions[index].completed = savedQ.completed || false;
            this.questions[index].visited = savedQ.visited || false;
          }
        });
      }
    } catch (e) {
      console.error('Error restoring question state:', e);
    }
  }

  // Terminate the lab
  terminateLab(): void {
    if (!this.labId) return;

    const userId = this.labService.getCurrentUserId();
    this.isLoading = true;
    this.errorMessage = null;

    this.labService.terminateLab(this.labId, userId).subscribe(
      () => {
        // Clean up session storage
        sessionStorage.removeItem('activeLabId');
        sessionStorage.removeItem(this.questionStateKey);
        this.router.navigate(['/dashboard']);
      },
      (error) => {
        this.errorMessage = `Error terminating lab: ${error.message}`;
        this.isLoading = false;
      }
    );
  }

  // Update time remaining display
  private updateTimeRemaining(timeRemaining: {
    hours: number;
    minutes: number;
    seconds: number;
  }): void {
    if (!timeRemaining) {
      this.timeRemaining$.next('Time unavailable');
      return;
    }

    const hours = timeRemaining.hours || 0;
    const minutes = timeRemaining.minutes || 0;
    const seconds = timeRemaining.seconds || 0;

    // Check for NaN values
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
      this.timeRemaining$.next('Time unavailable');
      return;
    }

    const formattedTime = `${hours}h ${minutes}m ${seconds}s`;
    this.timeRemaining$.next(formattedTime);
  }

  // Start countdown timer
  private startCountdownTimer(initialTime: {
    hours: number;
    minutes: number;
    seconds: number;
  }): void {
    // Clear any existing timer
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
    }

    // Validate time values
    const hours = initialTime?.hours || 0;
    const minutes = initialTime?.minutes || 0;
    const seconds = initialTime?.seconds || 0;

    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
      this.timeRemaining$.next('Timer error');
      return;
    }

    // Calculate total seconds
    let totalSeconds = hours * 3600 + minutes * 60 + seconds;

    // Create a timer that updates every second
    this.timerSubscription = interval(1000).subscribe(() => {
      totalSeconds--;

      if (totalSeconds <= 0) {
        this.timeRemaining$.next('Expired');
        if (this.timerSubscription) {
          this.timerSubscription.unsubscribe();
        }
        // Optionally auto-terminate when expired
        // this.terminateLab();
        return;
      }

      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      this.updateTimeRemaining({ hours, minutes, seconds });
    });
  }

  // Handle iframe scrolling
  @HostListener('window:scroll', ['$event'])
  onWindowScroll(event: Event): void {
    // When lab is active, ensure iframe content is visible
    if (this.isLabActive && this.codeServerUrl) {
      const frameElement = this.el.nativeElement.querySelector(
        '.code-server-iframe'
      );
      if (frameElement) {
        // Adjust iframe height to match available window height
        const windowHeight = window.innerHeight;
        const frameTop = frameElement.getBoundingClientRect().top;
        const headerHeight =
          this.el.nativeElement.querySelector('.lab-header')?.offsetHeight || 0;
        const availableHeight = windowHeight - frameTop - 20; // 20px buffer

        frameElement.style.height = `${availableHeight}px`;
      }
    }
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
    }

    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
    }

    if (this.apiStatusSubscription) {
      this.apiStatusSubscription.unsubscribe();
    }

    // We don't auto-terminate on component destruction
    // because the user might just be navigating away temporarily
    // and we want the lab to continue running for when they return
  }
}
