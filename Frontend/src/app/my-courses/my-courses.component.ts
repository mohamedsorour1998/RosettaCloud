import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  NgZone,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { UserService, User } from '../services/user.service';
import { ThemeService } from '../services/theme.service';
import { ScrollService } from '../services/scroll.service';

// Course interface for enrolled courses
interface EnrolledCourse {
  id: string;
  title: string;
  instructor: string;
  imageUrl: string;
  progress: number;
  lastAccessed: Date;
  completionCertificate?: boolean;
  nextSection?: string;
  estimatedTimeLeft?: string;
  category: string;
  tags: string[];
  // Indicates if there are updates since last login
  hasUpdates?: boolean;
}

@Component({
  selector: 'app-my-courses',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './my-courses.component.html',
  styleUrls: ['./my-courses.component.scss'],
})
export class MyCoursesComponent implements OnInit, OnDestroy, AfterViewInit {
  // Current user data
  currentUser: User | null = null;

  // Courses filtering and display
  enrolledCourses: EnrolledCourse[] = [];
  filteredCourses: EnrolledCourse[] = [];
  selectedFilter: string = 'all';
  searchQuery: string = '';

  // Loading states
  isLoading: boolean = true;

  // Sort options
  sortOptions = [
    { value: 'recent', label: 'Recently Accessed' },
    { value: 'progress', label: 'Progress (High to Low)' },
    { value: 'title', label: 'Title (A-Z)' },
  ];
  selectedSort: string = 'recent';

  private subs: Subscription[] = [];

  constructor(
    private userService: UserService,
    public themeService: ThemeService,
    private scrollService: ScrollService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Subscribe to user data
    this.subs.push(
      this.userService.currentUser$.subscribe((user) => {
        this.currentUser = user;
        this.loadEnrolledCourses();
      })
    );
  }

  ngAfterViewInit(): void {
    // Add safety checks to ensure courses are displayed
    setTimeout(() => {
      if (
        this.enrolledCourses.length > 0 &&
        this.filteredCourses.length === 0
      ) {
        console.log('Courses not displaying, forcing refresh');
        this.applyFilters();
      }

      // Initialize scroll animations
      this.initScrollAnimations();

      // Check DOM for course elements
      setTimeout(() => {
        const courseElements = document.querySelectorAll('.course-card');
        if (this.enrolledCourses.length > 0 && courseElements.length === 0) {
          console.log('No course elements in DOM, forcing refresh');
          this.forceRefresh();
        }
      }, 500);
    }, 1000);
  }

