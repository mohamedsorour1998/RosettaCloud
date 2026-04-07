import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { PublicMetricsService, PublicStats } from '../services/public-metrics.service';

interface Statistic {
  value: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-main',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.scss'],
})
export class MainComponent implements OnInit, OnDestroy {
  statistics: Statistic[] = [
    { value: '—', label: 'Labs Launched', icon: 'bi-diagram-3-fill' },
    { value: '—', label: 'Questions Answered', icon: 'bi-patch-check-fill' },
    { value: '—', label: 'AI Messages', icon: 'bi-robot' },
    { value: '10 sec', label: 'Lab Provisioning', icon: 'bi-lightning-fill' },
  ];

  private statsSub?: Subscription;

  constructor(private metricsService: PublicMetricsService) {}

  ngOnInit(): void {
    this.initAnimations();
    this.checkPreferredTheme();
    this.loadLiveStats();
  }

  ngOnDestroy(): void {
    this.statsSub?.unsubscribe();
  }

  private loadLiveStats(): void {
    // Fetch immediately, then refresh every 30 seconds
    this.statsSub = interval(30000).pipe(
      switchMap(() => this.metricsService.getStats())
    ).subscribe((data: PublicStats | null) => {
      if (data) this.applyStats(data);
    });
    // Also fetch right away
    this.metricsService.getStats().subscribe((data: PublicStats | null) => {
      if (data) this.applyStats(data);
    });
  }

  private applyStats(data: PublicStats): void {
    this.statistics[0].value = data.labs_launched.toLocaleString();
    this.statistics[1].value = data.questions_answered.toLocaleString();
    this.statistics[2].value = data.ai_messages.toLocaleString();
  }

  private checkPreferredTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-bs-theme', savedTheme);
    } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-bs-theme', 'dark');
    }
  }

  private initAnimations(): void {
    if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('animate-in');
              observer.unobserve(entry.target);
            }
          });
        },
        { root: null, rootMargin: '0px', threshold: 0.1 }
      );
      setTimeout(() => {
        document.querySelectorAll('.animate-on-scroll').forEach((el) =>
          observer.observe(el)
        );
      }, 100);
    }
  }
}
