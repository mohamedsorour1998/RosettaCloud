import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { Observable, throwError, of, BehaviorSubject } from 'rxjs';
import { catchError, map, tap, retry, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';
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
  index: number;
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
  private apiUrl = environment.apiUrl || this.getApiUrl();
  private connectionStatus = new BehaviorSubject<boolean>(true);
  public connectionStatus$ = this.connectionStatus.asObservable();
  private activeLabCache: { [userId: string]: string } = {};
  constructor(private http: HttpClient, private userService: UserService) {
    try {
      this.checkApiConnection();
    } catch (err) {
      console.error('Error initializing lab service:', err);
      this.connectionStatus.next(false);
    }
  }
  private getApiUrl(): string {
    return (
      environment.apiUrl ||
      (window as any).__RC_API__ ||
      'http://51.112.10.4:30085' // Updated to your actual API URL
    );
  }
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
  private getHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  }
  getCurrentUserId(): string {
    const userId = this.userService.getCurrentUserId();
    return userId || 'guest';
  }
  getActiveLabForUser(): Observable<string> {
    const userId = this.getCurrentUserId();
    if (this.activeLabCache[userId]) {
      return of(this.activeLabCache[userId]);
    }
    const storedLabId = sessionStorage.getItem('activeLabId');
    if (storedLabId) {
      this.activeLabCache[userId] = storedLabId;
      return of(storedLabId);
    }
    return this.userService.getUserLabs(userId).pipe(
      map((response) => {
        const labs = response.labs;
        if (labs && labs.length > 0) {
          const labId = labs[0];
          this.activeLabCache[userId] = labId;
          sessionStorage.setItem('activeLabId', labId);
          return labId;
        }
        throw new Error('No active lab found');
      }),
      catchError((error: HttpErrorResponse) => {
        if (error.status === 404) {
          return throwError(() => new Error('No active lab found'));
        }
        return this.handleError(error);
      })
    );
  }
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
            sessionStorage.setItem('activeLabId', response.lab_id);
          }
        }),
        catchError(this.handleError)
      );
  }
  getLabInfo(labId: string): Observable<LabInfoResponse> {
    if (!labId) {
      console.error('Attempted to get lab info with no labId');
      return throwError(() => new Error('No lab ID provided'));
    }

    return this.http
      .get<LabInfoResponse | ErrorResponse>(`${this.apiUrl}/labs/${labId}`, {
        headers: this.getHeaders(),
      })
      .pipe(
        map((response) => {
          if ('error' in response) {
            throw new Error(response.error);
          }
          const labInfo = response as LabInfoResponse;
          if (labInfo.time_remaining) {
            labInfo.time_remaining = {
              hours: labInfo.time_remaining.hours || 0,
              minutes: labInfo.time_remaining.minutes || 0,
              seconds: labInfo.time_remaining.seconds || 0,
            };
          }
          if (labInfo.index === undefined) {
            labInfo.index = 0;
            console.warn(
              'Lab index was not provided by the backend, defaulting to 0'
            );
          }

          return labInfo;
        }),
        catchError(this.handleError)
      );
  }
  terminateLab(labId: string, userId: string): Observable<any> {
    return this.http
      .delete(`${this.apiUrl}/labs/${labId}?user_id=${userId}`, {
        headers: this.getHeaders(),
      })
      .pipe(
        tap(() => {
          delete this.activeLabCache[userId];
          sessionStorage.removeItem('activeLabId');
        }),
        catchError(this.handleError)
      );
  }
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
        tap((response) => {
          this.userService
            .getUserProgress(userId, moduleUuid, lessonUuid)
            .subscribe((progress) => {
              if (progress && Object.keys(progress).length > 0) {
                response.questions.forEach((question) => {
                  const questionKey = question.question_number.toString();
                  if (progress[questionKey] === true) {
                    console.log(
                      `Question ${questionKey} is completed based on user progress`
                    );
                  }
                });
              }
            });
        }),
        map((response) => {
          console.log('API Questions Response:', response);
          return response;
        }),
        catchError(this.handleError)
      );
  }
  setupQuestion(
    podName: string,
    moduleUuid: string,
    lessonUuid: string,
    questionNumber: number,
    podIdx?: number // Add optional index parameter
  ): Observable<QuestionSetupResponse> {
    const userId = this.getCurrentUserId();
    const formattedPodName =
      podIdx !== undefined ? `interactive-labs-${podIdx}` : podName;

    return this.http
      .post<QuestionSetupResponse>(
        `${this.apiUrl}/questions/${moduleUuid}/${lessonUuid}/${questionNumber}/setup?user_id=${userId}`,
        { pod_name: formattedPodName },
        { headers: this.getHeaders() }
      )
      .pipe(
        tap((response) => {
          console.log(`Setup Question ${questionNumber} Response:`, response);
        }),
        catchError(this.handleError)
      );
  }
  checkQuestion(
    podName: string,
    moduleUuid: string,
    lessonUuid: string,
    questionNumber: number,
    additionalData?: any,
    podIdx?: number // Add optional index parameter
  ): Observable<QuestionCheckResponse> {
    const userId = this.getCurrentUserId();
    const formattedPodName =
      podIdx !== undefined ? `interactive-labs-${podIdx}` : podName;

    const payload = {
      pod_name: formattedPodName,
      ...additionalData,
    };
    console.log(`Checking Question ${questionNumber} with payload:`, payload);

    return this.http
      .post<QuestionCheckResponse>(
        `${this.apiUrl}/questions/${moduleUuid}/${lessonUuid}/${questionNumber}/check?user_id=${userId}`,
        payload,
        { headers: this.getHeaders() }
      )
      .pipe(
        tap((response) => {
          if (response.status === 'success' && response.completed) {
            this.userService
              .updateUserProgress(
                userId,
                moduleUuid,
                lessonUuid,
                questionNumber,
                true
              )
              .subscribe(
                () =>
                  console.log(
                    `User progress updated for question ${questionNumber}`
                  ),
                (error) =>
                  console.error(`Failed to update user progress: ${error}`)
              );
          }
          console.log(`Check Question ${questionNumber} Response:`, response);
        }),
        catchError(this.handleError)
      );
  }
  private handleError(error: HttpErrorResponse) {
    let errorMessage = 'An unknown error occurred';

    if (error.error instanceof ErrorEvent) {
      errorMessage = `Client Error: ${error.error.message}`;
    } else {
      errorMessage = `Server Error: ${error.status} - ${error.message}`;
      if (error.error && typeof error.error === 'object') {
        if ('detail' in error.error) {
          errorMessage = error.error.detail;
        } else if ('message' in error.error) {
          errorMessage = error.error.message;
        }
      }
    }
    console.error('API Error:', {
      message: errorMessage,
      status: error.status,
      url: error.url || 'unknown',
      timestamp: new Date().toISOString(),
    });
    if (error.status === 0) {
      this.connectionStatus.next(false);
    }

    return throwError(() => new Error(errorMessage));
  }
}
