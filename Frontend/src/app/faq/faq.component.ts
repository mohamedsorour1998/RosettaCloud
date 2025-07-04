// In src/app/faq/faq.component.ts
import { Component, Input, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface FaqItem {
  question: string;
  answer: string;
}

@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './faq.component.html',
  styleUrls: ['./faq.component.scss'],
})
export class FaqComponent implements OnInit, AfterViewInit {
  @Input() faqItems: FaqItem[] = [];
  @Input() title: string = 'Frequently Asked Questions';
  @Input() showTitle: boolean = true;

  expandedFaqIndex: number | null = null;

  constructor() {}

  ngOnInit(): void {
    // Component initialization logic
  }

  ngAfterViewInit(): void {
    // Add scroll animations after view has been initialized
    this.addScrollAnimations();
  }

  /**
   * Toggles FAQ item expansion
   * @param index Index of FAQ to toggle
   */
  toggleFaq(index: number): void {
    this.expandedFaqIndex = this.expandedFaqIndex === index ? null : index;
  }

  /**
   * Add scroll animations to elements
   */
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
