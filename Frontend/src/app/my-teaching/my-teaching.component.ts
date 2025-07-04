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

// Course interface for instructor courses
interface InstructorCourse {
  id: string;
  title: string;
  imageUrl: string;
  enrolledStudents: number;
  averageRating: number;
  totalReviews: number;
  createdDate: Date;
  lastUpdated: Date;
  status: 'published' | 'draft' | 'under-review';
  category: string;
  tags: string[];
  revenue?: number;
  completionRate?: number;
  engagement?: number; // Average % of course completed by enrolled students
  hasQuestions?: boolean; // Indicates if there are unanswered student questions
  pendingFeedback?: number; // Number of assignments waiting for feedback
}

@Component({
  selector: 'app-my-teaching',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './my-teaching.component.html',
  styleUrls: ['./my-teaching.component.scss'],
})
export class MyTeachingComponent implements OnInit, OnDestroy, AfterViewInit {
  // Current user data
  currentUser: User | null = null;

  // Courses filtering and display
  instructorCourses: InstructorCourse[] = [];
  filteredCourses: InstructorCourse[] = [];
  selectedFilter: string = 'all';
  searchQuery: string = '';

  // Loading states
  isLoading: boolean = true;

  // Sort options
  sortOptions = [
    { value: 'recent', label: 'Recently Updated' },
    { value: 'students', label: 'Most Students' },
    { value: 'rating', label: 'Highest Rated' },
    { value: 'engagement', label: 'Highest Engagement' },
    { value: 'revenue', label: 'Highest Revenue' },
  ];
  selectedSort: string = 'recent';

  // Income summary
  currentMonthRevenue: number = 0;
  previousMonthRevenue: number = 0;
  totalRevenue: number = 0;

