// feedback.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class FeedbackService {
  private apiUrl =
    environment.feedbackApiUrl || 'https://api.rosettacloud.example.com';
  private webSocketUrl =
    environment.feedbackWebSocketUrl || 'wss://ws.rosettacloud.example.com';
  private socket: WebSocket | null = null;
  private requestId: string | null = null;

  // Subject to broadcast feedback when received from WebSocket
  private feedbackReceivedSubject = new Subject<string>();
  public feedbackReceived$ = this.feedbackReceivedSubject.asObservable();

  constructor(private http: HttpClient) {}

  // Connect to the feedback WebSocket
  public connectToFeedbackWebSocket(): void {
    if (this.socket) {
      // Already connected
      return;
    }

    this.socket = new WebSocket(this.webSocketUrl);

    this.socket.onopen = () => {
      console.log('WebSocket connection established');

      // If we have a requestId, send it to subscribe
      if (this.requestId) {
        this.subscribeToFeedback(this.requestId);
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data);

        // Check if this is feedback for our request
        if (
          data &&
          data.type === 'feedback' &&
          data.request_id === this.requestId
        ) {
          // Broadcast the feedback to subscribers
          this.feedbackReceivedSubject.next(data.content);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.socket.onclose = () => {
      console.log('WebSocket connection closed');
      this.socket = null;
    };
  }

  // Subscribe to feedback updates for a specific request
  private subscribeToFeedback(requestId: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error('Cannot subscribe: WebSocket not connected');
      return;
    }

    this.socket.send(
      JSON.stringify({
        action: 'subscribe',
        request_id: requestId,
      })
    );
  }

  // Disconnect from the WebSocket
  public disconnectFromFeedbackWebSocket(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.requestId = null;
    }
  }

  // Request feedback from the API
  public requestFeedback(
    userId: string,
    moduleUuid: string,
    lessonUuid: string,
    questions: any[],
    userProgress: any
  ): Observable<any> {
    const payload = {
      user_id: userId,
      module_uuid: moduleUuid,
      lesson_uuid: lessonUuid,
      questions: questions,
      progress: userProgress,
    };

    return new Observable((observer) => {
      this.http
        .post<any>(`${this.apiUrl}/feedback/request`, payload)
        .subscribe({
          next: (response) => {
            // Store the request ID for WebSocket subscription
            this.requestId = response.request_id;

            // If WebSocket is already connected, subscribe to this request
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
              if (this.requestId) {
                this.subscribeToFeedback(this.requestId);
              }
            }

            observer.next(response);
            observer.complete();
          },
          error: (err) => {
            observer.error(err);
          },
        });
    });
  }
}
