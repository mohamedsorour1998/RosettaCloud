import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  ElementRef,
  AfterViewInit,
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
  type: 'mcq' | 'check'; // Fixed types: mcq or check
  options?: string[]; // For MCQ questions
  correctAnswer?: string; // Correct answer for MCQ
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
export class LabComponent implements OnInit, OnDestroy, AfterViewInit {
  labId: string | null = null;
  labInfo$ = new BehaviorSubject<LabInfo | null>(null);
  codeServerUrl: SafeResourceUrl | null = null;

  questions: Question[] = [];
  currentQuestionIndex = 0;
  get currentQuestion(): Question | null {
    return this.questions[this.currentQuestionIndex] || null;
  }

  // Properties for enhanced UI
  selectedOption: number | null = null;
  showFeedback = false;
  feedbackMessage = '';
  isAnswerCorrect = false;
  checkInProgress = false;

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

  ngAfterViewInit(): void {
    // Set iframe properly after view initialization
    setTimeout(() => {
      this.adjustIframeHeight();
    }, 500);
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

        // Adjust iframe height
        setTimeout(() => {
          this.adjustIframeHeight();
        }, 500);
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
        console.log('Questions from API:', data);

        if (data && data.questions) {
          // Process questions from API response - FIXED: proper type mapping
          this.questions = data.questions.map((q: any) => {
            console.log('Processing question:', q); // Debug log

            // Basic question properties
            const questionObj: Question = {
              id: q.question_number,
              question: q.question,
              // Make sure we're correctly identifying question types
              type: q.question_type?.toUpperCase() === 'MCQ' ? 'mcq' : 'check',
              completed: false,
              visited: false,
            };

            // Add options only for MCQ type questions
            if (q.question_type?.toUpperCase() === 'MCQ') {
              questionObj.options = q.answer_choices || [];
              questionObj.correctAnswer = q.correct_answer;
            }

            console.log('Processed to:', questionObj); // Debug log
            return questionObj;
          });

          console.log('Processed questions:', this.questions);

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
      this.resetQuestionUI();
      this.setupQuestion(this.currentQuestionIndex);
    }
  }

  // Navigate to next question
  navigateToNextQuestion(): void {
    if (this.currentQuestionIndex < this.questions.length - 1) {
      this.resetQuestionUI();
      this.setupQuestion(this.currentQuestionIndex + 2);
    }
  }

  // Navigate to specific question
  navigateToQuestion(questionNumber: number): void {
    if (questionNumber >= 1 && questionNumber <= this.questions.length) {
      this.resetQuestionUI();
      this.setupQuestion(questionNumber);
    }
  }

  // Reset question UI state when changing questions
  private resetQuestionUI(): void {
    this.selectedOption = null;
    this.showFeedback = false;
    this.feedbackMessage = '';
    this.isAnswerCorrect = false;
  }

