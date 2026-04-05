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
      id: 'free',
      name: 'Free',
      price: { monthly: '$0', annual: '$0' },
      description: 'Real labs, real learning, no cost',
      featured: false,
      features: [
        { text: '2 hours/week real lab time', included: true },
        { text: 'VS Code + Docker + K8s in browser', included: true },
        { text: '1 course included', included: true },
        { text: 'AI tutor (rate limited)', included: true },
        { text: 'Community access', included: true },
        { text: 'Unlimited lab time', included: false },
        { text: 'All courses', included: false },
        { text: 'Snap & Ask (vision)', included: false },
      ],
      buttonText: 'Start Free',
      buttonLink: '/register',
    },
    {
      id: 'pro',
      name: 'Pro',
      price: { monthly: '$19', annual: '$179' },
      description: 'Unlimited labs and full AI tutoring',
      featured: true,
      features: [
        { text: 'Unlimited lab time', included: true },
        { text: 'All courses and modules', included: true },
        { text: 'Full AI tutor (no rate limits)', included: true },
        { text: 'Snap & Ask terminal analysis', included: true },
        { text: 'Priority lab provisioning', included: true },
        { text: 'Progress tracking and analytics', included: true },
        { text: 'Personalized learning path', included: true },
        { text: 'Cross-session AI memory', included: true },
      ],
      buttonText: 'Get Pro',
      buttonLink: '/register?plan=pro',
    },
    {
      id: 'university',
      name: 'University',
      price: { monthly: '$9/student', annual: '$89/student' },
      description: 'For bootcamps, universities, and teams · Volume discounts from $7/student for 50+ seats',
      featured: false,
      features: [
        { text: 'Everything in Pro', included: true },
        { text: 'Admin dashboard', included: true },
        { text: 'Cohort management', included: true },
        { text: 'Bulk student enrollment', included: true },
        { text: 'Custom course creation', included: true },
        { text: 'Student progress reports', included: true },
        { text: 'Priority support', included: true },
        { text: 'Volume discounts (50+ seats)', included: true },
      ],
      buttonText: 'See University Plans',
      buttonLink: '/university',
    },
  ];

  // FAQ data
  faqItems: FaqItem[] = [
    {
      question: 'What do I get with the free tier?',
      answer:
        'The free tier gives you 2 hours per week of real lab time with a dedicated Kubernetes cluster, Docker daemon, and VS Code in your browser. You get access to 1 course and the AI tutor with rate limits. No credit card required.',
    },
    {
      question: 'How is this different from AWS Skill Builder or Coursera?',
      answer:
        'Other platforms give you videos, quizzes, or console sandboxes. RosettaCloud provisions a real, dedicated Kubernetes cluster for every student, every session. You run real commands on real infrastructure with an AI tutor that guides your thinking through hints, not answers.',
    },
    {
      question: 'Can I switch plans later?',
      answer:
        'Yes, you can upgrade or downgrade at any time. If you upgrade, the new rate is prorated. If you downgrade, the change applies at the start of your next billing cycle.',
    },
    {
      question: 'What does the University plan include?',
      answer:
        'The University plan includes everything in Pro plus an admin dashboard, cohort management, bulk enrollment, custom courses, and student progress reports. Volume discounts are available for 50+ seats.',
    },
    {
      question: 'How much does each lab session cost to run?',
      answer:
        'Each lab runs on a spot t3.xlarge instance at approximately $0.04 per hour. The free tier subsidizes this cost. Pro subscribers at $19/month with typical usage have a gross margin above 98%, keeping the platform sustainable.',
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
