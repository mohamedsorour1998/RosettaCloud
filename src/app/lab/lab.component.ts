import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, BehaviorSubject, interval, Subscription } from 'rxjs';
import { map, switchMap, tap, catchError } from 'rxjs/operators';
import { LabService } from '../services/lab.service';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { LabInfo, Question } from '../../models/lab.interfaces';

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

  isLoading = true;
  isInitializing = true;
  isLabActive = false;
  errorMessage: string | null = null;
  timeRemaining$ = new BehaviorSubject<string>('');

  moduleUuid: string | null = null;
  lessonUuid: string | null = null;

  private timerSubscription: Subscription | null = null;
  private pollingSubscription: Subscription | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private labService: LabService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.moduleUuid = this.route.snapshot.paramMap.get('moduleUuid');
    this.lessonUuid = this.route.snapshot.paramMap.get('lessonUuid');

    if (!this.moduleUuid || !this.lessonUuid) {
      this.errorMessage = 'Module or lesson information is missing';
      this.isLoading = false;
      return;
    }

    this.labService
      .getActiveLabForUser()
      .pipe(
        catchError(() => {
          return this.initializeNewLab();
        })
      )
      .subscribe();
  }

  public initializeNewLab(): Observable<any> {
    const userId = this.labService.getCurrentUserId();
    this.isInitializing = true;

    return this.labService.launchLab(userId).pipe(
      tap((response) => {
        if (response && response.lab_id) {
          this.labId = response.lab_id;
          this.startLabPolling();
          this.loadQuestions();
        } else {
          this.errorMessage = 'Failed to create lab';
          this.isLoading = false;
        }
      }),
      catchError((error) => {
        this.errorMessage = `Error creating lab: ${
          error.error?.detail || 'Unknown error'
        }`;
        this.isLoading = false;
        return [];
      })
    );
  }

  private startLabPolling(): void {
    if (!this.labId) return;

    // Poll lab status every 10 seconds
    this.pollingSubscription = interval(10000)
      .pipe(
        switchMap(() => this.labService.getLabInfo(this.labId!)),
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

  private handleLabInfoUpdate(info: LabInfo): void {
    if (!info) {
      this.errorMessage = 'Lab not found';
      this.isLoading = false;
      return;
    }

    this.labInfo$.next(info);

    if (info.status === 'running' && info.pod_ip) {
      // Set lab as active and create the code server URL
      this.isLabActive = true;
      this.codeServerUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
        `http://${info.pod_ip}/`

      );
      this.isLoading = false;
      this.isInitializing = false;

      // Start countdown timer
      if (info.time_remaining) {
        this.updateTimeRemaining(info.time_remaining);
        this.startCountdownTimer(info.time_remaining);
      }
    } else if (info.status === 'pending') {
      // Lab is still initializing
      this.isInitializing = true;
    } else if (info.status === 'error') {
      this.errorMessage = 'Lab encountered an error';
      this.isLoading = false;
    }
  }

  private loadQuestions(): void {
    if (!this.moduleUuid || !this.lessonUuid) return;

    this.labService.getQuestions(this.moduleUuid, this.lessonUuid).subscribe(
      (data) => {
        if (data && data.questions) {
          this.questions = data.questions.map((q: any, index: number) => ({
            id: index + 1,
            question: q.question,
            description: q.description || '',
            completed: false,
          }));
        }
      },
      (error) => {
        console.error('Error loading questions:', error);
      }
    );
  }

  setupQuestion(questionNumber: number): void {
    if (!this.labId) return;

    const podName = this.labId; // Assuming pod name is the same as lab ID

    this.labService
      .setupQuestion(
        podName,
        this.moduleUuid!,
        this.lessonUuid!,
        questionNumber
      )
      .subscribe(
        (result) => {
          if (result.status === 'success') {
            this.currentQuestionIndex = questionNumber - 1;
          } else {
            console.error('Question setup failed:', result.message);
          }
        },
        (error) => {
          console.error('Error setting up question:', error);
        }
      );
  }

  checkQuestion(questionNumber: number): void {
    if (!this.labId) return;

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
            }
          }
        },
        (error) => {
          console.error('Error checking question:', error);
        }
      );
  }

  terminateLab(): void {
    if (!this.labId) return;

    const userId = this.labService.getCurrentUserId();
    this.isLoading = true;

    this.labService.terminateLab(this.labId, userId).subscribe(
      () => {
        this.router.navigate(['/dashboard']);
      },
      (error) => {
        this.errorMessage = `Error terminating lab: ${error.message}`;
        this.isLoading = false;
      }
    );
  }

  private updateTimeRemaining(timeRemaining: {
    hours: number;
    minutes: number;
    seconds: number;
  }): void {
    const { hours, minutes, seconds } = timeRemaining;
    const formattedTime = `${hours}h ${minutes}m ${seconds}s`;
    this.timeRemaining$.next(formattedTime);
  }

  private startCountdownTimer(initialTime: {
    hours: number;
    minutes: number;
    seconds: number;
  }): void {
    // Clear any existing timer
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
    }

    // Calculate total seconds
    let totalSeconds =
      initialTime.hours * 3600 + initialTime.minutes * 60 + initialTime.seconds;

    // Create a timer that updates every second
    this.timerSubscription = interval(1000).subscribe(() => {
      totalSeconds--;

      if (totalSeconds <= 0) {
        this.timeRemaining$.next('Expired');
        if (this.timerSubscription) {
          this.timerSubscription.unsubscribe();
        }
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

    // Optionally auto-terminate the lab
    if (this.labId && this.isLabActive) {
      const userId = this.labService.getCurrentUserId();
      this.labService.terminateLab(this.labId, userId).subscribe(
        () => console.log('Lab terminated on component destruction'),
        (error) => console.error('Error terminating lab on destroy:', error)
      );
    }
  }
}
