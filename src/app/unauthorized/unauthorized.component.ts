import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-unauthorized',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="unauthorized-container">
      <div class="container text-center py-5">
        <div class="unauthorized-icon">
          <i class="bi bi-shield-lock"></i>
        </div>
        <h1 class="display-4 mt-4">Access Denied</h1>
        <p class="lead text-muted mb-4">
          You don't have permission to access this page.
        </p>
        <div class="d-flex justify-content-center gap-3">
          <a routerLink="/" class="btn btn-primary">Go to Home</a>
          <a routerLink="/login" class="btn btn-outline-secondary"
            >Sign In with Different Account</a
          >
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .unauthorized-container {
        min-height: calc(100vh - 56px);
        display: flex;
        align-items: center;
        background-color: #f8f9fa;
      }

      .unauthorized-icon {
        width: 120px;
        height: 120px;
        background-color: #fff3cd;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto;
        color: #ffc107;
        font-size: 3rem;
      }

      .btn-primary {
        background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%);
        border: none;
        padding: 0.75rem 1.5rem;
        font-weight: 500;
      }

      .btn-outline-secondary {
        border-color: #6c757d;
        color: #6c757d;
        padding: 0.75rem 1.5rem;
        font-weight: 500;
      }
    `,
  ],
})
export class UnauthorizedComponent {}
