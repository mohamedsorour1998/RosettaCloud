import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PublicMetricsService, PublicStats } from '../services/public-metrics.service';

interface Testimonial {
  quote: string;
  name: string;
  title: string;
  company: string;
}

interface Statistic {
  value: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-main',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.scss'],
})
export class MainComponent implements OnInit {
  testimonials: Testimonial[] = [];

  emailInput = '';
  emailSubmitted = false;

  statistics: Statistic[] = [
    { value: '—', label: 'Labs Launched', icon: 'bi-diagram-3-fill' },
    { value: '—', label: 'Questions Answered', icon: 'bi-patch-check-fill' },
    { value: '—', label: 'AI Messages', icon: 'bi-robot' },
    { value: '10 sec', label: 'Lab Provisioning', icon: 'bi-lightning-fill' },
  ];

  constructor(private metricsService: PublicMetricsService) {}

  ngOnInit(): void {
    this.initAnimations();
    this.checkPreferredTheme();
    this.loadLiveStats();
  }

  private loadLiveStats(): void {
    this.metricsService.getStats().subscribe((data: PublicStats | null) => {
      if (!data) return;
      this.statistics[0].value = data.labs_launched.toLocaleString();
      this.statistics[1].value = data.questions_answered.toLocaleString();
      this.statistics[2].value = data.ai_messages.toLocaleString();
    });
  }

  submitEmail(event: Event): void {
    event.preventDefault();
    if (!this.emailInput) return;
    const list = JSON.parse(localStorage.getItem('rc_email_list') || '[]');
    list.push({ email: this.emailInput, ts: Date.now() });
    localStorage.setItem('rc_email_list', JSON.stringify(list));
    this.emailSubmitted = true;
    this.emailInput = '';
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
