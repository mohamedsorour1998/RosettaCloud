import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { MomentoService } from './momento.service';

@Injectable({
  providedIn: 'root',
})
export class FeedbackService {
  private apiUrl =
    environment.feedbackApiUrl || 'https://api.dev.rosettacloud.app';
  private feedbackId: string | null = null;

  // Subject to broadcast feedback when received from Momento
  private feedbackReceivedSubject = new Subject<any>();
  public feedbackReceived$ = this.feedbackReceivedSubject.asObservable();

  constructor(
    private http: HttpClient,
    private momentoService: MomentoService
  ) {}

  /**
   * Request feedback from the API
   * @param userId User ID
   * @param moduleUuid Module UUID
   * @param lessonUuid Lesson UUID
   * @param questions Questions data
   * @param userProgress User progress data
   * @returns Observable of the feedback request response
   */
  public requestFeedback(
    userId: string,
    moduleUuid: string,
    lessonUuid: string,
    questions: any[],
    userProgress: any
  ): Observable<any> {
    // Generate a unique feedback ID
    this.feedbackId = this.momentoService.generateFeedbackId();

    // Prepare request payload
    const payload = {
      user_id: userId,
      module_uuid: moduleUuid,
      lesson_uuid: lessonUuid,
      feedback_id: this.feedbackId, // Include feedback_id in the request
      questions: questions,
      progress: userProgress,
    };

    // Subscribe to Momento for this feedback ID
    this.setupMomentoSubscription(userId, this.feedbackId);

    // Send request to API
    return new Observable((observer) => {
      this.http
        .post<any>(`${this.apiUrl}/feedback/request`, payload)
        .subscribe({
          next: (response) => {
            console.log('Feedback request successful:', response);
            observer.next({
              ...response,
              feedback_id: this.feedbackId,
            });
            observer.complete();
          },
          error: (err) => {
            console.error('Error requesting feedback:', err);
            observer.error(err);
          },
        });
    });
  }

  /**
   * Set up subscription to Momento for feedback updates
   * @param userId User ID for token request
   * @param feedbackId The feedback ID to filter messages by
   */
  private async setupMomentoSubscription(
    userId: string,
    feedbackId: string
  ): Promise<void> {
    try {
      console.log(
        `Setting up Momento subscription for feedback ID: ${feedbackId}`
      );

      // Get token from vending endpoint
      const token = await this.momentoService.getToken(userId);
      console.log('Received Momento token');

      // Initialize Momento client with token
      this.momentoService.initializeClient(token);
      console.log('Momento client initialized');

      // Subscribe to topic for this feedback ID
      const success = await this.momentoService.subscribe(
        feedbackId,
        // Message handler
        (data) => {
          console.log('Received feedback message:', data);
          // Extract feedback content from the response
          const content = data.content || data.feedback || JSON.stringify(data);
          this.feedbackReceivedSubject.next(content);
        },
        // Error handler
        async (error) => {
          if (error.type === 'token_expired') {
            console.log('Token expired, refreshing...');
            // Clean up existing subscription
            this.momentoService.unsubscribe();

            // Try again with a new token
            await this.setupMomentoSubscription(userId, feedbackId);
          }
        }
      );

      if (success) {
        console.log('Successfully subscribed to Momento topic');
      } else {
        console.error('Failed to subscribe to Momento topic');
      }
    } catch (error) {
      console.error('Error setting up Momento subscription:', error);
    }
  }

  /**
   * Connect to WebSocket (keeping for backward compatibility)
   */
  public connectToFeedbackWebSocket(): void {
    // This method is intentionally left empty as we're now using Momento directly
    console.log('Using Momento for real-time updates instead of WebSocket');
  }

  /**
   * Disconnect from WebSocket (keeping for backward compatibility)
   */
  public disconnectFromFeedbackWebSocket(): void {
    // Clean up Momento subscription instead
    this.momentoService.unsubscribe();
    this.feedbackId = null;
  }
}
