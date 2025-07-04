import { Injectable } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { BehaviorSubject, fromEvent } from 'rxjs';
import { filter, throttleTime } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class ScrollService {
  private lastScrollTop = 0;
  private readonly scrollThreshold = 5; // Lower threshold for more responsive behavior
  navbarVisible = new BehaviorSubject<boolean>(true);

  // Track the direction of the scroll
  private scrollingDown = false;

  constructor(private router: Router) {
    // Subscribe to navigation events to handle scroll behavior
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this.scrollToTop();
        this.resetNavbarVisibility();
      });

    // Set up scroll listener for navbar behavior
    this.setupScrollListener();
  }

  /**
   * Sets up the scroll event listener with throttling to improve performance
   */
  private setupScrollListener(): void {
    fromEvent(window, 'scroll')
      .pipe(throttleTime(100)) // Throttle to improve performance (runs at most every 100ms)
      .subscribe(() => {
        this.handleScrollEvent();
      });
  }

  /**
   * Handles scroll events to determine navbar visibility
   */
  private handleScrollEvent(): void {
    const currentScrollTop =
      window.pageYOffset || document.documentElement.scrollTop;

    // Always show navbar at the top of the page (with some buffer)
    if (currentScrollTop <= 10) {
      this.navbarVisible.next(true);
      this.lastScrollTop = currentScrollTop;
      return;
    }

    // Determine scroll direction
    this.scrollingDown = currentScrollTop > this.lastScrollTop;

    // Ensure we've scrolled enough to trigger a visibility change
    if (
      Math.abs(currentScrollTop - this.lastScrollTop) > this.scrollThreshold
    ) {
      // Hide when scrolling down, show when scrolling up
      this.navbarVisible.next(!this.scrollingDown);
      this.lastScrollTop = currentScrollTop;
    }
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

  /**
   * Resets navbar visibility state (call when changing pages)
   */
  resetNavbarVisibility(): void {
    this.navbarVisible.next(true);
    this.lastScrollTop = 0;
    this.scrollingDown = false;
  }
}
