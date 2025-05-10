import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../services/user.service';
import { switchMap, catchError, of } from 'rxjs';

@Component({
  selector: 'app-account-verification',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './account-verification.component.html',
  styleUrls: ['./account-verification.component.scss']
})
export class AccountVerificationComponent implements OnInit {
  isLoading = true;
  isVerified = false;
  isResending = false;
  resendSuccess = false;
  errorMessage = '';

  userId = '';
  token = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const token = params['token'];
      const userId = params['userId'];

      if (!token || !userId) {
        this.isLoading = false;
        this.errorMessage = 'Invalid verification link. Please check your email or request a new verification link.';
        return;
      }

      this.userId = userId;
      this.token = token;
      // this.verifyAccount();
    });
  }

  // Verify the account
  // verifyAccount(): void {
  //   this.isLoading = true;
  //   this.errorMessage = '';

  //   // Add this method to your UserService
  //   this.userService.verifyAccount(this.userId, this.token)
  //     .pipe(
  //       switchMap(response => {
  //         this.isVerified = true;

  //         // If user is not logged in, log them in
  //         if (!this.userService.isLoggedIn()) {
  //           return this.userService.getUser(this.userId);
  //         }

  //         return of(null);
  //       }),
  //       catchError(error => {
  //         this.errorMessage = error.message || 'Failed to verify your account. Please try again.';
  //         return of(null);
  //       })
  //     )
  //     .subscribe({
  //       next: user => {
  //         if (user) {
  //           // Update metadata to mark email as verified
  //           const metadata = user.metadata || {};
  //           metadata.emailVerified = true;

  //           this.userService.updateUser(user.user_id, { metadata }).subscribe();
  //         }
  //         this.isLoading = false;
  //       },
  //       error: () => {
  //         this.isLoading = false;
  //       }
  //     });
  // }

  // Resend verification email
  // resendVerification(): void {
  //   this.isResending = true;
  //   this.resendSuccess = false;

  //   // Add this method to your UserService
  //   this.userService.resendVerificationEmail(this.userId)
  //     .subscribe({
  //       next: () => {
  //         this.isResending = false;
  //         this.resendSuccess = true;

  //         // Hide success message after 5 seconds
  //         setTimeout(() => {
  //           this.resendSuccess = false;
  //         }, 5000);
  //       },
  //       error: error => {
  //         this.isResending = false;
  //         this.errorMessage = error.message || 'Failed to resend verification email. Please try again.';
  //       }
  //     });
  // }
}