  // Teaching metrics card options
  selectedMetric: 'students' | 'engagement' | 'reviews' | 'questions' =
    'students';

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
        this.loadInstructorCourses();
      })
    );
  }

  ngAfterViewInit(): void {
    // Add animation classes after view is initialized
    setTimeout(() => {
      this.initScrollAnimations();
    }, 500);
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
   * Get count of instructor courses
   */
  get instructorCoursesCount(): number {
    return this.instructorCourses.length;
  }

  /**
   * Get count of published courses
   */
  get publishedCoursesCount(): number {
    return this.instructorCourses.filter(
      (course) => course.status === 'published'
    ).length;
  }

  /**
   * Get count of draft courses
   */
  get draftCoursesCount(): number {
    return this.instructorCourses.filter((course) => course.status === 'draft')
      .length;
  }

  /**
   * Get total student enrollments
   */
  get totalStudents(): number {
    return this.instructorCourses.reduce(
      (total, course) => total + course.enrolledStudents,
      0
    );
  }

  /**
   * Calculate revenue growth percentage
   */
  get revenueGrowth(): number {
    if (this.previousMonthRevenue === 0) return 100;
    return (
      ((this.currentMonthRevenue - this.previousMonthRevenue) /
        this.previousMonthRevenue) *
      100
    );
  }

  /**
   * Get average rating across all courses
   */
  get averageRating(): number {
    if (this.instructorCourses.length === 0) return 0;

    const totalRating = this.instructorCourses.reduce((sum, course) => {
      return sum + course.averageRating * course.totalReviews;
    }, 0);

    const totalReviews = this.instructorCourses.reduce((sum, course) => {
      return sum + course.totalReviews;
    }, 0);

    return totalReviews ? totalRating / totalReviews : 0;
  }

  /**
   * Get total pending feedback count
   */
  get totalPendingFeedback(): number {
    return this.instructorCourses.reduce((total, course) => {
      return total + (course.pendingFeedback || 0);
    }, 0);
  }

  /**
   * Get count of courses with unanswered questions
   */
  get coursesWithQuestions(): number {
    return this.instructorCourses.filter((course) => course.hasQuestions)
      .length;
  }

  /**
   * Track courses for ngFor
   */
  trackByCourse(index: number, course: InstructorCourse): string {
    return course.id;
  }

  /**
   * Format currency
   */
  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  /**
   * Load the instructor's courses
   * (Simulating API call with mock data for now)
   */
  loadInstructorCourses(): void {
    // Simulate API loading delay
    this.isLoading = true;

    // Wrap in NgZone to ensure change detection
    this.zone.run(() => {
      setTimeout(() => {
        // Mock data for instructor courses
        this.instructorCourses = [
          {
            id: 'web-development-masterclass',
            title:
              'Web Development Masterclass: HTML, CSS, JavaScript, React & Node',
            imageUrl: '/assets/courses/web-masterclass.jpg',
            enrolledStudents: 1254,
            averageRating: 4.7,
            totalReviews: 378,
            createdDate: new Date(2023, 4, 15),
            lastUpdated: new Date(2024, 3, 10),
            status: 'published',
            category: 'Web Development',
            tags: ['HTML', 'CSS', 'JavaScript', 'React', 'Node.js'],
            revenue: 28750,
            completionRate: 68,
            engagement: 74,
            hasQuestions: true,
            pendingFeedback: 8,
          },
          {
            id: 'python-data-science',
            title: 'Python for Data Science and Machine Learning',
            imageUrl: '/assets/courses/python-ds.jpg',
            enrolledStudents: 874,
            averageRating: 4.8,
            totalReviews: 231,
            createdDate: new Date(2023, 9, 22),
            lastUpdated: new Date(2024, 4, 5),
            status: 'published',
            category: 'Data Science',
            tags: [
              'Python',
              'Data Science',
              'Machine Learning',
              'Pandas',
              'NumPy',
            ],
            revenue: 19650,
            completionRate: 72,
            engagement: 81,
            hasQuestions: false,
            pendingFeedback: 5,
          },
          {
            id: 'react-native-mobile',
            title: 'React Native: Build Mobile Apps with JavaScript',
            imageUrl: '/assets/courses/react-native.jpg',
            enrolledStudents: 645,
            averageRating: 4.6,
            totalReviews: 187,
            createdDate: new Date(2023, 11, 8),
            lastUpdated: new Date(2024, 2, 25),
            status: 'published',
            category: 'Mobile Development',
            tags: ['React Native', 'JavaScript', 'Mobile', 'iOS', 'Android'],
            revenue: 15230,
            completionRate: 65,
            engagement: 70,
            hasQuestions: true,
            pendingFeedback: 12,
          },
          {
            id: 'advanced-javascript-patterns',
            title: 'Advanced JavaScript: Design Patterns and Best Practices',
            imageUrl: '/assets/courses/advanced-js.jpg',
            enrolledStudents: 422,
            averageRating: 4.9,
            totalReviews: 98,
            createdDate: new Date(2024, 1, 15),
            lastUpdated: new Date(2024, 3, 28),
            status: 'published',
            category: 'Web Development',
            tags: ['JavaScript', 'Design Patterns', 'Advanced'],
            revenue: 10850,
            completionRate: 56,
            engagement: 68,
            hasQuestions: false,
            pendingFeedback: 3,
          },
          {
            id: 'cloud-architecture-aws',
            title: 'Cloud Architecture and DevOps with AWS',
            imageUrl: '/assets/courses/cloud-aws.jpg',
            enrolledStudents: 0,
            averageRating: 0,
            totalReviews: 0,
            createdDate: new Date(2024, 4, 1),
            lastUpdated: new Date(2024, 4, 8),
            status: 'draft',
            category: 'Cloud Computing',
            tags: ['AWS', 'Cloud', 'DevOps', 'Architecture'],
            revenue: 0,
            completionRate: 0,
            engagement: 0,
          },
          {
            id: 'flutter-advanced-ui',
            title: 'Advanced Flutter UI: Animations and Custom Widgets',
            imageUrl: '/assets/courses/flutter-ui.jpg',
            enrolledStudents: 0,
            averageRating: 0,
            totalReviews: 0,
            createdDate: new Date(2024, 3, 10),
            lastUpdated: new Date(2024, 4, 2),
            status: 'under-review',
            category: 'Mobile Development',
            tags: ['Flutter', 'UI', 'Animations', 'Mobile'],
            revenue: 0,
            completionRate: 0,
            engagement: 0,
          },
        ];

        // Calculate revenue summaries
        this.currentMonthRevenue = 12350;
        this.previousMonthRevenue = 10200;
        this.totalRevenue = this.instructorCourses.reduce(
          (total, course) => total + (course.revenue || 0),
          0
        );

        // Fix image paths and ensure filteredCourses gets populated
        this.instructorCourses.forEach((course) => {
          if (course.imageUrl && course.imageUrl.startsWith('/')) {
            // Remove the leading slash to make relative paths work
            course.imageUrl = course.imageUrl.substring(1);
          }
        });

        this.filteredCourses = [...this.instructorCourses];
        this.applyFilters();
        this.isLoading = false;

        // Force change detection
        this.cdr.detectChanges();
      }, 1000);
    });
  }

  /**
   * Apply selected filters and search to courses
   */
  applyFilters(): void {
    // Start with all courses
    let filtered = [...this.instructorCourses];

    // First apply search filter if there's a query
    if (this.searchQuery && this.searchQuery.trim() !== '') {
      const query = this.searchQuery.toLowerCase().trim();

      filtered = filtered.filter(
        (course) =>
          course.title.toLowerCase().includes(query) ||
          course.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          course.category.toLowerCase().includes(query)
      );
    }

    // Then apply status filter
    switch (this.selectedFilter) {
      case 'published':
        filtered = filtered.filter((course) => course.status === 'published');
        break;
      case 'draft':
        filtered = filtered.filter((course) => course.status === 'draft');
        break;
      case 'under-review':
        filtered = filtered.filter(
          (course) => course.status === 'under-review'
        );
        break;
      case 'with-questions':
        filtered = filtered.filter((course) => course.hasQuestions);
        break;
      case 'pending-feedback':
        filtered = filtered.filter(
          (course) => (course.pendingFeedback || 0) > 0
        );
        break;
      case 'all':
        // No filter needed
        break;
    }

    // Apply sort
    filtered = this.sortCourses(filtered, this.selectedSort);

    // Update the filtered courses
    this.filteredCourses = filtered;

    // Force change detection
    this.cdr.detectChanges();
  }

  /**
   * Sort courses based on selected sort option
   */
  sortCourses(
    courses: InstructorCourse[],
    sortOption: string
  ): InstructorCourse[] {
    if (!courses || courses.length === 0) {
      return [];
    }

    switch (sortOption) {
      case 'recent':
        return [...courses].sort(
          (a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime()
        );

      case 'students':
        return [...courses].sort(
          (a, b) => b.enrolledStudents - a.enrolledStudents
        );

      case 'rating':
        return [...courses].sort((a, b) => b.averageRating - a.averageRating);

      case 'engagement':
        return [...courses].sort(
          (a, b) => (b.engagement || 0) - (a.engagement || 0)
        );

      case 'revenue':
        return [...courses].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

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
   * Change the selected metric
   */
  setMetric(metric: 'students' | 'engagement' | 'reviews' | 'questions'): void {
    this.selectedMetric = metric;
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
   * Format number with K/M suffix
   */
  formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  /**
   * Format rating with stars
   */
  getRatingStars(rating: number): string {
    const fullStars = Math.floor(rating);
    const halfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);

    let stars = '';
    for (let i = 0; i < fullStars; i++) {
      stars += '★';
    }
    if (halfStar) {
      stars += '½';
    }
    for (let i = 0; i < emptyStars; i++) {
      stars += '☆';
    }

    return stars;
  }

  /**
   * Get status label class
   */
  getStatusClass(status: string): string {
    switch (status) {
      case 'published':
        return 'status-published';
      case 'draft':
        return 'status-draft';
      case 'under-review':
        return 'status-review';
      default:
        return '';
    }
  }

  /**
   * Get status label text
   */
  getStatusLabel(status: string): string {
    switch (status) {
      case 'published':
        return 'Published';
      case 'draft':
        return 'Draft';
      case 'under-review':
        return 'Under Review';
      default:
        return status;
    }
  }

  /**
   * Handle image loading errors with course initials fallback
   */
  handleImageError(event: any, course: InstructorCourse): void {
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
   * Calculate average engagement rate
   */
  getAverageEngagement(): string {
    if (this.filteredCourses.length === 0) return '0';

    const totalEngagement = this.filteredCourses.reduce((sum, course) => {
      return sum + (course.engagement || 0);
    }, 0);

    return (totalEngagement / this.filteredCourses.length).toFixed(1);
  }

  /**
   * Get total number of reviews
   */
  getTotalReviews(): number {
    return this.filteredCourses.reduce(
      (sum, course) => sum + course.totalReviews,
      0
    );
  }
  /**
   * Get courses with questions (limited to 3)
   */
  getCoursesWithQuestions(): InstructorCourse[] {
    return this.filteredCourses
      .filter((course) => course.hasQuestions)
      .slice(0, 3);
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
