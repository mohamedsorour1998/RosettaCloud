import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { UserService } from '../services/user.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.scss'],
})
export class ForgotPasswordComponent implements OnInit {
  requestForm: FormGroup;
  resetForm: FormGroup;

  isLoading = false;
  submitted = false;
  showPassword = false;

  // Page states
  resetting = false;
  resetComplete = false;

  // Messages
  errorMessage = '';
  successMessage = '';

  // Reset token from URL
  resetToken = '';
  userId = '';

  constructor(
    private formBuilder: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService
  ) {
    // Initialize request form
    this.requestForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
    });

    // Initialize reset form
    this.resetForm = this.formBuilder.group(
      {
        password: ['', [Validators.required, Validators.minLength(6)]],
        confirmPassword: ['', [Validators.required]],
      },
      {
        validators: this.passwordMatchValidator,
      }
    );
  }

  ngOnInit(): void {
    // Check for reset token in URL
    this.route.queryParams.subscribe((params) => {
      const token = params['token'];
      const userId = params['userId'];

      if (token && userId) {
        this.resetToken = token;
        this.userId = userId;
        this.resetting = true;

        // Validate token
        this.validateResetToken();
      }
    });
  }

  // Password match validator
  passwordMatchValidator(formGroup: FormGroup) {
    const password = formGroup.get('password')?.value;
    const confirmPassword = formGroup.get('confirmPassword')?.value;

    if (password !== confirmPassword) {
      formGroup.get('confirmPassword')?.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }

    return null;
  }

  // Toggle password visibility
  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  // Validate reset token
  validateResetToken(): void {
    this.isLoading = true;
    this.errorMessage = '';

    // In a real application, you would validate the token with the server
    // For this example, we'll just simulate a validation delay
    setTimeout(() => {
      this.isLoading = false;

      // In a real application, handle invalid tokens
      // For this example, we'll assume the token is valid
    }, 1000);
  }

  // Request password reset
  requestReset(): void {
    this.submitted = true;

    if (this.requestForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const email = this.requestForm.get('email')?.value;

    // In a real application, you would call an API endpoint to request a reset
    // For this example, we'll simulate a server response
    setTimeout(() => {
      this.isLoading = false;
      this.successMessage = `Password reset instructions have been sent to ${email}. Please check your email.`;
      this.submitted = false;
      this.requestForm.reset();
    }, 1500);
  }

  // Reset password
  resetPassword(): void {
    this.submitted = true;

    if (this.resetForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    const newPassword = this.resetForm.get('password')?.value;

    // In a real application, you would call an API endpoint to reset the password
    // For this example, we'll simulate a successful reset
    setTimeout(() => {
      this.isLoading = false;
      this.resetComplete = true;
    }, 1500);
  }
}
