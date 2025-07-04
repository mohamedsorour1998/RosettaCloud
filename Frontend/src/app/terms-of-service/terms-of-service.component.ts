import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ScrollService } from '../services/scroll.service';

interface TermsSection {
  id: string;
  title: string;
  content: string[];
  subsections?: {
    title: string;
    content: string[];
    isList?: boolean;
    listItems?: string[];
  }[];
  highlightedBox?: string;
}

@Component({
  selector: 'app-terms-of-service',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './terms-of-service.component.html',
  styleUrls: ['./terms-of-service.component.scss'],
})
export class TermsOfServiceComponent implements OnInit {
  lastUpdated: string = 'May 10, 2024';
  effectiveDate: string = 'June 1, 2024';
  showBackToTop: boolean = false;
  contactEmail: string = 'legal@rosettacloud.app';

  // Table of contents items
  tocItems = [
    { id: 'acceptance', title: 'Acceptance of Terms' },
    { id: 'user-accounts', title: 'User Accounts' },
    { id: 'platform-access', title: 'Platform Access and Use' },
    { id: 'content', title: 'Content and Intellectual Property' },
    { id: 'payments', title: 'Payments and Billing' },
    { id: 'privacy', title: 'Privacy Policy' },
    { id: 'limitations', title: 'Limitations of Liability' },
    { id: 'termination', title: 'Termination' },
    { id: 'changes', title: 'Changes to Terms' },
    { id: 'contact', title: 'Contact Us' },
  ];

  // Terms sections with content
  termsSections: TermsSection[] = [
    {
      id: 'acceptance',
      title: '1. Acceptance of Terms',
      content: [
        'By accessing or using our platform, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using or accessing this platform.',
        'These Terms of Service govern your use of our educational platform, website, and services (collectively referred to as "the Platform"). These terms constitute a legally binding agreement between you and RosettaCloud Learning.',
      ],
      highlightedBox:
        'By creating an account or using our services, you acknowledge that you have read, understood, and agree to be bound by these terms.',
    },
    {
      id: 'user-accounts',
      title: '2. User Accounts',
      content: [
        'When you create an account with us, you must provide accurate, complete, and up-to-date information. You are responsible for safeguarding the password that you use to access the Platform and for any activities or actions taken under your password.',
      ],
      subsections: [
        {
          title: '2.1 Account Security',
          content: [
            'You agree to notify us immediately of any unauthorized access to or use of your username, password, or any other breach of security. We reserve the right to disable any user account at any time if, in our opinion, you have failed to comply with these Terms.',
          ],
        },
        {
          title: '2.2 Account Types',
          content: [
            'We offer different types of accounts including student accounts, instructor accounts, and enterprise accounts. Each account type may have specific terms and features that apply in addition to these general Terms of Service.',
          ],
        },
      ],
    },
    {
      id: 'platform-access',
      title: '3. Platform Access and Use',
      content: [
        'RosettaCloud grants you a limited, non-exclusive, non-transferable, and revocable license to access and use the Platform for educational and personal purposes in accordance with these Terms of Service.',
      ],
      subsections: [
        {
          title: '3.1 Prohibited Activities',
          content: ['You agree not to:'],
          isList: true,
          listItems: [
            'Use the Platform for any illegal purpose or in violation of any applicable laws',
            'Attempt to gain unauthorized access to any part of the Platform',
            'Interfere with or disrupt the Platform or servers connected to the Platform',
            'Collect or harvest any information from the Platform without authorization',
            'Upload, transmit, or distribute any viruses, malware, or other harmful code',
            'Engage in any activity that could damage, disable, or impair the functionality of the Platform',
          ],
        },
      ],
    },
    {
      id: 'content',
      title: '4. Content and Intellectual Property',
      content: [
        'The Platform contains content owned by RosettaCloud and its licensors, including text, graphics, videos, course materials, and other intellectual property. All content is protected by copyright, trademark, and other intellectual property laws.',
      ],
      subsections: [
        {
          title: '4.1 User-Generated Content',
          content: [
            'You retain ownership of any content you create and submit to the Platform. By submitting content, you grant RosettaCloud a worldwide, non-exclusive, royalty-free license to use, reproduce, modify, publish, and distribute your content for the purposes of operating and improving the Platform.',
          ],
        },
        {
          title: '4.2 Content Guidelines',
          content: ['You agree that any content you submit will not:'],
          isList: true,
          listItems: [
            'Infringe on any intellectual property rights',
            'Contain defamatory, offensive, or harmful material',
            'Include personal or confidential information of any third party without consent',
            'Violate any applicable laws or regulations',
          ],
        },
      ],
    },
    {
      id: 'payments',
      title: '5. Payments and Billing',
      content: [
        'Certain features of the Platform require payment of fees. All fees are stated in USD unless otherwise specified and are non-refundable except as otherwise provided in these Terms.',
      ],
      subsections: [
        {
          title: '5.1 Subscription Plans',
          content: [
            'We offer various subscription plans with different features and pricing. By selecting a subscription plan, you agree to pay the applicable fees according to the billing terms presented at the time of purchase.',
          ],
        },
        {
          title: '5.2 Refund Policy',
          content: [
            'Refunds may be granted at our discretion within 30 days of purchase if you are dissatisfied with the service or if technical issues prevented you from accessing the content. To request a refund, please contact our support team.',
          ],
        },
      ],
    },
    {
      id: 'privacy',
      title: '6. Privacy Policy',
      content: [
        'Your use of the Platform is also governed by our Privacy Policy, which is incorporated into these Terms by reference. Please review our Privacy Policy to understand how we collect, use, and protect your information.',
      ],
      highlightedBox:
        'We take your privacy seriously and implement reasonable measures to protect your personal information. For detailed information about how we handle your data, please refer to our Privacy Policy.',
    },
    {
      id: 'limitations',
      title: '7. Limitations of Liability',
      content: [
        'To the maximum extent permitted by law, RosettaCloud shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of or inability to use the Platform.',
      ],
      subsections: [
        {
          title: '7.1 Disclaimer of Warranties',
          content: [
            'The Platform is provided "as is" and "as available" without warranties of any kind, either express or implied. We do not guarantee that the Platform will always be secure, error-free, or available at any particular time.',
          ],
        },
      ],
    },
    {
      id: 'termination',
      title: '8. Termination',
      content: [
        'We may terminate or suspend your account and access to the Platform immediately, without prior notice or liability, for any reason, including if you breach these Terms of Service.',
        'Upon termination, your right to use the Platform will immediately cease. All provisions of these Terms which by their nature should survive termination shall survive, including ownership provisions, warranty disclaimers, indemnity, and limitations of liability.',
      ],
    },
    {
      id: 'changes',
      title: '9. Changes to Terms',
      content: [
        "We reserve the right to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days' notice prior to any new terms taking effect. What constitutes a material change will be determined at our sole discretion.",
        'By continuing to access or use our Platform after those revisions become effective, you agree to be bound by the revised terms. If you do not agree to the new terms, please stop using the Platform.',
      ],
    },
    {
      id: 'contact',
      title: '10. Contact Us',
      content: [
        'If you have any questions about these Terms, please contact us.',
      ],
    },
  ];

