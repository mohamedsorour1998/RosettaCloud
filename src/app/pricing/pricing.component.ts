import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ThemeService } from '../services/theme.service';

interface PricingPlan {
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  popular?: boolean;
  features: {
    included: string[];
    excluded: string[];
  };
  buttonText: string;
  buttonClass: string;
  cardClass?: string;
}

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './pricing.component.html',
  styleUrls: ['./pricing.component.scss'],
})
export class PricingComponent implements OnInit {
  isAnnual = false;

  plans: PricingPlan[] = [
    {
      name: 'Free',
      monthlyPrice: 0,
      annualPrice: 0,
      features: {
        included: [
          'Access to basic courses',
          'Community support',
          '1 labs session',
        ],
        excluded: ['No certificate', 'Limited exercises'],
      },
      buttonText: 'Get Started',
      buttonClass: 'btn-outline-primary',
    },
    {
      name: 'Standard',
      monthlyPrice: 19,
      annualPrice: 15,
      popular: true,
      features: {
        included: [
          'Access to all courses',
          'Priority support',
          '10 labs sessions',
          'Course certificates',
          'Unlimited exercises',
        ],
        excluded: [],
      },
      buttonText: 'Get Started',
      buttonClass: 'btn-primary',
      cardClass: 'border-primary',
    },
    {
      name: 'Pro',
      monthlyPrice: 49,
      annualPrice: 39,
      features: {
        included: [
          'Everything in Standard',
          '1-on-1 mentoring',
          'Unlimited labs sessions',
          'Career guidance',
          'Team collaboration',
        ],
        excluded: [],
      },
      buttonText: 'Get Started',
      buttonClass: 'btn-outline-primary',
    },
  ];

  faqs = [
    {
      question: 'Can I switch plans later?',
      answer:
        "Yes, you can upgrade or downgrade your plan at any time. When upgrading, you'll be charged the prorated difference for the remainder of your billing cycle. When downgrading, the new price will take effect at the start of your next billing cycle.",
      open: true,
    },
    {
      question: 'Do you offer student discounts?',
      answer:
        'Yes! We offer a 50% discount on our Standard and Pro plans for eligible students. To apply for the student discount, please email us with proof of enrollment such as a student ID or enrollment letter.',
      open: false,
    },
    {
      question: 'What payment methods do you accept?',
      answer:
        "We accept all major credit cards (Visa, MasterCard, American Express, Discover), PayPal, and bank transfers for annual enterprise plans. Unfortunately, we don't accept cryptocurrency at this time.",
      open: false,
    },
    {
      question: 'Can I cancel my subscription?',
      answer:
        "Yes, you can cancel your subscription at any time. If you cancel, you'll continue to have access to your paid features until the end of your current billing period. We don't offer refunds for partial billing periods.",
      open: false,
    },
  ];

  enterpriseFeatures = [
    'Customized curriculum',
    'Dedicated account manager',
    'Learning management system integration',
    'Custom lab environments',
    'Analytics and reporting',
  ];

  constructor(private themeService: ThemeService) {
    // Fix for Bootstrap Collapse animation
    if (typeof document !== 'undefined') {
      // Add a small delay to ensure DOM is ready
      setTimeout(() => {
        const style = document.createElement('style');
        style.textContent = `
          .collapsing {
            transition: height 0.35s ease !important;
            height: 0;
            overflow: hidden;
          }
        `;
        document.head.appendChild(style);
      }, 0);
    }
  }
  ngOnInit(): void {
    // Check for saved preference
    const savedBilling = localStorage.getItem('preferredBilling');
    if (savedBilling) {
      this.isAnnual = savedBilling === 'annual';
    }
  }

  toggleBilling(): void {
    // No need to toggle again, as [(ngModel)] already changes isAnnual
    // Just save the preference
    localStorage.setItem(
      'preferredBilling',
      this.isAnnual ? 'annual' : 'monthly'
    );
  }

  toggleFaq(index: number): void {
    this.faqs[index].open = !this.faqs[index].open;

    // Close other FAQs (accordion behavior)
    this.faqs.forEach((faq, i) => {
      if (i !== index) {
        faq.open = false;
      }
    });
  }

  getAnnualPrice(plan: PricingPlan): number {
    return plan.annualPrice * 12;
  }
}
