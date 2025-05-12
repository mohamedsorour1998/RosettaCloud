import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../services/theme.service';
import { ScrollService } from '../services/scroll.service';

interface Course {
  id: string;
  title: string;
  instructor: string;
  instructorRole?: string;
  description: string;
  level: string;
  duration: string;
  rating: number;
  ratingCount: number;
  price: number;
  discountPrice?: number;
  imageUrl: string;
  tags: string[];
  popular?: boolean;
  featured?: boolean;
  language: string;
  lastUpdated: string;
}

@Component({
  selector: 'app-courses',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './courses.component.html',
  styleUrls: ['./courses.component.scss'],
})
export class CoursesComponent implements OnInit {
  // Search and filter state
  searchQuery: string = '';
  selectedCategory: string = 'all';
  selectedLevel: string = 'all';
  isSearching: boolean = false;
  showNoResults: boolean = false;

  // Pagination
  currentPage: number = 1;
  itemsPerPage: number = 6;
  totalPages: number = 1;

  // Lists of courses
  allCourses: Course[] = [];
  filteredFeaturedCourses: Course[] = [];
  filteredCourses: Course[] = [];
  paginatedCourses: Course[] = [];

  // Filter options
  categories: string[] = [
    'All Categories',
    'Web Development',
    'Mobile Development',
    'Data Science',
    'UI/UX Design',
    'Cloud Computing',
    'DevOps',
    'Machine Learning',
    'Cybersecurity',
  ];

  levels: string[] = ['All Levels', 'Beginner', 'Intermediate', 'Advanced'];

  // Course catalog stats
  stats = [
    { value: '100+', label: 'Courses Available', icon: 'bi-journal-code' },
    { value: '25+', label: 'Categories', icon: 'bi-grid-3x3-gap-fill' },
    { value: '12k+', label: 'Students Enrolled', icon: 'bi-people-fill' },
    { value: '4.8', label: 'Average Rating', icon: 'bi-star-fill' },
  ];

  // Featured courses
  featuredCourses: Course[] = [
    {
      id: 'modern-react-development',
      title: 'Modern React Development with Hooks and Context',
      instructor: 'Dr. Sarah Johnson',
      description:
        'Master React from the fundamentals to advanced state management. Learn hooks, context API, and build real-world applications with the latest React features.',
      level: 'Intermediate',
      duration: '24 hours',
      rating: 4.9,
      ratingCount: 1254,
      price: 89.99,
      discountPrice: 49.99,
      imageUrl: 'assets/courses/react-dev.jpg',
      tags: ['React', 'JavaScript', 'Frontend', 'Web Development'],
      featured: true,
      language: 'English',
      lastUpdated: '2024-05-01',
    },
    {
      id: 'flutter-masterclass',
      title: 'Flutter Masterclass: Building Cross-Platform Apps',
      instructor: 'Ahmad Hassan',
      description:
        'Comprehensive guide to Flutter development. Build beautiful, responsive cross-platform applications for iOS and Android from a single codebase.',
      level: 'Intermediate',
      duration: '36 hours',
      rating: 4.8,
      ratingCount: 982,
      price: 99.99,
      discountPrice: 59.99,
      imageUrl: 'assets/courses/flutter-masterclass.jpg',
      tags: ['Flutter', 'Dart', 'Mobile Development', 'iOS', 'Android'],
      featured: true,
      language: 'English',
      lastUpdated: '2024-04-15',
    },
    {
      id: 'machine-learning-python',
      title: 'Machine Learning with Python: From Zero to Hero',
      instructor: 'Mei Zhang, PhD',
      description:
        'Learn practical machine learning techniques with Python. From basics to building advanced models, this course covers everything you need to start your ML journey.',
      level: 'Advanced',
      duration: '40 hours',
      rating: 4.9,
      ratingCount: 1428,
      price: 129.99,
      discountPrice: 69.99,
      imageUrl: 'assets/courses/ml-python.jpg',
      tags: ['Python', 'Machine Learning', 'Data Science', 'AI'],
      featured: true,
      language: 'English',
      lastUpdated: '2024-04-22',
    },
  ];

