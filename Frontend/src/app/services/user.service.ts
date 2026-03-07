import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { BehaviorSubject, Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  ResendConfirmationCodeCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// Single shared Cognito client — no credentials needed in browser
const cognitoClient = new CognitoIdentityProviderClient({
  region: environment.cognito.region,
});

/** Decode a JWT payload (base64url → JSON). Does NOT verify signature. */
function decodeJwtPayload(token: string): Record<string, any> {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
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
  listUsers(limit: number): Observable<any> {
    return this.http.get<any>(`/api/users?limit=${limit}`);
  }

  private apiUrl = environment.apiUrl;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private connectionStatus = new BehaviorSubject<boolean>(true);
  public connectionStatus$ = this.connectionStatus.asObservable();

  constructor(private http: HttpClient) {
    this.loadUserFromStorage();
    this.checkApiConnection();
  }

  private checkApiConnection(): void {
    this.http
      .get(`${this.apiUrl}/health-check`, { responseType: 'text' })
      .pipe(
        catchError(() => {
          this.connectionStatus.next(false);
          return throwError(() => new Error('API connection failed'));
        })
      )
      .subscribe(() => this.connectionStatus.next(true));
  }

  private loadUserFromStorage(): void {
    const userJson = localStorage.getItem('currentUser');
    if (userJson) {
      try {
        this.currentUserSubject.next(JSON.parse(userJson));
      } catch {
        localStorage.removeItem('currentUser');
      }
    }
  }

  /**
   * Register: Cognito SignUp (creates unconfirmed user) then POST /users
   * to create the DynamoDB profile.
   * The caller must follow up with confirmSignUp() using the emailed code.
   */
  register(userData: UserCreate): Observable<User> {
    return new Observable(observer => {
      cognitoClient
        .send(
          new SignUpCommand({
            ClientId: environment.cognito.userPoolClientId,
            Username: userData.email,
            Password: userData.password,
            UserAttributes: [
              { Name: 'email', Value: userData.email },
              { Name: 'name', Value: userData.name },
            ],
          })
        )
        .then(() => {
          // Create DynamoDB profile immediately so backend has a record
          this.http
            .post<User>(`${this.apiUrl}/users`, {
              email: userData.email,
              name: userData.name,
              password: userData.password,
              role: userData.role ?? 'user',
              metadata: userData.metadata ?? {},
            })
            .pipe(catchError(this.handleError))
            .subscribe({
              next: user => { observer.next(user); observer.complete(); },
              error: err => observer.error(err),
            });
        })
        .catch(err => observer.error(err));
    });
  }

  /**
   * Confirm registration with the 6-digit code Cognito emails after signUp.
   */
  confirmSignUp(email: string, code: string): Observable<void> {
    return new Observable(observer => {
      cognitoClient
        .send(
          new ConfirmSignUpCommand({
            ClientId: environment.cognito.userPoolClientId,
            Username: email,
            ConfirmationCode: code,
          })
        )
        .then(() => { observer.next(); observer.complete(); })
        .catch(err => observer.error(err));
    });
  }

  /**
   * Login: Cognito InitiateAuth (USER_PASSWORD_AUTH) → store tokens → fetch
   * user profile from backend.
   *
   * We store the ID token as the auth token because:
   *  - It contains the aud claim (= client ID) that API GW validates
   *  - It carries custom:user_id which FastAPI's auth middleware reads
   */
  login(email: string, password: string): Observable<User> {
    return new Observable(observer => {
      cognitoClient
        .send(
          new InitiateAuthCommand({
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: environment.cognito.userPoolClientId,
            AuthParameters: {
              USERNAME: email,
              PASSWORD: password,
            },
          })
        )
        .then(response => {
          const auth = response.AuthenticationResult;
          if (!auth?.IdToken) throw new Error('No ID token returned from Cognito');

          // Store tokens
          localStorage.setItem('idToken', auth.IdToken);
          if (auth.AccessToken) localStorage.setItem('accessToken', auth.AccessToken);
          if (auth.RefreshToken) localStorage.setItem('refreshToken', auth.RefreshToken);

          // Extract user_id from ID token payload
          const payload = decodeJwtPayload(auth.IdToken);
          const userId: string = payload['custom:user_id'] || payload['sub'];
          localStorage.setItem('userId', userId);

          // Fetch full profile — interceptor will attach the ID token we just stored
          this.getUser(userId).subscribe({
            next: user => { this.storeUser(user); observer.next(user); observer.complete(); },
            error: err => observer.error(err),
          });
        })
        .catch(err => observer.error(err));
    });
  }

  logout(): void {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userId');
    localStorage.removeItem('idToken');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('rememberUser');
    this.currentUserSubject.next(null);
  }

  /**
   * Returns the ID token used for API Gateway authorization.
   * Called by AuthInterceptor on every outbound API request.
   */
  getAccessToken(): string | null {
    return localStorage.getItem('idToken');
  }

  private storeUser(user: User): void {
    localStorage.setItem('currentUser', JSON.stringify(user));
    localStorage.setItem('userId', user.user_id);
    this.currentUserSubject.next(user);
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  getCurrentUserId(): string | null {
    return this.currentUserSubject.value?.user_id ?? localStorage.getItem('userId');
  }

  isLoggedIn(): boolean {
    return !!this.getAccessToken();
  }

  // ── Password reset ────────────────────────────────────────────────────────

  requestPasswordReset(email: string): Observable<any> {
    return new Observable(observer => {
      cognitoClient
        .send(
          new ForgotPasswordCommand({
            ClientId: environment.cognito.userPoolClientId,
            Username: email,
          })
        )
        .then(result => { observer.next(result); observer.complete(); })
        .catch(err => observer.error(err));
    });
  }

  /** Confirm forgot-password flow with the emailed code and a new password. */
  resetPassword(code: string, email: string, newPassword: string): Observable<any> {
    return new Observable(observer => {
      cognitoClient
        .send(
          new ConfirmForgotPasswordCommand({
            ClientId: environment.cognito.userPoolClientId,
            Username: email,
            ConfirmationCode: code,
            Password: newPassword,
          })
        )
        .then(result => { observer.next(result); observer.complete(); })
        .catch(err => observer.error(err));
    });
  }

  resendVerificationEmail(email: string): Observable<any> {
    return new Observable(observer => {
      cognitoClient
        .send(
          new ResendConfirmationCodeCommand({
            ClientId: environment.cognito.userPoolClientId,
            Username: email,
          })
        )
        .then(result => { observer.next(result); observer.complete(); })
        .catch(err => observer.error(err));
    });
  }

  // ── Backend API calls (unchanged — token added by AuthInterceptor) ────────

  getUser(userId: string): Observable<User> {
    return this.http
      .get<User>(`${this.apiUrl}/users/${userId}`)
      .pipe(catchError(this.handleError));
  }

  updateUser(userId: string, updates: UserUpdate): Observable<User> {
    return this.http
      .put<User>(`${this.apiUrl}/users/${userId}`, updates)
      .pipe(
        tap(updatedUser => {
          if (this.getCurrentUser()?.user_id === userId) {
            this.storeUser(updatedUser);
          }
        }),
        catchError(this.handleError)
      );
  }

  deleteUser(userId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/users/${userId}`)
      .pipe(
        tap(() => {
          if (this.getCurrentUser()?.user_id === userId) {
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
  ): Observable<any> {
    const params: any = {};
    if (moduleUuid) {
      params['module_uuid'] = moduleUuid;
      if (lessonUuid) params['lesson_uuid'] = lessonUuid;
    }
    return this.http
      .get<{ progress: any }>(`${this.apiUrl}/users/${userId}/progress`, { params })
      .pipe(
        map(r => r.progress),
        catchError(this.handleError)
      );
  }

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
        { completed }
      )
      .pipe(catchError(this.handleError));
  }

  getUserLabs(userId: string): Observable<{ labs: string[] }> {
    return this.http
      .get<{ labs: string[] }>(`${this.apiUrl}/users/${userId}/labs`)
      .pipe(catchError(this.handleError));
  }

  linkLabToUser(userId: string, labId: string): Observable<any> {
    return this.http
      .post<any>(`${this.apiUrl}/users/${userId}/labs/${labId}`, {})
      .pipe(catchError(this.handleError));
  }

  unlinkLabFromUser(userId: string, labId: string): Observable<any> {
    return this.http
      .delete<any>(`${this.apiUrl}/users/${userId}/labs/${labId}`)
      .pipe(catchError(this.handleError));
  }

  private handleError = (error: HttpErrorResponse) => {
    let errorMessage = 'Something went wrong';
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error: ${error.error.message}`;
    } else if (error.error && typeof error.error === 'object') {
      errorMessage =
        error.error.detail ||
        error.error.message ||
        `Error ${error.status}: ${error.statusText}`;
    } else {
      errorMessage = `Error ${error.status}: ${error.statusText}`;
    }
    console.error('API Error:', error);
    return throwError(() => new Error(errorMessage));
  };
}
