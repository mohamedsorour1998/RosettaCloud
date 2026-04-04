import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subject, timer } from 'rxjs';
import { takeUntil, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { environment } from '../../environments/environment';

interface PerUserMetrics {
  lab_started: number;
  lab_terminated: number;
  question_attempted: number;
  question_correct: number;
  chat_message: number;
  active_minutes: number;
}

interface MetricsResponse {
  total_users: number;
  aggregate: Record<string, number>;
  accuracy_pct: number;
  per_user: Record<string, PerUserMetrics>;
  collected_since: number | null;
}

@Component({
  selector: 'app-admin-metrics',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './admin-metrics.component.html',
  styleUrls: ['./admin-metrics.component.scss'],
})
export class AdminMetricsComponent implements OnInit, OnDestroy {
  metrics: MetricsResponse | null = null;
  isLoading = true;
  errorMessage = '';
  lastRefresh: Date | null = null;
  userIds: string[] = [];

  private destroy$ = new Subject<void>();
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadMetrics();
    // Auto-refresh every 30 seconds
    timer(30000, 30000)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() => this.fetchMetrics())
      )
      .subscribe((data) => {
        if (data) {
          this.metrics = data;
          this.userIds = Object.keys(data.per_user);
          this.lastRefresh = new Date();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadMetrics(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.fetchMetrics()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.metrics = data;
          this.userIds = data ? Object.keys(data.per_user) : [];
          this.lastRefresh = new Date();
          this.isLoading = false;
        },
        error: (err) => {
          console.error('Failed to load metrics:', err);
          this.errorMessage = 'Could not load metrics. Is the backend running?';
          this.isLoading = false;
        },
      });
  }

  private fetchMetrics() {
    return this.http
      .get<MetricsResponse>(`${this.apiUrl}/admin/metrics`)
      .pipe(catchError(() => of(null)));
  }

  getAggregate(key: string): number {
    return this.metrics?.aggregate?.[key] ?? 0;
  }

  getUserMetric(userId: string, key: keyof PerUserMetrics): number {
    return this.metrics?.per_user?.[userId]?.[key] ?? 0;
  }

  getCollectedSince(): string {
    if (!this.metrics?.collected_since) return 'No data yet';
    return new Date(this.metrics.collected_since * 1000).toLocaleString();
  }

  getLastRefresh(): string {
    if (!this.lastRefresh) return '';
    return this.lastRefresh.toLocaleTimeString();
  }

  truncateUserId(uid: string): string {
    return uid.length > 12 ? uid.substring(0, 12) + '...' : uid;
  }
}
