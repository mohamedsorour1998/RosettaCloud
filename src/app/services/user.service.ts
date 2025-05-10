import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
  HttpParams,
} from '@angular/common/http';
import { Observable, throwError, of, BehaviorSubject } from 'rxjs';
import { catchError, map, tap, retry } from 'rxjs/operators';
import { environment } from '../../environments/environment';
export interface UserCreate {
  email: string;
  name: string;
  password: string;
  role?: string;
  metadata?: any;
}

export interface UserUpdate {
  email?: string;
  name?: string;
  password?: string;
  role?: string;
  metadata?: any;
}

export interface User {
  user_id: string;
  email: string;
  name: string;
  role: string;
  created_at?: number;
  updated_at?: number;
  metadata?: any;
}

export interface UserList {
  users: User[];
  count: number;
  last_key?: string;
}

export interface UserProgress {
  [key: string]: any; // Module/lesson/question structure
}

export interface UserLabs {
  labs: string[];
}

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private apiUrl = environment.apiUrl || this.getApiUrl();
  private connectionStatus = new BehaviorSubject<boolean>(true);
  public connectionStatus$ = this.connectionStatus.asObservable();
  private currentUser = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUser.asObservable();

  constructor(private http: HttpClient) {
    try {
      this.checkApiConnection();
      this.loadUserFromStorage();
    } catch (err) {
      console.error('Error initializing user service:', err);
      this.connectionStatus.next(false);
    }
  }
  private getApiUrl(): string {
    return (
      environment.apiUrl ||
      (window as any).__RC_API__ ||
      'http://51.112.10.4:30085'
    );
  }
  private checkApiConnection(): void {
    this.http
      .get(`${this.apiUrl}/health-check`, {
        headers: this.getHeaders(),
        responseType: 'text',
      })
      .pipe(
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
  private loadUserFromStorage(): void {
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        this.currentUser.next(user);
      } catch (e) {
        console.error('Failed to parse stored user:', e);
        localStorage.removeItem('currentUser');
      }
    }
  }
  register(userData: UserCreate): Observable<User> {
    return this.http
      .post<User>(`${this.apiUrl}/users`, userData, {
        headers: this.getHeaders(),
      })
      .pipe(
        tap((user) => {
          localStorage.setItem('currentUser', JSON.stringify(user));
          localStorage.setItem('userId', user.user_id);
          this.currentUser.next(user);
        }),
        catchError(this.handleError)
      );
  }

  login(email: string, password: string): Observable<User> {
    return this.http
      .get<UserList>(`${this.apiUrl}/users`, {
        headers: this.getHeaders(),
        params: new HttpParams().set('limit', '100'),
      })
      .pipe(
        map((response) => {
          const user = response.users.find((u) => u.email === email);
          if (!user) {
            throw new Error('User not found');
          }
          localStorage.setItem('currentUser', JSON.stringify(user));
          localStorage.setItem('userId', user.user_id);
          this.currentUser.next(user);

          return user;
        }),
        catchError(this.handleError)
      );
  }

  logout(): void {
    localStorage.removeItem('currentUser');
    this.currentUser.next(null);
  }

  getCurrentUserId(): string | null {
    const user = this.currentUser.getValue();
    if (user) {
      return user.user_id;
    }
    const storedId = localStorage.getItem('userId');
    if (storedId) {
      return storedId;
    }
    return null;
  }

  isLoggedIn(): boolean {
    return !!this.getCurrentUserId();
  }

  getUser(userId: string): Observable<User> {
    return this.http
      .get<User>(`${this.apiUrl}/users/${userId}`, {
        headers: this.getHeaders(),
      })
      .pipe(retry(1), catchError(this.handleError));
  }

  updateUser(userId: string, updates: UserUpdate): Observable<User> {
    return this.http
      .put<User>(`${this.apiUrl}/users/${userId}`, updates, {
        headers: this.getHeaders(),
      })
      .pipe(
        tap((updatedUser) => {
          const currentUser = this.currentUser.getValue();
          if (currentUser && currentUser.user_id === userId) {
            localStorage.setItem('currentUser', JSON.stringify(updatedUser));
            this.currentUser.next(updatedUser);
          }
        }),
        catchError(this.handleError)
      );
  }

  deleteUser(userId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/users/${userId}`, {
        headers: this.getHeaders(),
      })
      .pipe(
        tap(() => {
          const currentUser = this.currentUser.getValue();
          if (currentUser && currentUser.user_id === userId) {
            this.logout();
          }
        }),
        catchError(this.handleError)
      );
  }
  getUserProgress(
    userId: string,
    moduleUuid?: string,
    lessonUuid?: string
  ): Observable<UserProgress> {
    let url = `${this.apiUrl}/users/${userId}/progress`;
    let params = new HttpParams();

    if (moduleUuid) {
      params = params.set('module_uuid', moduleUuid);
      if (lessonUuid) {
        params = params.set('lesson_uuid', lessonUuid);
      }
    }

    return this.http
      .get<{ progress: UserProgress }>(url, {
        headers: this.getHeaders(),
        params,
      })
      .pipe(
        map((response) => response.progress),
        catchError(this.handleError)
      );
  }

  updateUserProgress(
    userId: string,
    moduleUuid: string,
    lessonUuid: string,
    questionNumber: number,
    completed: boolean
  ): Observable<{ updated: boolean }> {
    return this.http
      .post<{ updated: boolean }>(
        `${this.apiUrl}/users/${userId}/progress/${moduleUuid}/${lessonUuid}/${questionNumber}`,
        { completed },
        { headers: this.getHeaders() }
      )
      .pipe(catchError(this.handleError));
  }
  getUserLabs(userId: string): Observable<UserLabs> {
    return this.http
      .get<UserLabs>(`${this.apiUrl}/users/${userId}/labs`, {
        headers: this.getHeaders(),
      })
      .pipe(catchError(this.handleError));
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