  // Setup a question
  setupQuestion(questionNumber: number): void {
    if (!this.labId || !this.isLabActive) return;

    const podName = this.labId; // Assuming pod name is the same as lab ID

    // Reset UI state when changing questions
    this.resetQuestionUI();

    // Update UI first for responsive feel
    this.currentQuestionIndex = questionNumber - 1;

    // Mark current question as visited
    if (this.questions[this.currentQuestionIndex]) {
      this.questions[this.currentQuestionIndex].visited = true;
      this.saveQuestionState();

      // Scroll to the top of the question detail area to show buttons
      setTimeout(() => {
        const questionDetails = document.querySelector('.question-details');
        if (questionDetails) {
          questionDetails.scrollTop = 0;
        }
      }, 100);
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

  // Check answer for MCQ questions
  checkAnswer(): void {
    if (!this.labId || !this.isLabActive || this.checkInProgress) return;

    this.checkInProgress = true;

    // For questions with options (MCQ type)
    if (
      this.currentQuestion?.type === 'mcq' &&
      this.selectedOption !== null &&
      this.currentQuestion.options
    ) {
      this.showFeedback = true;

      // Send request to check MCQ answer
      const questionNumber = this.currentQuestionIndex + 1;
      const podName = this.labId;

      this.feedbackMessage = 'Checking your answer...';

      // Get the selected answer text
      const selectedAnswer = this.currentQuestion.options[this.selectedOption];
      console.log('Selected answer:', selectedAnswer);

      this.labService
        .checkQuestion(
          podName,
          this.moduleUuid!,
          this.lessonUuid!,
          questionNumber,
          { selected_answer: selectedAnswer }
        )
        .subscribe(
          (result) => {
            console.log('Check answer result:', result);

            if (result.status === 'success' && result.completed) {
              this.isAnswerCorrect = true;
              this.feedbackMessage =
                'Correct! ' + (result.message || 'Well done.');
              this.markQuestionAsCompleted(questionNumber);
            } else {
              this.isAnswerCorrect = false;
              this.feedbackMessage =
                'Incorrect. ' +
                (result.message || 'Try again or skip to continue.');
            }
            this.checkInProgress = false;
          },
          (error) => {
            console.error('Error checking question:', error);
            this.feedbackMessage =
              'Error checking your answer. Please try again.';
            this.checkInProgress = false;
            this.isAnswerCorrect = false;
          }
        );
    }
  }

  // Check a code-based question (now used for "Check" type questions)
  checkQuestion(questionNumber: number): void {
    if (!this.labId || !this.isLabActive || this.checkInProgress) return;

    this.checkInProgress = true;
    const podName = this.labId;
    this.showFeedback = true;
    this.feedbackMessage = 'Checking your answer...';

    this.labService
      .checkQuestion(
        podName,
        this.moduleUuid!,
        this.lessonUuid!,
        questionNumber
      )
      .subscribe(
        (result) => {
          console.log('Check question result:', result);

          if (result.status === 'success' && result.completed) {
            this.feedbackMessage =
              'Correct! ' +
              (result.message || 'Your solution passes all tests.');
            this.isAnswerCorrect = true;
            this.markQuestionAsCompleted(questionNumber);
          } else {
            this.feedbackMessage =
              result.message ||
              "Your solution doesn't pass all tests yet. Try again or skip.";
            this.isAnswerCorrect = false;
          }
          this.checkInProgress = false;
        },
        (error) => {
          console.error('Error checking question:', error);
          this.feedbackMessage =
            'Error checking your answer. Please try again.';
          this.checkInProgress = false;
          this.isAnswerCorrect = false;
        }
      );
  }

  // Mark a question as completed
  private markQuestionAsCompleted(questionNumber: number): void {
    if (this.questions[questionNumber - 1]) {
      this.questions[questionNumber - 1].completed = true;
      this.saveQuestionState();
    }
  }

  // Reset the current question attempt
  resetQuestion(): void {
    this.showFeedback = false;
    this.feedbackMessage = '';
    this.selectedOption = null;
    this.isAnswerCorrect = false;
  }

  // Set the selected option for multiple choice questions
  setSelectedOption(index: number): void {
    if (this.showFeedback) return; // Don't allow changing after feedback is shown
    this.selectedOption = index;
  }

  // Get the count of completed questions
  getCompletedQuestionsCount(): number {
    return this.questions.filter((q) => q.completed).length;
  }

  // Helper method to adjust iframe height
  private adjustIframeHeight(): void {
    if (this.isLabActive && this.codeServerUrl) {
      const frameElement = this.el.nativeElement.querySelector(
        '.code-server-iframe'
      );
      if (frameElement) {
        // Set fixed height to prevent scrolling issues
        frameElement.style.height = '100%';
        frameElement.style.width = '100%';
      }
    }
  }

  // Handle iframe sizing on window resize
  @HostListener('window:resize', ['$event'])
  onWindowResize(event: Event): void {
    this.adjustIframeHeight();
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