  /**
   * Initialize scroll animations
   */
  initScrollAnimations(): void {
    if (typeof IntersectionObserver !== 'undefined') {
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

  /**
   * Force refresh of course data - use this as last resort
   */
  forceRefresh(): void {
    console.log('Force refreshing courses display');

    this.zone.run(() => {
      // Deep clone the array to create a new reference
      const tempCourses = JSON.parse(JSON.stringify(this.enrolledCourses));

      // Clear arrays first
      this.enrolledCourses = [];
      this.filteredCourses = [];

      // Force change detection
      setTimeout(() => {
        this.enrolledCourses = tempCourses;
        this.filteredCourses = [...tempCourses];
        this.cdr.detectChanges();
      }, 0);
    });
  }

  /**
   * Get count of enrolled courses
   */
  get enrolledCoursesCount(): number {
    return this.enrolledCourses.length;
  }

  /**
   * Get count of completed courses
   */
  get completedCoursesCount(): number {
    return this.enrolledCourses.filter((course) => course.progress === 100)
      .length;
  }

  /**
   * Get count of courses with updates
   */
  get updatedCoursesCount(): number {
    return this.enrolledCourses.filter((course) => course.hasUpdates).length;
  }

  /**
   * Track courses for ngFor
   */
  trackByCourse(index: number, course: EnrolledCourse): string {
    return course.id;
  }

  /**
   * Load the user's enrolled courses
   * (Simulating API call with mock data for now)
   */
  loadEnrolledCourses(): void {
    this.isLoading = true;

    this.zone.run(() => {
      setTimeout(() => {
        this.enrolledCourses = [
          {
            id: 'linux-docker-k8s-101',
            title: 'Linux, Docker & Kubernetes 101',
            instructor: 'Mohamed Sorour',
            imageUrl: '',
            progress: 0,
            lastAccessed: new Date(),
            nextSection: 'Intro to Linux & Docker',
            estimatedTimeLeft: '~2h',
            category: 'Cloud Engineering',
            tags: ['Linux', 'Docker', 'Kubernetes', 'Cloud'],
          },
        ];

        this.filteredCourses = [...this.enrolledCourses];
        this.applyFilters();
        this.isLoading = false;
        this.cdr.detectChanges();
      }, 300);
    });
  }

  /**
   * Apply selected filters and search to courses
   */
  applyFilters(): void {
    // Start with all courses
    let filtered = [...this.enrolledCourses];

    // First apply search filter if there's a query
    if (this.searchQuery && this.searchQuery.trim() !== '') {
      const query = this.searchQuery.toLowerCase().trim();

      filtered = filtered.filter(
        (course) =>
          course.title.toLowerCase().includes(query) ||
          course.instructor.toLowerCase().includes(query) ||
          course.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          course.category.toLowerCase().includes(query)
      );
    }

    // Then apply progress filter
    switch (this.selectedFilter) {
      case 'in-progress':
        filtered = filtered.filter(
          (course) => course.progress > 0 && course.progress < 100
        );
        break;
      case 'not-started':
        filtered = filtered.filter((course) => course.progress === 0);
        break;
      case 'completed':
        filtered = filtered.filter((course) => course.progress === 100);
        break;
      case 'with-updates':
        filtered = filtered.filter((course) => course.hasUpdates === true);
        break;
      case 'all':
        // No filter needed
        break;
    }

    // Apply sort
    filtered = this.sortCourses(filtered, this.selectedSort);

    // Update the filtered courses
    this.filteredCourses = filtered;

    // Safety check - if filters produced no results but we have courses
    if (
      this.enrolledCourses.length > 0 &&
      this.filteredCourses.length === 0 &&
      this.selectedFilter === 'all' &&
      !this.searchQuery
    ) {
      this.filteredCourses = [...this.enrolledCourses];
    }

    // Force change detection
    this.cdr.detectChanges();
  }

  /**
   * Sort courses based on selected sort option
   */
  sortCourses(courses: EnrolledCourse[], sortOption: string): EnrolledCourse[] {
    if (!courses || courses.length === 0) {
      return [];
    }

    switch (sortOption) {
      case 'recent':
        return [...courses].sort(
          (a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime()
        );

      case 'progress':
        return [...courses].sort((a, b) => b.progress - a.progress);

      case 'title':
        return [...courses].sort((a, b) => a.title.localeCompare(b.title));

      default:
        return [...courses];
    }
  }

  /**
   * Handle search input changes
   */
  onSearchChange(): void {
    this.applyFilters();
  }

  /**
   * Clear search input
   */
  clearSearch(): void {
    this.searchQuery = '';
    this.onSearchChange();
  }

  /**
   * Change the filter selection
   */
  setFilter(filter: string): void {
    this.selectedFilter = filter;
    this.applyFilters();
    this.scrollService.scrollToTop();
  }

  /**
   * Change the sort option
   */
  onSortChange(): void {
    this.applyFilters();
  }

  /**
   * Reset all filters
   */
  resetFilters(): void {
    this.selectedFilter = 'all';
    this.searchQuery = '';
    this.applyFilters();
  }

  /**
   * Format date to relative time (e.g., "2 days ago")
   */
  getRelativeTime(date: Date): string {
    if (!date) return 'Unknown';

    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    } else {
      const months = Math.floor(diffDays / 30);
      return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    }
  }

  /**
   * Handle image loading errors with course initials fallback
   */
  handleImageError(event: any, course: EnrolledCourse): void {
    // Remove the failed image
    event.target.style.display = 'none';

    // Get the parent container
    const container = event.target.parentElement;

    // Check if we've already created an avatar (to avoid duplicates)
    if (container.querySelector('.course-avatar')) {
      return;
    }

    // Create the avatar element
    const avatar = document.createElement('div');
    avatar.className = 'course-avatar';
    avatar.textContent = this.getCourseInitials(course.title);
    avatar.style.background = this.getCourseColor(course.title);

    // Add it to the container
    container.appendChild(avatar);
  }

  /**
   * Generate course initials for avatar fallback
   */
  getCourseInitials(title: string): string {
    if (!title) return '';

    // Split by spaces and get words
    const words = title.split(' ');

    // If only one word, take first two characters
    if (words.length === 1) {
      return words[0].substring(0, 2).toUpperCase();
    }

    // Get first character of first two significant words
    // Skip common words like "and", "with", "for", etc.
    const skipWords = ['and', 'with', 'for', 'the', 'of', 'in', 'on', 'to'];
    let initials = '';
    let count = 0;

    for (const word of words) {
      if (word.length > 0 && !skipWords.includes(word.toLowerCase())) {
        initials += word[0];
        count++;
        if (count === 2) break;
      }
    }

    return initials.toUpperCase();
  }

  /**
   * Generate a consistent color based on the course title
   */
  getCourseColor(title: string): string {
    // Generate a hash code from the title
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = (hash << 5) - hash + title.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    hash = Math.abs(hash);

    // Generate a hue value between 0-360 based on the hash
    const hue = hash % 360;

    // Return a vibrant but not too bright color
    return `linear-gradient(135deg, hsl(${hue}, 70%, 45%), hsl(${
      (hue + 40) % 360
    }, 80%, 35%))`;
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.subs.forEach((sub) => sub.unsubscribe());
  }
}
