import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

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
  imports: [CommonModule, RouterModule],
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.scss'],
})
export class MainComponent implements OnInit {
  testimonials: Testimonial[] = [];

  statistics: Statistic[] = [
    { value: 'Real K8s', label: 'Cluster Per Student', icon: 'bi-diagram-3-fill' },
    { value: '10 sec', label: 'Lab Provisioning Time', icon: 'bi-lightning-fill' },
    { value: '3 Agents', label: 'AI Tutor / Grader / Planner', icon: 'bi-robot' },
    { value: '17', label: 'AWS Services in Production', icon: 'bi-cloud-fill' },
  ];

  constructor() {}

  ngOnInit(): void {
    // Initialize animation observers
    this.initAnimations();
    // Check user's preferred theme
    this.checkPreferredTheme();
  }

  /**
   * Check user's preferred theme and apply it if set
   */
  private checkPreferredTheme(): void {
    // This can be expanded to use localStorage or user preferences from API
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-bs-theme', savedTheme);
    } else {
      // Check for system preference
      if (
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
      ) {
        document.documentElement.setAttribute('data-bs-theme', 'dark');
      }
    }
  }

  /**
   * Initialize intersection observer for scroll animations
   */
  private initAnimations(): void {
    if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
      const options = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1,
      };

      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-in');
            observer.unobserve(entry.target);
          }
        });
      }, options);

      // Start observing elements
      setTimeout(() => {
        const elements = document.querySelectorAll('.animate-on-scroll');
        elements.forEach((el) => observer.observe(el));
      }, 100);
    }
  }
}