  // Regular courses
  courses: Course[] = [
    {
      id: 'aws-certified-solutions-architect',
      title: 'AWS Certified Solutions Architect - Associate',
      instructor: 'James Wilson',
      instructorRole: 'DevOps & Cloud Instructor',
      description:
        'Prepare for and pass the AWS Solutions Architect Associate exam. Learn to design and deploy scalable, highly available systems on AWS.',
      level: 'Intermediate',
      duration: '28 hours',
      rating: 4.7,
      ratingCount: 856,
      price: 119.99,
      discountPrice: 64.99,
      imageUrl: 'assets/courses/aws-architect.jpg',
      tags: ['AWS', 'Cloud Computing', 'DevOps'],
      popular: true,
      language: 'English',
      lastUpdated: '2024-05-05',
    },
    {
      id: 'ux-ui-design-fundamentals',
      title: 'UX/UI Design Fundamentals and Figma Mastery',
      instructor: 'Layla Mahmoud',
      instructorRole: 'Frontend Development Instructor',
      description:
        'Comprehensive guide to UX/UI design principles, wireframing, prototyping, and design implementation with Figma.',
      level: 'Beginner',
      duration: '18 hours',
      rating: 4.8,
      ratingCount: 723,
      price: 79.99,
      discountPrice: 39.99,
      imageUrl: 'assets/courses/uxui-fundamentals.jpg',
      tags: ['UI/UX', 'Design', 'Figma'],
      popular: true,
      language: 'English',
      lastUpdated: '2024-04-12',
    },
    {
      id: 'spring-boot-microservices',
      title: 'Spring Boot Microservices and Cloud-Native Applications',
      instructor: 'Carlos Rodriguez',
      instructorRole: 'Backend Development Instructor',
      description:
        'Learn to build scalable, cloud-native microservices with Spring Boot, Spring Cloud, and Docker. Deploy to Kubernetes and AWS.',
      level: 'Advanced',
      duration: '32 hours',
      rating: 4.9,
      ratingCount: 621,
      price: 109.99,
      discountPrice: 54.99,
      imageUrl: 'assets/courses/spring-microservices.jpg',
      tags: ['Java', 'Spring Boot', 'Microservices', 'DevOps'],
      language: 'English',
      lastUpdated: '2024-04-28',
    },
    {
      id: 'ethical-hacking-bootcamp',
      title: 'Ethical Hacking and Penetration Testing Bootcamp',
      instructor: 'Priya Patel',
      instructorRole: 'Cybersecurity Instructor',
      description:
        'Hands-on ethical hacking and penetration testing. Learn to think like a hacker and secure systems against common vulnerabilities.',
      level: 'Intermediate',
      duration: '30 hours',
      rating: 4.8,
      ratingCount: 542,
      price: 119.99,
      discountPrice: 59.99,
      imageUrl: 'assets/courses/ethical-hacking.jpg',
      tags: ['Cybersecurity', 'Ethical Hacking', 'Network Security'],
      language: 'English',
      lastUpdated: '2024-04-03',
    },
    {
      id: 'unity-game-development',
      title: 'Unity Game Development: Build 2D and 3D Games',
      instructor: 'David Mensah',
      instructorRole: 'Game Development Instructor',
      description:
        'Create professional 2D and 3D games with Unity. Learn C# programming, game physics, animation, and how to publish your games.',
      level: 'Beginner',
      duration: '26 hours',
      rating: 4.7,
      ratingCount: 486,
      price: 89.99,
      discountPrice: 44.99,
      imageUrl: 'assets/courses/unity-game-dev.jpg',
      tags: ['Game Development', 'Unity', 'C#'],
      language: 'English',
      lastUpdated: '2024-05-02',
    },
    {
      id: 'data-engineering-pipeline',
      title: 'Data Engineering: Building ETL Pipelines',
      instructor: 'Sophia Chen',
      instructorRole: 'Data Engineering Instructor',
      description:
        'Master big data processing and ETL pipelines using Apache Spark, Airflow, and modern data engineering techniques.',
      level: 'Advanced',
      duration: '24 hours',
      rating: 4.9,
      ratingCount: 389,
      price: 99.99,
      discountPrice: 49.99,
      imageUrl: 'assets/courses/data-engineering.jpg',
      tags: ['Data Engineering', 'ETL', 'Spark', 'Data Science'],
      language: 'English',
      lastUpdated: '2024-03-22',
    },
    {
      id: 'javascript-fundamentals',
      title: 'JavaScript Fundamentals for Modern Web Development',
      instructor: 'Alex Thompson',
      instructorRole: 'Web Development Instructor',
      description:
        'Build a solid foundation in JavaScript programming. Learn ES6+, DOM manipulation, and how to build interactive web applications.',
      level: 'Beginner',
      duration: '20 hours',
      rating: 4.8,
      ratingCount: 1120,
      price: 79.99,
      discountPrice: 39.99,
      imageUrl: 'assets/courses/javascript-fundamentals.jpg',
      tags: ['JavaScript', 'Web Development', 'Frontend'],
      language: 'English',
      lastUpdated: '2024-04-18',
    },
    {
      id: 'python-data-analysis',
      title: 'Python for Data Analysis and Visualization',
      instructor: 'Mei Zhang, PhD',
      instructorRole: 'Data Science & AI Instructor',
      description:
        'Master data analysis with Python. Learn pandas, NumPy, Matplotlib and how to derive meaningful insights from complex datasets.',
      level: 'Intermediate',
      duration: '28 hours',
      rating: 4.9,
      ratingCount: 876,
      price: 89.99,
      discountPrice: 49.99,
      imageUrl: 'assets/courses/python-data-analysis.jpg',
      tags: ['Python', 'Data Analysis', 'Data Science', 'Visualization'],
      language: 'English',
      lastUpdated: '2024-03-30',
    },
  ];

