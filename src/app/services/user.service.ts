import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { BehaviorSubject, Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface User {
  user_id: string;
  email: string;
  name: string;
  role: string;
  created_at?: number;
  updated_at?: number;
  metadata?: any;
}

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

export interface UserList {
  users: User[];
  count: number;
  last_key?: string;
}

@Injectable({
  providedIn: 'root',
})
export class UserService {
  listUsers(arg0: number) {
    throw new Error('Method not implemented.');
  }

  private apiUrl = environment.apiUrl;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  // Connection status
  private connectionStatus = new BehaviorSubject<boolean>(true);
  public connectionStatus$ = this.connectionStatus.asObservable();

  constructor(private http: HttpClient) {
    this.loadUserFromStorage();
    this.checkApiConnection();
  }

  // Check API connection
  private checkApiConnection(): void {
    this.http
      .get(`${this.apiUrl}/health-check`, { responseType: 'text' })
      .pipe(
        catchError(() => {
          this.connectionStatus.next(false);
          return throwError(() => new Error('API connection failed'));
        })
      )
      .subscribe(() => {
        this.connectionStatus.next(true);
      });
  }

  // Get HTTP headers
  private getHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
    });
  }

  // Load user from storage
  private loadUserFromStorage(): void {
    const userJson = localStorage.getItem('currentUser');
    if (userJson) {
      try {
        const user = JSON.parse(userJson);
        this.currentUserSubject.next(user);
      } catch (error) {
        console.error('Failed to parse stored user', error);
        localStorage.removeItem('currentUser');
      }
    }
  }

  // Register new user
  register(userData: UserCreate): Observable<User> {
    return this.http
      .post<User>(`${this.apiUrl}/users`, userData, {
        headers: this.getHeaders(),
      })
      .pipe(
        tap((user) => {
          this.storeUser(user);
        }),
        catchError(this.handleError)
      );
  }

  // Login user
  login(email: string, password: string): Observable<User> {
    // In a real app, this would be a POST request with credentials
    // For this example, we're using the existing endpoint to find the user by email
    return this.http
      .get<{ users: User[] }>(`${this.apiUrl}/users`, {
        headers: this.getHeaders(),
        params: { email },
      })
      .pipe(
        map((response) => {
          const user = response.users.find((u) => u.email === email);
          if (!user) {
            throw new Error('User not found');
          }

          // In a real app, password verification would happen on the server
          // Here we just simulate a successful login
          this.storeUser(user);
          return user;
        }),
        catchError(this.handleError)
      );
  }

  // Store user in local storage and update subject
  private storeUser(user: User): void {
    localStorage.setItem('currentUser', JSON.stringify(user));
    localStorage.setItem('userId', user.user_id);
    this.currentUserSubject.next(user);
  }

  // Logout user
  logout(): void {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userId');
    localStorage.removeItem('rememberUser');
    this.currentUserSubject.next(null);
  }

  // Get current user
  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  // Get current user ID
  getCurrentUserId(): string | null {
    const currentUser = this.getCurrentUser();
    if (currentUser) {
      return currentUser.user_id;
    }

    const storedId = localStorage.getItem('userId');
    return storedId;
  }

  // Check if user is logged in
  isLoggedIn(): boolean {
    return !!this.getCurrentUserId();
  }

  // Get user by ID
  getUser(userId: string): Observable<User> {
    return this.http
      .get<User>(`${this.apiUrl}/users/${userId}`, {
        headers: this.getHeaders(),
      })
      .pipe(catchError(this.handleError));
  }

  // Update user
  updateUser(userId: string, updates: UserUpdate): Observable<User> {
    return this.http
      .put<User>(`${this.apiUrl}/users/${userId}`, updates, {
        headers: this.getHeaders(),
      })
      .pipe(
        tap((updatedUser) => {
          // Update stored user if it's the current user
          const currentUser = this.getCurrentUser();
          if (currentUser && currentUser.user_id === userId) {
            this.storeUser(updatedUser);
          }
        }),
        catchError(this.handleError)
      );
  }

  // Delete user
  deleteUser(userId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/users/${userId}`, {
        headers: this.getHeaders(),
      })
      .pipe(
        tap(() => {
          // Logout if deleting current user
          const currentUser = this.getCurrentUser();
          if (currentUser && currentUser.user_id === userId) {
            this.logout();
          }
        }),
        catchError(this.handleError)
      );
  }

  // Request password reset
  requestPasswordReset(email: string): Observable<any> {
    return this.http
      .post<any>(
        `${this.apiUrl}/auth/reset-password`,
        { email },
        { headers: this.getHeaders() }
      )
      .pipe(catchError(this.handleError));
  }

  // Reset password with token
  resetPassword(
    token: string,
    userId: string,
    newPassword: string
  ): Observable<any> {
    return this.http
      .post<any>(
        `${this.apiUrl}/auth/reset-password/confirm`,
        {
          token,
          userId,
          password: newPassword,
        },
        { headers: this.getHeaders() }
      )
      .pipe(catchError(this.handleError));
  }

  // Get user's progress
  getUserProgress(
    userId: string,
    moduleUuid?: string,
    lessonUuid?: string
  ): Observable<any> {
    let url = `${this.apiUrl}/users/${userId}/progress`;
    let params: any = {};

    if (moduleUuid) {
      params.module_uuid = moduleUuid;
      if (lessonUuid) {
        params.lesson_uuid = lessonUuid;
      }
    }

    return this.http
      .get<{ progress: any }>(url, {
        headers: this.getHeaders(),
        params,
      })
      .pipe(
        map((response) => response.progress),
        catchError(this.handleError)
      );
  }

  // Update user's progress
  updateUserProgress(
    userId: string,
    moduleUuid: string,
    lessonUuid: string,
    questionNumber: number,
    completed: boolean
  ): Observable<any> {
    return this.http
      .post<any>(
        `${this.apiUrl}/users/${userId}/progress/${moduleUuid}/${lessonUuid}/${questionNumber}`,
        { completed },
        { headers: this.getHeaders() }
      )
      .pipe(catchError(this.handleError));
  }

  // Get user's labs
  getUserLabs(userId: string): Observable<{ labs: string[] }> {
    return this.http
      .get<{ labs: string[] }>(`${this.apiUrl}/users/${userId}/labs`, {
        headers: this.getHeaders(),
      })
      .pipe(catchError(this.handleError));
  }

  // Link lab to user
  linkLabToUser(userId: string, labId: string): Observable<any> {
    return this.http
      .post<any>(
        `${this.apiUrl}/users/${userId}/labs/${labId}`,
        {},
        { headers: this.getHeaders() }
      )
      .pipe(catchError(this.handleError));
  }

  // Unlink lab from user
  unlinkLabFromUser(userId: string, labId: string): Observable<any> {
    return this.http
      .delete<any>(`${this.apiUrl}/users/${userId}/labs/${labId}`, {
        headers: this.getHeaders(),
      })
      .pipe(catchError(this.handleError));
  }

  // Generic error handler
  private handleError(error: HttpErrorResponse) {
    let errorMessage = 'Something went wrong';

    if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `Error: ${error.error.message}`;
    } else {
      // Server-side error
      if (error.error && typeof error.error === 'object') {
        errorMessage =
          error.error.detail ||
          error.error.message ||
          `Error ${error.status}: ${error.statusText}`;
      } else {
        errorMessage = `Error ${error.status}: ${error.statusText}`;
      }
    }

    console.error('API Error:', error);
    return throwError(() => new Error(errorMessage));
  }
  resendVerificationEmail(userId: string) {
    throw new Error('Method not implemented.');
  }
}
