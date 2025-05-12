import { Injectable } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class ScrollService {
  constructor(private router: Router) {
    // Subscribe to navigation events to handle scroll behavior
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this.scrollToTop();
      });
  }

  /**
   * Scrolls to the top of the page smoothly
   */
  scrollToTop(): void {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  /**
   * Scrolls to a specific element by ID
   * @param elementId The ID of the element to scroll to
   * @param offset Optional offset from the top in pixels
   */
  scrollToElement(elementId: string, offset: number = 0): void {
    setTimeout(() => {
      const element = document.getElementById(elementId);
      if (element) {
        const y =
          element.getBoundingClientRect().top + window.pageYOffset + offset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }, 100);
  }
}