  // Selected course for detailed view
  selectedCourse: Course | null = null;

  constructor(
    private themeService: ThemeService,
    private router: Router,
    private scrollService: ScrollService
  ) {}

  ngOnInit(): void {
    // Initialize with animation classes
    this.addScrollAnimations();

    // Combine all courses for search
    this.allCourses = [...this.featuredCourses, ...this.courses];

    // Initialize filtered lists
    this.filteredFeaturedCourses = [...this.featuredCourses];
    this.filteredCourses = [...this.courses];

    // Initialize pagination
    this.updatePagination();
  }

  // Update pagination based on current filters
  updatePagination(): void {
    this.totalPages = Math.ceil(
      this.filteredCourses.length / this.itemsPerPage
    );

    // Ensure current page is valid
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages > 0 ? this.totalPages : 1;
    } else if (this.currentPage < 1) {
      this.currentPage = 1;
    }

    // Get paginated courses
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    this.paginatedCourses = this.filteredCourses.slice(startIndex, endIndex);
  }

  // Change page
  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updatePagination();

      // Scroll to the courses section smoothly
      setTimeout(() => {
        const coursesSection = document.querySelector('.all-courses');
        if (coursesSection) {
          coursesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }

  // Go to next page
  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.goToPage(this.currentPage + 1);
    }
  }

  // Go to previous page
  prevPage(): void {
    if (this.currentPage > 1) {
      this.goToPage(this.currentPage - 1);
    }
  }

  // Search and filter functionality
  searchCourses(): void {
    this.isSearching = true;
    this.showNoResults = false;

    // Short timeout to show loading state
    setTimeout(() => {
      const query = this.searchQuery.toLowerCase().trim();
      const category =
        this.selectedCategory === 'all'
          ? ''
          : this.selectedCategory.toLowerCase();
      const level =
        this.selectedLevel === 'all' ? '' : this.selectedLevel.toLowerCase();

      // If no filters applied, reset to original lists
      if (!query && !category && !level) {
        this.filteredFeaturedCourses = [...this.featuredCourses];
        this.filteredCourses = [...this.courses];
        this.isSearching = false;
        this.updatePagination();
        return;
      }

      // Apply filters
      this.filteredFeaturedCourses = this.featuredCourses.filter((course) =>
        this.courseMatchesFilters(course, query, category, level)
      );

      this.filteredCourses = this.courses.filter((course) =>
        this.courseMatchesFilters(course, query, category, level)
      );

      // Check if we have any results
      this.showNoResults =
        this.filteredFeaturedCourses.length === 0 &&
        this.filteredCourses.length === 0;

      // Reset to first page and update pagination
      this.currentPage = 1;
      this.updatePagination();
      this.isSearching = false;
    }, 300);
  }

  // Helper to check if course matches search & filters
  private courseMatchesFilters(
    course: Course,
    query: string,
    category: string,
    level: string
  ): boolean {
    // Check query match
    const queryMatch =
      !query ||
      course.title.toLowerCase().includes(query) ||
      course.description.toLowerCase().includes(query) ||
      course.instructor.toLowerCase().includes(query) ||
      course.tags.some((tag) => tag.toLowerCase().includes(query));

    // Check category match
    const categoryMatch =
      !category ||
      course.tags.some((tag) => tag.toLowerCase().includes(category));

    // Check level match
    const levelMatch = !level || course.level.toLowerCase() === level;

    return queryMatch && categoryMatch && levelMatch;
  }

  // Reset search and filters
  clearFilters(): void {
    this.searchQuery = '';
    this.selectedCategory = 'all';
    this.selectedLevel = 'all';
    this.searchCourses();
  }

  // Show course details
  showCourseDetails(course: Course): void {
    this.selectedCourse = course;

    // Use setTimeout to ensure modal has time to be created in the DOM
    setTimeout(() => {
      const modalElement = document.getElementById('courseModal');
      if (modalElement) {
        // Use Bootstrap's modal method if available, or a simple class toggle
        if (typeof window !== 'undefined' && (window as any).bootstrap?.Modal) {
          const modal = new (window as any).bootstrap.Modal(modalElement);
          modal.show();
        } else {
          modalElement.classList.add('show');
          modalElement.style.display = 'block';
        }
      }
    }, 0);
  }

  // Close course details modal
  closeCourseDetails(): void {
    this.selectedCourse = null;
  }

  // Get star rating display array for a course
  getStarRating(rating: number): number[] {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating - fullStars >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    return [
      ...Array(fullStars).fill(1),
      ...(hasHalfStar ? [0.5] : []),
      ...Array(emptyStars).fill(0),
    ];
  }

  // Calculate discount percentage
  getDiscountPercentage(price: number, discountPrice: number): number {
    if (!discountPrice || discountPrice >= price) return 0;
    return Math.round(100 - (discountPrice / price) * 100);
  }

  // Format price with correct currency symbol
  formatPrice(price: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(price);
  }

  // Generate pagination array for template
  getPaginationArray(): number[] {
    const paginationArray: number[] = [];

    // Create an array of page numbers
    // Limit to 5 pages total with current page in the middle when possible
    let startPage = Math.max(1, this.currentPage - 2);
    let endPage = Math.min(this.totalPages, startPage + 4);

    // Adjust startPage if we're near the end
    if (endPage - startPage < 4 && startPage > 1) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let i = startPage; i <= endPage; i++) {
      paginationArray.push(i);
    }

    return paginationArray;
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
  /**
   * Generate course initials for avatar fallback
   * @param title The course title
   * @returns Initials (up to 2 characters)
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
   * @param title The course title
   * @returns HSL color string
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

  /**
   * Handle image loading errors by creating an avatar with initials
   * @param event The error event
   * @param course The course object
   */
  handleImageError(event: any, course: Course): void {
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
}
