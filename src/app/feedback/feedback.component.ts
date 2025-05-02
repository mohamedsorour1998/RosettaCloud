import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FeedbackService } from '../services/feedback.service';
import { UserService } from '../services/user.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-feedback',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feedback.component.html',
  styleUrls: ['./feedback.component.scss'],
})
export class FeedbackComponent implements OnInit, OnDestroy {
  @Input() moduleUuid!: string;
  @Input() lessonUuid!: string;
  @Input() questions!: any[];
  @Input() userProgress: any = {};

  feedback: string | null = null;
  feedbackRequested = false;
  loading = false;

  private feedbackSubscription?: Subscription;

  get feedbackParagraphs(): string[] {
    return this.feedback
      ? this.feedback.split('\n\n').filter((p) => p.trim())
      : [];
  }

  constructor(
    private feedbackService: FeedbackService,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    // Connect to the feedback WebSocket when component initializes
    this.feedbackService.connectToFeedbackWebSocket();

    // Subscribe to feedback updates
    this.feedbackSubscription =
      this.feedbackService.feedbackReceived$.subscribe((feedback) => {
        this.feedback = feedback;
        this.loading = false;
      });
  }

  ngOnDestroy(): void {
    // Clean up subscription
    this.feedbackSubscription?.unsubscribe();

    // Disconnect from WebSocket
    this.feedbackService.disconnectFromFeedbackWebSocket();
  }

  requestFeedback(): void {
    this.loading = true;
    this.feedbackRequested = true;

    const userId = this.userService.getCurrentUserId() || 'guest';

    this.feedbackService
      .requestFeedback(
        userId,
        this.moduleUuid,
        this.lessonUuid,
        this.questions,
        this.userProgress
      )
      .subscribe({
        error: (err) => {
          console.error('Error requesting feedback:', err);
          this.loading = false;
          // Could add error handling here
        },
      });
  }

  saveFeedback(): void {
    if (!this.feedback) return;

    // Save feedback to local storage or to backend
    const feedbackData = {
      moduleUuid: this.moduleUuid,
      lessonUuid: this.lessonUuid,
      feedback: this.feedback,
      timestamp: new Date().toISOString(),
    };

    // Get existing saved feedback or initialize empty array
    const savedFeedback = JSON.parse(
      localStorage.getItem('savedFeedback') || '[]'
    );
    savedFeedback.push(feedbackData);
    localStorage.setItem('savedFeedback', JSON.stringify(savedFeedback));

    alert('Feedback saved successfully!');
  }

  closeFeedback(): void {
    // Reset component state to allow requesting feedback again
    this.feedbackRequested = false;
    this.feedback = null;
  }
}
