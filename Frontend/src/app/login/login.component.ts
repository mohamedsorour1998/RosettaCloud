import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { UserService } from '../services/user.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnInit {
  isLoginMode = true;
  isVerifyMode = false;
  isLoading = false;
  showPassword = false;
  submitted = false;
  errorMessage = '';
  successMessage = '';
  returnUrl = '/';

  /** Email kept across steps so verify + resend know who to confirm */
  pendingEmail = '';

  loginForm: FormGroup;
  registerForm: FormGroup;
  verifyForm: FormGroup;

  constructor(
    private formBuilder: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService
  ) {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
      rememberMe: [false],
    });

    this.registerForm = this.formBuilder.group(
      {
        name: ['', [Validators.required, Validators.minLength(2)]],
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', Validators.required],
        terms: [false, Validators.requiredTrue],
      },
      {
        validators: this.checkPasswords,
      }
    );

    this.verifyForm = this.formBuilder.group({
      code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });
  }

  ngOnInit(): void {
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/';

    const showRegister = this.route.snapshot.queryParams['register'];
    this.route.data.subscribe((data) => {
      if (data['register'] || showRegister) {
        this.isLoginMode = false;
      }
    });

    if (this.userService.isLoggedIn()) {
      this.router.navigate([this.returnUrl]);
    }
  }

  checkPasswords(group: FormGroup) {
    const password = group.get('password')?.value;
    const confirmPassword = group.get('confirmPassword')?.value;
    if (password !== confirmPassword) {
      group.get('confirmPassword')?.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }
    return null;
  }

  toggleMode(): void {
    this.isLoginMode = !this.isLoginMode;
    this.isVerifyMode = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.submitted = false;
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  onLogin(): void {
    this.submitted = true;
    if (this.loginForm.invalid) return;

    this.isLoading = true;
    this.errorMessage = '';

    const { email, password, rememberMe } = this.loginForm.value;

    this.userService.login(email, password).subscribe({
      next: () => {
        if (rememberMe) localStorage.setItem('rememberUser', 'true');
        this.isLoading = false;
        this.router.navigate([this.returnUrl]);
      },
      error: (error) => {
        this.isLoading = false;
        // If user exists but is unconfirmed, jump straight to verify step
        if (error.name === 'UserNotConfirmedException' ||
            (error.message && error.message.includes('not confirmed'))) {
          this.pendingEmail = email;
          this.isLoginMode = false;
          this.isVerifyMode = true;
          this.errorMessage = '';
          this.successMessage = 'Please verify your email first. Enter the 6-digit code we sent you.';
        } else {
          this.errorMessage =
            error.message || 'Login failed. Please check your credentials and try again.';
        }
      },
    });
  }

  onRegister(): void {
    this.submitted = true;
    if (this.registerForm.invalid) return;

    this.isLoading = true;
    this.errorMessage = '';

    const { name, email, password } = this.registerForm.value;

    this.userService.register({ name, email, password, role: 'user' }).subscribe({
      next: () => {
        this.isLoading = false;
        this.pendingEmail = email;
        // Switch to verify step
        this.isLoginMode = false;
        this.isVerifyMode = true;
        this.submitted = false;
        this.successMessage = 'Account created! Check your email for the 6-digit verification code.';
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage =
          error.message || 'Registration failed. Please try again later.';
      },
    });
  }

  onVerify(): void {
    this.submitted = true;
    if (this.verifyForm.invalid) return;

    this.isLoading = true;
    this.errorMessage = '';

    const { code } = this.verifyForm.value;

    this.userService.confirmSignUp(this.pendingEmail, code).subscribe({
      next: () => {
        this.isLoading = false;
        this.isVerifyMode = false;
        this.isLoginMode = true;
        this.submitted = false;
        this.verifyForm.reset();
        this.successMessage = 'Email verified! You can now sign in.';
        this.loginForm.patchValue({ email: this.pendingEmail });
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage =
          error.message || 'Invalid code. Please check your email and try again.';
      },
    });
  }

  onResendCode(): void {
    if (!this.pendingEmail) return;
    this.errorMessage = '';
    this.userService.resendVerificationEmail(this.pendingEmail).subscribe({
      next: () => { this.successMessage = 'Verification code resent. Check your email.'; },
      error: (error) => { this.errorMessage = error.message || 'Could not resend code.'; },
    });
  }
}
