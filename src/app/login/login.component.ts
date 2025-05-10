import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { UserService } from '../services/user.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnInit {
  email: string = '';
  password: string = '';
  errorMessage: string = '';
  isLoading: boolean = false;
  redirectUrl: string = '/dashboard';

  constructor(private userService: UserService, private router: Router) {}

  ngOnInit(): void {
    const storedRedirectUrl = sessionStorage.getItem('redirectUrl');
    if (storedRedirectUrl) {
      this.redirectUrl = storedRedirectUrl;
      sessionStorage.removeItem('redirectUrl');
    }
    if (this.userService.getCurrentUserId() !== 'user12' && storedRedirectUrl) {
      this.router.navigate([this.redirectUrl]);
      return;
    }
  }
  handleSubmit(): void {
    if (!this.email || !this.password) {
      this.errorMessage = 'Please enter both email and password';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.userService.login(this.email, this.password).subscribe({
      next: () => {
        this.isLoading = false;
        this.router.navigateByUrl(this.redirectUrl);
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err.message || 'Login failed. Please try again.';
        console.error('Login error:', err);
      },
    });
  }

  handleRegister(): void {
    if (!this.email || !this.password) {
      this.errorMessage = 'Please enter both email and password';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const userData = {
      email: this.email,
      name: this.email.split('@')[0],
      password: this.password,
      role: 'student',
      metadata: {},
    };

    this.userService.register(userData).subscribe({
      next: () => {
        this.isLoading = false;
        this.router.navigateByUrl(this.redirectUrl);
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage =
          err.message || 'Registration failed. Please try again.';
        console.error('Registration error:', err);
      },
    });
  }
}
