import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ScrollService } from '../services/scroll.service';

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

  constructor(private scrollService: ScrollService) {}

  ngOnInit(): void {
    this.scrollService.scrollToTop();
  }

  /**
   * Scroll to specific section
   */
  scrollToSection(sectionId: string): void {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
