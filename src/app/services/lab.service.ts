import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { Observable, throwError, of, BehaviorSubject } from 'rxjs';
import { catchError, map, tap, retry, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// API Response Interfaces
export interface LabCreationResponse {
  lab_id: string;
}

export interface TimeRemaining {
  hours: number;
  minutes: number;
  seconds: number;
}

export interface LabInfoResponse {
  lab_id: string;
  pod_ip: string | null;
  time_remaining: TimeRemaining | null;
  status: string;
}

export interface QuestionData {
  question_number: number;
  question: string;
  question_type: 'MCQ' | 'Check';
  question_difficulty: string;
  answer_choices?: string[];
  correct_answer?: string;
}

export interface QuestionsResponse {
  questions: QuestionData[];
  total_count: number;
}

export interface QuestionSetupResponse {
  status: string;
  message: string;
  completed: boolean;
}

export interface QuestionCheckResponse {
  status: string;
  message: string;
  completed: boolean;
}

export interface ErrorResponse {
  error: string;
}

@Injectable({
  providedIn: 'root',
})
export class LabService {
  // Use environment variable with fallback
  private apiUrl = environment.apiUrl || this.getApiUrl();

  // Connection status
  private connectionStatus = new BehaviorSubject<boolean>(true);
  public connectionStatus$ = this.connectionStatus.asObservable();

  // Store active labs in memory to reduce API calls
  private activeLabCache: { [userId: string]: string } = {};

  constructor(private http: HttpClient) {
    // Check initial connection
    this.checkApiConnection();
  }

  // Get API URL dynamically from window location
  private getApiUrl(): string {
    // Fallback to the environment variable or hardcoded default
    return (
      environment.apiUrl ||
      (window as any).__RC_API__ ||
      'http://51.112.10.4:30085' // Updated to your actual API URL
    );
  }

  // Check API connection
  private checkApiConnection(): void {
    this.http
      .get(`${this.apiUrl}/health-check`, {
        headers: this.getHeaders(),
        responseType: 'text',
      })
      .pipe(
        timeout(5000),
        catchError(() => {
          this.connectionStatus.next(false);
          return of('error');
        })
      )
      .subscribe((response) => {
        this.connectionStatus.next(response !== 'error');
      });
  }

  // Get headers with CORS settings
  private getHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  }

  // Get current user ID (replace with your auth service implementation)
  getCurrentUserId(): string {
    // This should be replaced with actual user ID from your auth service
    return localStorage.getItem('userId') || 'user12';
  }

  // Get active lab for current user
  getActiveLabForUser(): Observable<string> {
    const userId = this.getCurrentUserId();

    // Check local cache first
    if (this.activeLabCache[userId]) {
      return of(this.activeLabCache[userId]);
    }

    // Check session storage as fallback for page refreshes
    const storedLabId = sessionStorage.getItem('activeLabId');
    if (storedLabId) {
      this.activeLabCache[userId] = storedLabId;
      return of(storedLabId);
    }

    // API call to check active labs for user
    return this.http
      .get<string>(`${this.apiUrl}/users/${userId}/active-lab`, {
        headers: this.getHeaders(),
      })
      .pipe(
        retry(2),
        tap((labId) => {
          if (labId) {
            this.activeLabCache[userId] = labId;
            // Store in session storage to persist across refreshes
            sessionStorage.setItem('activeLabId', labId);
          }
        }),
        catchError((error: HttpErrorResponse) => {
          if (error.status === 404) {
            // No active lab found, which is fine
            return throwError(() => new Error('No active lab found'));
          }
          return this.handleError(error);
        })
      );
  }

  // Launch a new lab
  launchLab(userId: string): Observable<LabCreationResponse> {
    return this.http
      .post<LabCreationResponse>(
        `${this.apiUrl}/labs`,
        { user_id: userId },
        { headers: this.getHeaders() }
      )
      .pipe(
        retry(1),
        tap((response) => {
          if (response && response.lab_id) {
            this.activeLabCache[userId] = response.lab_id;
            // Store in session storage to persist across refreshes
            sessionStorage.setItem('activeLabId', response.lab_id);
          }
        }),
        catchError(this.handleError)
      );
  }

  // Get lab info
  getLabInfo(labId: string): Observable<LabInfoResponse> {
    return this.http
      .get<LabInfoResponse | ErrorResponse>(`${this.apiUrl}/labs/${labId}`, {
        headers: this.getHeaders(),
      })
      .pipe(
        map((response) => {
          if ('error' in response) {
            throw new Error(response.error);
          }

          // Handle time remaining null values
          const labInfo = response as LabInfoResponse;
          if (labInfo.time_remaining) {
            labInfo.time_remaining = {
              hours: labInfo.time_remaining.hours || 0,
              minutes: labInfo.time_remaining.minutes || 0,
              seconds: labInfo.time_remaining.seconds || 0,
            };
          }

          return labInfo;
        }),
        catchError(this.handleError)
      );
  }

  // Terminate lab
  terminateLab(labId: string, userId: string): Observable<any> {
    return this.http
      .delete(`${this.apiUrl}/labs/${labId}?user_id=${userId}`, {
        headers: this.getHeaders(),
      })
      .pipe(
        tap(() => {
          // Remove from cache when terminated
          delete this.activeLabCache[userId];
          // Remove from session storage
          sessionStorage.removeItem('activeLabId');
        }),
        catchError(this.handleError)
      );
  }

  // Get questions for a module and lesson
  getQuestions(
    moduleUuid: string,
    lessonUuid: string
  ): Observable<QuestionsResponse> {
    const userId = this.getCurrentUserId();
    return this.http
      .get<QuestionsResponse>(
        `${this.apiUrl}/questions/${moduleUuid}/${lessonUuid}?user_id=${userId}`,
        { headers: this.getHeaders() }
      )
      .pipe(
        map((response) => {
          // Log the response to help debug
          console.log('API Questions Response:', response);
          return response;
        }),
        catchError(this.handleError)
      );
  }

  // Setup a question
  setupQuestion(
    podName: string,
    moduleUuid: string,
    lessonUuid: string,
    questionNumber: number
  ): Observable<QuestionSetupResponse> {
    return this.http
      .post<QuestionSetupResponse>(
        `${this.apiUrl}/questions/${moduleUuid}/${lessonUuid}/${questionNumber}/setup`,
        { pod_name: podName },
        { headers: this.getHeaders() }
      )
      .pipe(
        tap((response) => {
          // Log setup response
          console.log(`Setup Question ${questionNumber} Response:`, response);
        }),
        catchError(this.handleError)
      );
  }

  // Check a question
  checkQuestion(
    podName: string,
    moduleUuid: string,
    lessonUuid: string,
    questionNumber: number,
    additionalData?: any
  ): Observable<QuestionCheckResponse> {
    const payload = {
      pod_name: podName,
      ...additionalData,
    };

    // Log the payload we're sending
    console.log(`Checking Question ${questionNumber} with payload:`, payload);

    return this.http
      .post<QuestionCheckResponse>(
        `${this.apiUrl}/questions/${moduleUuid}/${lessonUuid}/${questionNumber}/check`,
        payload,
        { headers: this.getHeaders() }
      )
      .pipe(
        tap((response) => {
          // Log check response
          console.log(`Check Question ${questionNumber} Response:`, response);
        }),
        catchError(this.handleError)
      );
  }

  // Error handling method with improved logging
  private handleError(error: HttpErrorResponse) {
    let errorMessage = 'An unknown error occurred';

    if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `Client Error: ${error.error.message}`;
    } else {
      // Server-side error
      errorMessage = `Server Error: ${error.status} - ${error.message}`;

      // If the server returned a specific error message
      if (error.error && typeof error.error === 'object') {
        if ('detail' in error.error) {
          errorMessage = error.error.detail;
        } else if ('message' in error.error) {
          errorMessage = error.error.message;
        }
      }
    }

    // Log to console with request details
    console.error('API Error:', {
      message: errorMessage,
      status: error.status,
      url: error.url || 'unknown',
      timestamp: new Date().toISOString(),
    });

    // Check if API is unreachable
    if (error.status === 0) {
      this.connectionStatus.next(false);
    }

    return throwError(() => new Error(errorMessage));
  }
}
