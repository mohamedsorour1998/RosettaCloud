import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../services/theme.service';
import { ScrollService } from '../services/scroll.service';

interface FaqCategory {
  id: string;
  name: string;
  icon: string;
  faqs: Faq[];
}

interface Faq {
  question: string;
  answer: string;
  isExpanded?: boolean;
}

@Component({
  selector: 'app-help-center',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './help-center.component.html',
  styleUrls: ['./help-center.component.scss'],
})
export class HelpCenterComponent implements OnInit {
  searchQuery: string = '';
  filteredFaqs: Faq[] = [];
  selectedCategory: string = 'all';
  isSearching: boolean = false;

  faqCategories: FaqCategory[] = [
    {
      id: 'account',
      name: 'Account & Profile',
      icon: 'bi-person-circle',
      faqs: [
        {
          question: 'How do I create an account?',
          answer:
            'To create an account, click on the "Sign Up" button in the top right corner of the homepage. You\'ll need to provide your email address, create a password, and fill in some basic profile information. After verifying your email address, you\'ll have full access to your RosettaCloud account.',
        },
        {
          question: 'How do I reset my password?',
          answer:
            'If you forgot your password, click on the "Login" button, then select "Forgot Password". Enter the email address associated with your account, and we\'ll send you a password reset link. Follow the instructions in the email to create a new password.',
        },
        {
          question: 'Can I change my username or email address?',
          answer:
            'You can change your username at any time from your Profile Settings. To change your email address, go to Account Settings > Email, enter your new email address, and verify it by clicking on the confirmation link sent to your new email.',
        },
      ],
    },
    {
      id: 'courses',
      name: 'Courses & Learning',
      icon: 'bi-journal-code',
      faqs: [
        {
          question: 'How do I enroll in a course?',
          answer:
            "To enroll in a course, browse the course catalog and select the course you're interested in. On the course page, click the \"Enroll Now\" button and follow the payment process (if it's a paid course) or simply confirm your enrollment (if it's a free course).",
        },
        {
          question: 'Can I download course materials for offline viewing?',
          answer:
            'Yes, most course materials can be downloaded for offline viewing. Look for the download icon next to videos, PDFs, and other resources. Note that some interactive elements may not be available offline.',
        },
        {
          question: 'How do I track my progress in a course?',
          answer:
            'Your progress is automatically tracked as you complete lessons and activities. You can view your overall progress on your dashboard or in the "My Courses" section. Each course also shows a progress bar indicating how much you\'ve completed.',
        },
        {
          question: 'How do I get a certificate after completing a course?',
          answer:
            'Once you\'ve completed all required components of a course, your certificate will be automatically generated and available in your "Certificates" section. You can download it as a PDF or share it directly to your LinkedIn profile.',
        },
      ],
    },
    {
      id: 'payment',
      name: 'Payment & Billing',
      icon: 'bi-credit-card',
      faqs: [
        {
          question: 'What payment methods do you accept?',
          answer:
            'We accept major credit cards (Visa, Mastercard, American Express), PayPal, and bank transfers. In select regions, we also support mobile payment options like Apple Pay and Google Pay.',
        },
        {
          question: "Can I get a refund if I'm not satisfied with a course?",
          answer:
            "Yes, we offer a 30-day money-back guarantee for most courses. If you're not satisfied with your purchase, you can request a refund within 30 days of enrollment, provided you haven't completed more than 25% of the course content.",
        },
        {
          question: 'How do I update my billing information?',
          answer:
            'You can update your billing information by going to Account Settings > Billing Information. From there, you can add, edit, or remove payment methods, and update your billing address.',
        },
      ],
    },
    {
      id: 'technical',
      name: 'Technical Support',
      icon: 'bi-gear',
      faqs: [
        {
          question: 'What browsers are supported?',
          answer:
            'RosettaCloud supports the latest versions of Chrome, Firefox, Safari, and Edge. For the best experience, we recommend using Chrome or Firefox with your browser updated to the latest version.',
        },
        {
          question:
            'Videos are not playing or are buffering frequently. What should I do?',
          answer:
            "If you're experiencing playback issues, try: 1) Refreshing the page, 2) Checking your internet connection, 3) Lowering the video quality in the player settings, 4) Clearing your browser cache, or 5) Trying a different browser. If problems persist, please contact our support team.",
        },
        {
          question: 'How do I enable notifications?',
          answer:
            'To enable notifications, go to Account Settings > Notifications. You can choose which types of notifications you want to receive (email, browser, or mobile) and customize your preferences for course updates, forum replies, and other activities.',
        },
      ],
    },
  ];

  allFaqs: Faq[] = [];

  constructor(
    public themeService: ThemeService,
    private scrollService: ScrollService
  ) {}

  ngOnInit(): void {
    // Combine all FAQs from all categories
    this.faqCategories.forEach((category) => {
      this.allFaqs = [...this.allFaqs, ...category.faqs];
    });

    // Initialize with all FAQs
    this.filteredFaqs = this.allFaqs;
  }

  /**
   * Select a category to filter FAQs
   */
  selectCategory(categoryId: string): void {
    this.selectedCategory = categoryId;
    this.searchQuery = '';
    this.filterFaqs();
  }

  /**
   * Toggle FAQ expansion
   */
  toggleFaq(faq: Faq): void {
    faq.isExpanded = !faq.isExpanded;
  }

  /**
   * Filter FAQs based on search query and selected category
   */
  filterFaqs(): void {
    this.isSearching = true;

    // Apply category filter first
    let result: Faq[] = [];

    if (this.selectedCategory === 'all') {
      result = [...this.allFaqs];
    } else {
      const category = this.faqCategories.find(
        (c) => c.id === this.selectedCategory
      );
      if (category) {
        result = [...category.faqs];
      }
    }

    // Then apply search filter if there's a query
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase().trim();

      result = result.filter(
        (faq) =>
          faq.question.toLowerCase().includes(query) ||
          faq.answer.toLowerCase().includes(query)
      );
    }

    // Update filtered FAQs
    this.filteredFaqs = result;
    this.isSearching = false;
  }
  /**
   * Get category name by ID
   */
  getCategoryName(categoryId: string): string {
    if (categoryId === 'all') {
      return 'Frequently Asked Questions';
    }

    const category = this.faqCategories.find((c) => c.id === categoryId);
    return category ? category.name : 'Frequently Asked Questions';
  }
  /**
   * Handle search input changes
   */
  onSearchChange(): void {
    this.filterFaqs();
  }

  /**
   * Clear search input
   */
  clearSearch(): void {
    this.searchQuery = '';
    this.filterFaqs();
  }

  /**
   * Contact support form will be implemented here
   */
  submitContactForm(): void {
    // Implementation for contacting support will go here
    alert(
      'Thank you for your message. Our support team will get back to you shortly.'
    );
  }
}