  // Hero content
  heroTitle: string = 'Terms of Service';
  heroSubtitle: string =
    'Please read these terms carefully before using our platform and services.';

  // Contact section content
  contactSectionTitle: string = 'Have Questions?';
  contactSectionContent: string =
    "We're here to help! If you have any questions about our Terms of Service or need assistance, please reach out to our support team.";

  // Acceptance section content
  acceptanceSectionTitle: string = 'Ready to Get Started?';
  acceptanceSectionContent: string =
    "By continuing to use our platform, you acknowledge that you've read and agree to these Terms of Service.";
  acceptanceButtonText: string = 'Create an Account';
  acceptanceButtonLink: string = '/register';

  constructor(private scrollService: ScrollService) {}

  ngOnInit(): void {
    this.scrollService.scrollToTop();
    this.setupSectionHighlighting();
    this.checkUrlHash();
  }

  /**
   * Check if URL has a hash and scroll to that section
   */
  private checkUrlHash(): void {
    const hash = window.location.hash.substring(1);
    if (hash) {
      setTimeout(() => {
        this.scrollToSection(hash);
      }, 100);
    }
  }

  /**
   * Scroll to specific section
   */
  scrollToSection(sectionId: string): void {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });

      // Update URL without page reload
      history.pushState(null, '', `#${sectionId}`);

      // Update active link in TOC
      this.updateActiveTocLink(sectionId);
    }
  }

  /**
   * Scroll to top of page
   */
  scrollToTop(): void {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  /**
   * Print terms of service
   */
  printTerms(): void {
    window.print();
  }

  /**
   * Show back to top button when user scrolls down
   */
  @HostListener('window:scroll', [])
  onWindowScroll(): void {
    const scrollPosition =
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;
    this.showBackToTop = scrollPosition > 300;

    // Update active TOC link based on scroll position
    this.updateActiveTocLinkOnScroll();
  }

  /**
   * Setup intersection observer to highlight TOC links on scroll
   */
  private setupSectionHighlighting(): void {
    // Check if IntersectionObserver is available
    if (typeof IntersectionObserver !== 'undefined') {
      const options = {
        rootMargin: '-100px 0px -80% 0px',
        threshold: 0,
      };

      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.updateActiveTocLink(entry.target.id);
          }
        });
      }, options);

      // Observe all section elements
      setTimeout(() => {
        document.querySelectorAll('.terms-section').forEach((section) => {
          observer.observe(section);
        });
      }, 100);
    }
  }

  /**
   * Update active link in table of contents
   */
  private updateActiveTocLink(sectionId: string): void {
    // Remove active class from all links
    document.querySelectorAll('.terms-toc a').forEach((link) => {
      link.classList.remove('active');
    });

    // Add active class to current section link
    const activeLink = document.querySelector(
      `.terms-toc a[href="#${sectionId}"]`
    );
    if (activeLink) {
      activeLink.classList.add('active');
    }
  }

  /**
   * Update active TOC link based on scroll position
   */
  private updateActiveTocLinkOnScroll(): void {
    if (typeof IntersectionObserver === 'undefined') {
      // Fallback for browsers that don't support IntersectionObserver
      const sections = document.querySelectorAll('.terms-section');
      const scrollPosition = window.scrollY + 150;

      let currentSection = '';

      sections.forEach((section) => {
        const sectionTop = (section as HTMLElement).offsetTop;
        if (scrollPosition >= sectionTop) {
          currentSection = section.id;
        }
      });

      if (currentSection) {
        this.updateActiveTocLink(currentSection);
      }
    }
  }
}
