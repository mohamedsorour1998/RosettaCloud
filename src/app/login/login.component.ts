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
  isLoading = false;
  showPassword = false;
  submitted = false;
  errorMessage = '';
  successMessage = '';
  returnUrl = '/';

  loginForm: FormGroup;
  registerForm: FormGroup;

  constructor(
    private formBuilder: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService
  ) {
    // Initialize forms
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
      rememberMe: [false],
    });

    this.registerForm = this.formBuilder.group(
      {
        name: ['', [Validators.required, Validators.minLength(2)]],
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.minLength(6)]],
        confirmPassword: ['', Validators.required],
        terms: [false, Validators.requiredTrue],
      },
      {
        validators: this.checkPasswords,
      }
    );
  }

  ngOnInit(): void {
    // Check for return URL
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/';

    // Check if we should show registration form (from route data or query params)
    const showRegister = this.route.snapshot.queryParams['register'];
    this.route.data.subscribe((data) => {
      if (data['register'] || showRegister) {
        this.isLoginMode = false;
      }
    });

    // Check if user is already logged in
    if (this.userService.isLoggedIn()) {
      this.router.navigate([this.returnUrl]);
    }
  }

  // Custom validator to check if passwords match
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
    this.errorMessage = '';
    this.successMessage = '';
    this.submitted = false;
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  onLogin(): void {
    this.submitted = true;

    // Stop if form is invalid
    if (this.loginForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    const { email, password, rememberMe } = this.loginForm.value;

    this.userService.login(email, password).subscribe({
      next: (user) => {
        // Save user data based on remember me setting
        if (rememberMe) {
          localStorage.setItem('rememberUser', 'true');
        }

        this.isLoading = false;
        this.router.navigate([this.returnUrl]);
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage =
          error.message ||
          'Login failed. Please check your credentials and try again.';
      },
    });
  }

  onRegister(): void {
    this.submitted = true;

    // Stop if form is invalid
    if (this.registerForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    const { name, email, password } = this.registerForm.value;

    const userData = {
      name,
      email,
      password,
      role: 'user',
    };

    this.userService.register(userData).subscribe({
      next: (user) => {
        this.isLoading = false;
        this.successMessage =
          'Account created successfully! You can now sign in.';
        this.isLoginMode = true;

        // Pre-fill the login form with the registered email
        this.loginForm.patchValue({
          email: email,
        });

        this.submitted = false;
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage =
          error.message || 'Registration failed. Please try again later.';
      },
    });
  }
}
