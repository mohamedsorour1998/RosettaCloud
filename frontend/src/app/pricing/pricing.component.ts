import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FaqComponent, FaqItem } from '../faq/faq.component';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, FaqComponent, RouterModule],
  templateUrl: './pricing.component.html',
  styleUrls: ['./pricing.component.scss'],
})
export class PricingComponent implements OnInit {
  // Billing cycle state
  billingCycle: 'monthly' | 'annual' = 'monthly';

  // Pricing plans data
  pricingPlans = [
    {
      id: 'basic',
      name: 'Basic',
      price: { monthly: 'Free', annual: 'Free' },
      description: 'For beginners exploring our platform',
      featured: false,
      features: [
        { text: 'Access to free courses', included: true },
        { text: 'Community forum access', included: true },
        { text: 'Basic learning path', included: true },
        { text: 'Premium courses', included: false },
        { text: 'Certificate of completion', included: false },
        { text: 'Interactive coding labs', included: false },
      ],
      buttonText: 'Create Free Account',
      buttonLink: '/register',
    },
    {
      id: 'premium',
      name: 'Premium',
      price: { monthly: '$29', annual: '$249' },
      description: 'Most popular for self-learners',
      featured: true,
      features: [
        { text: 'All Basic features', included: true },
        { text: 'Unlimited access to all courses', included: true },
        { text: 'Interactive coding labs', included: true },
        { text: 'AI learning assistant', included: true },
        { text: 'Certificates of completion', included: true },
        { text: 'Project-based learning', included: true },
      ],
      buttonText: 'Get Premium',
      buttonLink: '/register?plan=premium',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: { monthly: 'Custom', annual: 'Custom' },
      description: 'For organizations and teams',
      featured: false,
      features: [
        { text: 'All Premium features', included: true },
        { text: 'Custom learning paths', included: true },
        { text: 'Dedicated account manager', included: true },
        { text: 'Advanced analytics dashboard', included: true },
        { text: 'Single Sign-On (SSO)', included: true },
        { text: 'API access', included: true },
      ],
      buttonText: 'Contact Sales',
      buttonLink: '/contact?subject=enterprise',
    },
  ];

  // FAQ data
  faqItems: FaqItem[] = [
    {
      question: 'What forms of payment do you accept?',
      answer:
        'We accept all major credit cards (Visa, MasterCard, American Express), PayPal, and bank transfers for enterprise customers. For specific regions, we also offer local payment methods.',
    },
    {
      question: 'Can I switch plans later?',
      answer:
        'Yes, you can upgrade or downgrade your plan at any time. If you upgrade, the new rate will be prorated for the remainder of your billing cycle. If you downgrade, the new rate will apply at the start of your next billing cycle.',
    },
    {
      question: 'Is there a refund policy?',
      answer:
        'Yes, we offer a 30-day money-back guarantee on all our paid plans. If youre not satisfied with your purchase, you can request a refund within 30 days by contacting our support team.',
    },
    {
      question: 'Do you offer discounts for students or educators?',
      answer:
        'Yes, we offer special pricing for eligible students and educators. Please contact our support team with valid academic credentials to apply for the educational discount.',
    },
    {
      question: 'How many users can I add to an Enterprise plan?',
      answer:
        'Our Enterprise plans are fully customizable based on your organizations needs. There is no set limit on the number of users, and pricing is tailored to your specific requirements. Contact our sales team for a custom quote.',
    },
  ];

  constructor() {}

  ngOnInit(): void {
    this.addScrollAnimations();
  }

  // Toggle between monthly and annual billing
  toggleBillingCycle(cycle: 'monthly' | 'annual'): void {
    this.billingCycle = cycle;
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
