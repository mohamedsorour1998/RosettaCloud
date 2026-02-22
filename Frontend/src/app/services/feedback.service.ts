import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class FeedbackService {
  private feedbackApiUrl = environment.feedbackApiUrl;
  private apiUrl = environment.apiUrl;
  private feedbackReceivedSubject = new Subject<any>();
  public feedbackReceived$ = this.feedbackReceivedSubject.asObservable();
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private http: HttpClient) {}

  public requestFeedback(
    userId: string,
    moduleUuid: string,
    lessonUuid: string,
    questions: any[],
    userProgress: any
  ): Observable<any> {
    const feedbackId = 'fb-' + Math.random().toString(36).slice(2, 10);
    const payload = {
      user_id: userId,
      module_uuid: moduleUuid,
      lesson_uuid: lessonUuid,
      feedback_id: feedbackId,
      questions: questions,
      progress: userProgress,
    };

    return new Observable((observer) => {
      this.http
        .post<any>(`${this.feedbackApiUrl}/feedback/request`, payload)
        .subscribe({
          next: (response) => {
            console.log('Feedback request successful:', response);
            observer.next({ ...response, feedback_id: feedbackId });
            observer.complete();
            this.pollForFeedback(feedbackId);
          },
          error: (err) => {
            console.error('Error requesting feedback:', err);
            observer.error(err);
          },
        });
    });
  }

  private pollForFeedback(feedbackId: string): void {
    this.stopPolling();
    const startTime = Date.now();
    const timeoutMs = 60_000;
    const intervalMs = 2_000;

    this.pollingTimer = setInterval(() => {
      if (Date.now() - startTime > timeoutMs) {
        console.warn('Feedback polling timed out for', feedbackId);
        this.stopPolling();
        return;
      }

      this.http
        .get<any>(`${this.apiUrl}/feedback/${feedbackId}`)
        .subscribe({
          next: (res) => {
            if (res.status === 'ready') {
              const content =
                res.content || res.data?.content || JSON.stringify(res.data);
              this.feedbackReceivedSubject.next(content);
              this.stopPolling();
            }
          },
          error: (err) => {
            console.error('Feedback poll error:', err);
          },
        });
    }, intervalMs);
  }

  private stopPolling(): void {
    if (this.pollingTimer !== null) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  public connectToFeedbackWebSocket(): void {
    // No-op: kept for backward compatibility
  }

  public disconnectFromFeedbackWebSocket(): void {
    this.stopPolling();
  }
}
