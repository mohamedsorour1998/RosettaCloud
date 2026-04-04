import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { UserService } from '../services/user.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.scss'],
})
export class ForgotPasswordComponent {
  requestForm: FormGroup;
  resetForm: FormGroup;

  isLoading = false;
  submitted = false;
  showPassword = false;

  // Steps: 'request' → 'reset' → 'complete'
  step: 'request' | 'reset' | 'complete' = 'request';

  // Email kept across steps
  pendingEmail = '';

  errorMessage = '';
  successMessage = '';

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private userService: UserService
  ) {
    this.requestForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
    });

    this.resetForm = this.formBuilder.group(
      {
        code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
        password: ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', [Validators.required]],
      },
      { validators: this.passwordMatchValidator }
    );
  }

  passwordMatchValidator(formGroup: FormGroup) {
    const password = formGroup.get('password')?.value;
    const confirmPassword = formGroup.get('confirmPassword')?.value;
    if (password !== confirmPassword) {
      formGroup.get('confirmPassword')?.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }
    return null;
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  requestReset(): void {
    this.submitted = true;
    if (this.requestForm.invalid) return;

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const email = this.requestForm.get('email')?.value;

    this.userService.requestPasswordReset(email).subscribe({
      next: () => {
        this.isLoading = false;
        this.pendingEmail = email;
        this.step = 'reset';
        this.submitted = false;
        this.successMessage = `A 6-digit verification code has been sent to ${email}. Enter it below with your new password.`;
      },
      error: (err: any) => {
        this.isLoading = false;
        this.errorMessage = err.message || 'Failed to send reset code. Please try again.';
      },
    });
  }

  resetPassword(): void {
    this.submitted = true;
    if (this.resetForm.invalid) return;

    this.isLoading = true;
    this.errorMessage = '';

    const code = this.resetForm.get('code')?.value;
    const newPassword = this.resetForm.get('password')?.value;

    this.userService.resetPassword(code, this.pendingEmail, newPassword).subscribe({
      next: () => {
        this.isLoading = false;
        this.step = 'complete';
      },
      error: (err: any) => {
        this.isLoading = false;
        if (err.name === 'CodeMismatchException') {
          this.errorMessage = 'Invalid verification code. Please check and try again.';
        } else if (err.name === 'ExpiredCodeException') {
          this.errorMessage = 'Verification code has expired. Please request a new one.';
        } else {
          this.errorMessage = err.message || 'Failed to reset password. Please try again.';
        }
      },
    });
  }

  resendCode(): void {
    if (!this.pendingEmail) return;
    this.errorMessage = '';
    this.userService.requestPasswordReset(this.pendingEmail).subscribe({
      next: () => {
        this.successMessage = 'A new verification code has been sent to your email.';
      },
      error: (err: any) => {
        this.errorMessage = err.message || 'Could not resend code.';
      },
    });
  }

  backToRequest(): void {
    this.step = 'request';
    this.submitted = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.resetForm.reset();
  }
}
