import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';

import { RouterModule } from '@angular/router';
import { ScrollService } from '../services/scroll.service';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './privacy-policy.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./privacy-policy.component.scss'],
})
export class PrivacyPolicyComponent implements OnInit {
  lastUpdated = 'May 10, 2024';

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
