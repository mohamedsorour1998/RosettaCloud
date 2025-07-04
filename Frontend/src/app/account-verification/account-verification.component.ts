import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../services/user.service';
import { switchMap, catchError, of, finalize } from 'rxjs';

@Component({
  selector: 'app-account-verification',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './account-verification.component.html',
  styleUrls: ['./account-verification.component.scss'],
})
export class AccountVerificationComponent implements OnInit {
  isLoading = true;
  isVerified = false;
  isResending = false;
  resendSuccess = false;
  errorMessage = '';

  userId = '';
  token = '';

  // Error messages for different scenarios
  private readonly errorMessages = {
    invalidLink:
      'Invalid verification link. Please check your email or request a new verification link.',
    expired:
      'Your verification link has expired. Please request a new verification email.',
    alreadyVerified:
      'This account has already been verified. You can now log in.',
    serverError:
      'We encountered an issue while verifying your account. Please try again later.',
    networkError:
      'Connection error. Please check your internet connection and try again.',
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    // Extract and validate query parameters
    this.route.queryParams.subscribe((params) => {
      const token = params['token'];
      const userId = params['userId'];

      if (!token || !userId) {
        this.isLoading = false;
        this.errorMessage = this.errorMessages.invalidLink;
        return;
      }

      this.userId = userId;
      this.token = token;

      // Uncomment this when the service is ready
      // this.verifyAccount();

      // For demonstration, we'll simulate the verification process
      this.simulateVerification();
    });
  }

  // Simulate verification (remove this in production)
  private simulateVerification(): void {
    setTimeout(() => {
      this.isLoading = false;

      // Simulate success (70% chance) or error (30% chance)
      const isSuccess = Math.random() > 0.3;

      if (isSuccess) {
        this.isVerified = true;
      } else {
        this.errorMessage = this.errorMessages.expired;
      }
    }, 2000);
  }

  /**
   * Verify the account using the token
   * Uncomment and complete this method when your UserService is ready
   */
  /*
  verifyAccount(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.userService.verifyAccount(this.userId, this.token)
      .pipe(
        switchMap(response => {
          this.isVerified = true;

          // If user is not logged in, get their info
          if (!this.userService.isLoggedIn()) {
            return this.userService.getUser(this.userId);
          }

          return of(null);
        }),
        catchError(error => {
          // Handle different error types
          if (error.status === 400) {
            this.errorMessage = this.errorMessages.invalidLink;
          } else if (error.status === 401) {
            this.errorMessage = this.errorMessages.expired;
          } else if (error.status === 409) {
            this.errorMessage = this.errorMessages.alreadyVerified;
          } else if (error.status >= 500) {
            this.errorMessage = this.errorMessages.serverError;
          } else {
            this.errorMessage = error.message || this.errorMessages.networkError;
          }
          return of(null);
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe({
        next: user => {
          if (user) {
            // Update user metadata to mark email as verified
            const metadata = user.metadata || {};
            metadata.emailVerified = true;
            this.userService.updateUser(user.user_id, { metadata }).subscribe();
          }
        }
      });
  }
  */

  /**
   * Resend verification email
   * Uncomment and complete this method when your UserService is ready
   */
  resendVerification(): void {
    this.isResending = true;
    this.resendSuccess = false;

    // Simulate sending email (remove in production)
    setTimeout(() => {
      this.isResending = false;
      this.resendSuccess = true;

      // Hide success message after 5 seconds
      setTimeout(() => {
        this.resendSuccess = false;
      }, 5000);
    }, 2000);

    /*
    // Uncomment when UserService is ready
    this.userService.resendVerificationEmail(this.userId)
      .pipe(
        catchError(error => {
          this.errorMessage = error.message || 'Failed to resend verification email. Please try again.';
          return of(null);
        }),
        finalize(() => {
          this.isResending = false;
        })
      )
      .subscribe({
        next: () => {
          this.resendSuccess = true;

          // Hide success message after 5 seconds
          setTimeout(() => {
            this.resendSuccess = false;
          }, 5000);
        }
      });
    */
  }
}
