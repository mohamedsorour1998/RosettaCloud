// lab.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// API Response Interfaces
interface LabCreationResponse {
  lab_id: string;
}

interface LabInfoResponse {
  lab_id: string;
  pod_ip: string | null;
  time_remaining: { hours: number; minutes: number; seconds: number } | null;
  status: string;
}

interface QuestionsResponse {
  questions: any[];
  total_count: number;
}

interface QuestionSetupResponse {
  status: string;
  message: string;
  completed: boolean;
}

interface QuestionCheckResponse {
  status: string;
  message: string;
  completed: boolean;
}

interface ErrorResponse {
  error: string;
}

@Injectable({
  providedIn: 'root',
})
export class LabService {
  private apiUrl = environment.apiUrl || 'http://localhost:8000';

  // Store active labs in memory to reduce API calls
  private activeLabCache: { [userId: string]: string } = {};

  constructor(private http: HttpClient) {}

  // Get current user ID (replace with your auth service implementation)
  getCurrentUserId(): string {
    // This should be replaced with actual user ID from your auth service
    return localStorage.getItem('userId') || 'user123';
  }

  // Get active lab for current user
  getActiveLabForUser(): Observable<string> {
    const userId = this.getCurrentUserId();

    // Check local cache first
    if (this.activeLabCache[userId]) {
      return of(this.activeLabCache[userId]);
    }

    // API call to check active labs for user
    return this.http.get<string>(`${this.apiUrl}/users/${userId}/active-lab`).pipe(
      tap(labId => {
        if (labId) {
          this.activeLabCache[userId] = labId;
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
    return this.http.post<LabCreationResponse>(`${this.apiUrl}/labs`, { user_id: userId }).pipe(
      tap(response => {
        if (response && response.lab_id) {
          this.activeLabCache[userId] = response.lab_id;
        }
      }),
      catchError(this.handleError)
    );
  }

  // Get lab info
  getLabInfo(labId: string): Observable<LabInfoResponse> {
    return this.http.get<LabInfoResponse | ErrorResponse>(`${this.apiUrl}/labs/${labId}`).pipe(
      map(response => {
        if ('error' in response) {
          throw new Error(response.error);
        }
        return response as LabInfoResponse;
      }),
      catchError(this.handleError)
    );
  }

  // Terminate lab
  terminateLab(labId: string, userId: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/labs/${labId}?user_id=${userId}`).pipe(
      tap(() => {
        // Remove from cache when terminated
        delete this.activeLabCache[userId];
      }),
      catchError(this.handleError)
    );
  }

  // Get questions for a module and lesson
  getQuestions(moduleUuid: string, lessonUuid: string): Observable<QuestionsResponse> {
    const userId = this.getCurrentUserId();
    return this.http.get<QuestionsResponse>(
      `${this.apiUrl}/questions/${moduleUuid}/${lessonUuid}?user_id=${userId}`
    ).pipe(
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
    return this.http.post<QuestionSetupResponse>(
      `${this.apiUrl}/questions/${moduleUuid}/${lessonUuid}/${questionNumber}/setup`,
      { pod_name: podName }
    ).pipe(
      catchError(this.handleError)
    );
  }

  // Check a question
  checkQuestion(
    podName: string,
    moduleUuid: string,
    lessonUuid: string,
    questionNumber: number
  ): Observable<QuestionCheckResponse> {
    return this.http.post<QuestionCheckResponse>(
      `${this.apiUrl}/questions/${moduleUuid}/${lessonUuid}/${questionNumber}/check`,
      { pod_name: podName }
    ).pipe(
      catchError(this.handleError)
    );
  }

  // Error handling method
  private handleError(error: HttpErrorResponse) {
    let errorMessage = 'An unknown error occurred';

    if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `Error: ${error.error.message}`;
    } else {
      // Server-side error
      errorMessage = `Error Code: ${error.status}\nMessage: ${error.message}`;

      // If the server returned a specific error message
      if (error.error && typeof error.error === 'object' && 'detail' in error.error) {
        errorMessage = error.error.detail;
      }
    }

    console.error(errorMessage);
    return throwError(() => new Error(errorMessage));
  }
}
