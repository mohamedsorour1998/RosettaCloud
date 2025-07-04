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
  testimonials: Testimonial[] = [
    {
      quote:
        'RosettaCloud has completely transformed how I teach programming. My students are more engaged and learn faster than ever before.',
      name: 'Ahmed Hassan',
      title: 'Computer Science Professor',
      company: 'Cairo University',
    },
    {
      quote:
        'The interactive labs made all the difference in my learning journey. I went from beginner to employed developer in just 6 months!',
      name: 'Layla Mahmoud',
      title: 'Frontend Developer',
      company: 'Tech Innovations',
    },
    {
      quote:
        "As an employer in the MENA region, I've found RosettaCloud graduates to be exceptionally well-prepared for real-world challenges.",
      name: 'Omar Farouk',
      title: 'CTO',
      company: 'Digital Solutions LLC',
    },
  ];

  statistics: Statistic[] = [
    { value: '25,000+', label: 'Active Students', icon: 'bi-people-fill' },
    { value: '150+', label: 'Expert Instructors', icon: 'bi-person-workspace' },
    { value: '300+', label: 'Courses & Labs', icon: 'bi-collection-fill' },
    { value: '92%', label: 'Employment Rate', icon: 'bi-briefcase-fill' },
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
