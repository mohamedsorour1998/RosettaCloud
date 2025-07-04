import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  ViewChild,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
import { Router, NavigationStart, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, filter } from 'rxjs';

import { UserService, User } from '../services/user.service';
import { ThemeService } from '../services/theme.service';
import { ScrollService } from '../services/scroll.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements OnInit, OnDestroy, AfterViewInit {
  isLoggedIn = false;
  currentUser: User | null = null;
  isMenuOpen = false;
  isScrolled = false;

  // Search functionality
  isSearchActive = false;
  searchQuery = '';
  searchSuggestions: string[] = [
    'JavaScript',
    'React Development',
    'Python for Data Science',
    'Machine Learning',
    'Web Development',
    'Mobile App Development',
  ];

  @ViewChild('searchInput') searchInput!: ElementRef;

  private subs: Subscription[] = [];

  constructor(
    private userSvc: UserService,
    private router: Router,
    public themeService: ThemeService,
    private scrollService: ScrollService
  ) {}

  /**
   * Track scroll position to add box-shadow to navbar when scrolled
   */
  @HostListener('window:scroll', [])
  onWindowScroll() {
    this.isScrolled = window.scrollY > 10;
  }

  /**
   * Close search overlay on escape key
   */
  @HostListener('document:keydown.escape', ['$event'])
  onKeydownHandler() {
    if (this.isSearchActive) {
      this.isSearchActive = false;
      document.body.classList.remove('overlay-active');
    }
  }

  ngOnInit(): void {
    // Subscribe to user authentication state
    this.subs.push(
      this.userSvc.currentUser$.subscribe((user) => {
        this.currentUser = user;
        this.isLoggedIn = !!user;
      })
    );

    // Auto-close mobile menu on navigation
    this.subs.push(
      this.router.events
        .pipe(filter((e) => e instanceof NavigationStart))
        .subscribe(() => {
          this.isMenuOpen = false;
          this.isSearchActive = false;
          document.body.classList.remove('overlay-active');
        })
    );

    // Check initial scroll position
    this.onWindowScroll();
  }

  ngAfterViewInit(): void {
    // Focus search input when the search overlay is opened
    this.subs.push(
      this.router.events
        .pipe(filter((e) => e instanceof NavigationStart))
        .subscribe(() => {
          // Close search on navigation
          this.isSearchActive = false;
          document.body.classList.remove('overlay-active');
        })
    );
  }

  /**
   * Get user initials for avatar
   */
  get initials(): string {
    if (!this.currentUser?.name) return 'U';
    const parts = this.currentUser.name.trim().split(/\s+/);
    return (
      parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')
    ).toUpperCase();
  }

  /**
   * Get user display name (first name or username)
   */
  get userDisplayName(): string {
    if (!this.currentUser?.name) return 'User';
    const parts = this.currentUser.name.trim().split(/\s+/);
    return parts[0]; // Return just the first name
  }

  /**
   * Log out the current user
   */
  logout(event: Event): void {
    event.preventDefault(); // Prevent default link behavior
    this.userSvc.logout();
    this.router.navigate(['/']);
    this.isMenuOpen = false;
  }

  /**
   * Toggle between light and dark theme
   */
  toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  /**
   * Toggle search overlay
   */
  toggleSearch(): void {
    this.isSearchActive = !this.isSearchActive;

    if (this.isSearchActive) {
      document.body.classList.add('overlay-active');
      // Focus the search input after the overlay is visible
      setTimeout(() => {
        if (this.searchInput) {
          this.searchInput.nativeElement.focus();
        }
      }, 100);
    } else {
      document.body.classList.remove('overlay-active');
      this.searchQuery = '';
    }
  }

  /**
   * Perform search and navigate to results
   */
  performSearch(): void {
    if (this.searchQuery.trim()) {
      this.router.navigate(['/courses'], {
        queryParams: { q: this.searchQuery },
      });
      this.toggleSearch(); // Close the search overlay
      this.scrollService.scrollToTop(); // Scroll to top of results
    }
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.subs.forEach((s) => s.unsubscribe());

    // Ensure overlay class is removed when component is destroyed
    document.body.classList.remove('overlay-active');
  }
}
