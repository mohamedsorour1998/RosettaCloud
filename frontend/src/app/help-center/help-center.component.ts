// help-center.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FaqComponent, FaqItem } from '../faq/faq.component';

interface HelpCategory {
  id: string;
  title: string;
  description: string;
  icon: string;
  articleCount: number;
  route: string;
}

interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  categoryId: string;
  featured: boolean;
}

@Component({
  selector: 'app-help-center',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, FaqComponent],
  templateUrl: './help-center.component.html',
  styleUrls: ['./help-center.component.scss'],
})
export class HelpCenterComponent implements OnInit {
  // Search functionality
  searchQuery = '';
  isSearching = false;
  showSearchResults = false;
  searchResults: HelpArticle[] = [];

  // Categories
  helpCategories: HelpCategory[] = [
    {
      id: 'getting-started',
      title: 'Getting Started',
      description: 'Everything you need to know to start using RosettaCloud',
      icon: 'bi-rocket-takeoff',
      articleCount: 8,
      route: '/help-center/getting-started',
    },
    {
      id: 'account',
      title: 'Account Management',
      description: 'Learn how to manage your account, profile, and settings',
      icon: 'bi-person-gear',
      articleCount: 12,
      route: '/help-center/account',
    },
    {
      id: 'courses',
      title: 'Courses & Learning',
      description:
        'Information about courses, progress tracking, and certificates',
      icon: 'bi-book',
      articleCount: 15,
      route: '/help-center/courses',
    },
    {
      id: 'labs',
      title: 'Interactive Labs',
      description:
        'How to use labs, troubleshoot common issues, and get support',
      icon: 'bi-terminal',
      articleCount: 10,
      route: '/help-center/labs',
    },
    {
      id: 'billing',
      title: 'Billing & Subscriptions',
      description: 'Information about payments, subscriptions, and refunds',
      icon: 'bi-credit-card',
      articleCount: 9,
      route: '/help-center/billing',
    },
    {
      id: 'enterprise',
      title: 'Enterprise Solutions',
      description:
        'Resources for organizations using RosettaCloud for team training',
      icon: 'bi-building',
      articleCount: 7,
      route: '/help-center/enterprise',
    },
  ];

  // Featured articles
  featuredArticles: HelpArticle[] = [
    {
      id: 'create-account',
      title: 'How to create and set up your account',
      summary:
        'A step-by-step guide to creating your RosettaCloud account and setting up your profile',
      categoryId: 'getting-started',
      featured: true,
    },
    {
      id: 'enroll-course',
      title: 'Enrolling in a course',
      summary:
        'Learn how to browse and enroll in courses that match your learning goals',
      categoryId: 'courses',
      featured: true,
    },
    {
      id: 'lab-setup',
      title: 'Setting up your first lab environment',
      summary:
        'Everything you need to know about getting started with interactive labs',
      categoryId: 'labs',
      featured: true,
    },
    {
      id: 'billing-faq',
      title: 'Billing and subscription FAQ',
      summary:
        'Answers to common questions about payments, subscription management, and refunds',
      categoryId: 'billing',
      featured: true,
    },
  ];

  // Common questions for FAQ section
  faqItems: FaqItem[] = [
    {
      question: 'How do I reset my password?',
      answer:
        'You can reset your password by clicking on the "Forgot Password" link on the login page. Enter your email address, and we\'ll send you a password reset link that will be valid for 24 hours.',
    },
    {
      question: 'Can I download course materials for offline viewing?',
      answer:
        'Yes, Premium subscribers can download videos, slides, and other course materials for offline viewing. Look for the download icon on the course content page. Note that lab environments require an internet connection.',
    },
    {
      question: 'How do I get a certificate after completing a course?',
      answer:
        'Certificates are automatically generated once you\'ve completed all required modules and passed the final assessment with a score of at least 70%. You can access your certificates from your Profile page under the "Certificates" tab.',
    },
    {
      question: 'What browsers are supported for labs?',
      answer:
        'Our lab environments work best with Chrome, Firefox, and Edge (latest versions). Safari is supported for most features but may have limited functionality for certain specialized labs. We recommend using Chrome for the best experience.',
    },
    {
      question: 'How can I change my subscription plan?',
      answer:
        'You can change your subscription plan at any time from your Account Settings page. Select "Subscription" and choose "Change Plan" to see available options. Upgrades take effect immediately, while downgrades will apply at the end of your current billing cycle.',
    },
  ];

  constructor() {}

  ngOnInit(): void {
    this.addScrollAnimations();
  }

  // Helper method for getting category title
  getCategoryTitle(categoryId: string): string {
    const category = this.helpCategories.find((c) => c.id === categoryId);
    return category ? category.title : 'General';
  }

  // Search functionality
  searchArticles(): void {
    if (!this.searchQuery.trim()) {
      this.searchResults = [];
      this.showSearchResults = false;
      return;
    }

    this.isSearching = true;
    this.showSearchResults = true;

    // Simulate API search with setTimeout
    setTimeout(() => {
      // Get all articles (in a real app, you would have a complete list or call an API)
      const allArticles = [
        ...this.featuredArticles,
        // Add more articles that aren't featured
        {
          id: 'change-email',
          title: 'How to change your email address',
          summary:
            'Instructions for updating your email address and verifying your new email',
          categoryId: 'account',
          featured: false,
        },
        {
          id: 'payment-methods',
          title: 'Adding and managing payment methods',
          summary:
            'Learn how to add, update, or remove payment methods from your account',
          categoryId: 'billing',
          featured: false,
        },
        {
          id: 'track-progress',
          title: 'Tracking your learning progress',
          summary:
            'How to view and understand your progress across all your enrolled courses',
          categoryId: 'courses',
          featured: false,
        },
      ];

      // Filter articles based on search query
      const query = this.searchQuery.toLowerCase();
      this.searchResults = allArticles.filter(
        (article) =>
          article.title.toLowerCase().includes(query) ||
          article.summary.toLowerCase().includes(query)
      );

      this.isSearching = false;
    }, 500); // Simulate network delay
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
    this.showSearchResults = false;
  }

  // Navigation
  navigateToCategory(categoryId: string): void {
    // In a real app, you would use the Router service to navigate
    console.log(`Navigating to category: ${categoryId}`);
    // this.router.navigate(['/help-center', categoryId]);
  }

  navigateToArticle(articleId: string): void {
    // In a real app, you would use the Router service to navigate
    console.log(`Navigating to article: ${articleId}`);
    // this.router.navigate(['/help-center/article', articleId]);
  }

  // Add scroll animations
  private addScrollAnimations(): void {
    if (
      typeof document !== 'undefined' &&
      typeof IntersectionObserver !== 'undefined'
    ) {
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

      // Observe elements with animation classes
      setTimeout(() => {
        document.querySelectorAll('.animate-on-scroll').forEach((el) => {
          observer.observe(el);
        });
      }, 100);
    }
  }
}
