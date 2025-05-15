import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { SafeUrlPipe } from '../pipes/safe-url.pipe';
import { FaqComponent, FaqItem } from '../faq/faq.component';

interface OfficeLocation {
  id: string;
  city: string;
  country: string;
  address: string;
  phone: string;
  email: string;
  hours: string;
  mapUrl: string;
}

@Component({
  selector: 'app-contact-us',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SafeUrlPipe, FaqComponent],
  templateUrl: './contact-us.component.html',
  styleUrl: './contact-us.component.scss',
})
export class ContactUsComponent implements OnInit {
  contactForm: FormGroup;
  formSubmitted = false;
  formSuccess = false;
  formError = false;

  // Locations data
  officeLocations: OfficeLocation[] = [
    {
      id: 'cairo',
      city: 'Cairo',
      country: 'Egypt',
      address: '123 Digital Avenue, Maadi, Cairo',
      phone: '+20 2 2754 9876',
      email: 'cairo@rosettacloud.app',
      hours: 'Sunday - Thursday: 9:00 AM - 5:00 PM',
      mapUrl: 'https://maps.google.com/?q=Cairo,Egypt',
    },
    {
      id: 'dubai',
      city: 'Dubai',
      country: 'UAE',
      address: '456 Innovation Tower, Sheikh Zayed Road, Dubai',
      phone: '+971 4 123 4567',
      email: 'dubai@rosettacloud.app',
      hours: 'Sunday - Thursday: 9:00 AM - 6:00 PM',
      mapUrl: 'https://maps.google.com/?q=Dubai,UAE',
    },
    {
      id: 'riyadh',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      address: '789 Digital District, King Fahd Road, Riyadh',
      phone: '+966 11 987 6543',
      email: 'riyadh@rosettacloud.app',
      hours: 'Sunday - Thursday: 8:00 AM - 4:00 PM',
      mapUrl: 'https://maps.google.com/?q=Riyadh,Saudi+Arabia',
    },
  ];

  // Selected location state
  selectedLocation: OfficeLocation;

  // FAQs data
  faqItems: FaqItem[] = [
    {
      question: 'How can I get technical support for my course?',
      answer:
        'For technical support with any course, please email support@rosettacloud.app with your course name and a detailed description of the issue. Our support team is available 24/7 and will respond within 24 hours.',
    },
    {
      question: 'Can I request a refund for a course?',
      answer:
        "Yes, we offer a 30-day money-back guarantee on all our courses. If you're not satisfied with your purchase, you can request a refund within 30 days by contacting our support team at refunds@rosettacloud.app.",
    },
    {
      question: 'How do I become an instructor on RosettaCloud?',
      answer:
        'To become an instructor, please fill out the application form at rosettacloud.app/become-instructor or email us at instructors@rosettacloud.app with your CV, areas of expertise, and a sample course outline.',
    },
    {
      question: 'Do you offer corporate training solutions?',
      answer:
        "Yes, we provide customized corporate training programs. Contact our enterprise team at enterprise@rosettacloud.app or call +20 2 2754 9870 to discuss your organization's specific needs.",
    },
    {
      question: 'Are courses available in multiple languages?',
      answer:
        "Many of our courses are available in Arabic, English, and French. You can filter courses by language on our course catalog page. We're continuously expanding our multilingual content.",
    },
  ];

  constructor(private fb: FormBuilder) {
    // Initialize with first location
    this.selectedLocation = this.officeLocations[0];

    // Initialize form
    this.contactForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      phone: [
        '',
        [Validators.pattern('^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-\\s./0-9]*$')],
      ],
      subject: ['', Validators.required],
      message: ['', [Validators.required, Validators.minLength(10)]],
      acceptTerms: [false, Validators.requiredTrue],
    });
  }

  ngOnInit(): void {
    this.addScrollAnimations();
  }

  // Select a location
  selectLocation(location: OfficeLocation): void {
    this.selectedLocation = location;
  }

  // Form submission
  onSubmit(): void {
    this.formSubmitted = true;

    if (this.contactForm.valid) {
      // Simulate API call with setTimeout
      setTimeout(() => {
        // Simulating successful submission (in real app, this would be an API call)
        this.formSuccess = true;
        this.formError = false;
        this.formSubmitted = false;
        this.contactForm.reset();

        // Reset form state after 5 seconds
        setTimeout(() => {
          this.formSuccess = false;
        }, 5000);
      }, 1500);
    } else {
      // Mark all fields as touched to trigger validation messages
      Object.keys(this.contactForm.controls).forEach((key) => {
        const control = this.contactForm.get(key);
        control?.markAsTouched();
      });
    }
  }

  // Form validation helpers
  hasError(controlName: string, errorName: string): boolean {
    const control = this.contactForm.get(controlName);
    return !!control && control.touched && control.hasError(errorName);
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
