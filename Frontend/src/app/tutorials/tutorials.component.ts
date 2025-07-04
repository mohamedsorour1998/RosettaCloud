import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ScrollService } from '../services/scroll.service';
import { ThemeService } from '../services/theme.service';
import { UserService } from '../services/user.service';

interface Tutorial {
  id: string;
  title: string;
  description: string;
  authorName: string;
  authorRole: string;
  authorAvatar: string;
  publishDate: string;
  duration: number; // in minutes
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  category: string;
  tags: string[];
  imageUrl: string;
  sections: {
    title: string;
    duration: number;
  }[];
  progress?: number; // 0-100 for logged in users
  isFeatured?: boolean;
  isNew?: boolean;
  views: number;
  likes: number;
}

interface TutorialCategory {
  id: string;
  name: string;
  count: number;
  icon: string;
}

interface DifficultyLevel {
  id: 'beginner' | 'intermediate' | 'advanced';
  name: string;
  count: number;
  color: string;
}

@Component({
  selector: 'app-tutorials',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './tutorials.component.html',
  styleUrls: ['./tutorials.component.scss'],
})
export class TutorialsComponent implements OnInit {
  searchQuery: string = '';
  selectedCategory: string = 'all';
  selectedDifficulty: string = 'all';
  sortBy: 'newest' | 'popular' | 'shortest' = 'newest';
  isLoggedIn: boolean = false;

  // Tutorials data
  tutorials: Tutorial[] = [
    {
      id: 'javascript-fundamentals',
      title: 'JavaScript Fundamentals: From Zero to Hero',
      description:
        'Master the core concepts of JavaScript including variables, functions, objects, and asynchronous programming. Perfect for beginners wanting to build a solid foundation.',
      authorName: 'Layla Mahmoud',
      authorRole: 'Frontend Development Instructor',
      authorAvatar: 'assets/instructors/layla-mahmoud.jpg',
      publishDate: 'May 10, 2024',
      duration: 180,
      difficulty: 'beginner',
      category: 'web-development',
      tags: ['JavaScript', 'Web Development', 'Frontend'],
      imageUrl: 'assets/tutorials/javascript-fundamentals.jpg',
      sections: [
        { title: 'Introduction to JavaScript', duration: 15 },
        { title: 'Variables and Data Types', duration: 25 },
        { title: 'Functions and Scope', duration: 30 },
        { title: 'Objects and Arrays', duration: 40 },
        { title: 'DOM Manipulation', duration: 35 },
        { title: 'Asynchronous JavaScript', duration: 35 },
      ],
      progress: 65,
      isFeatured: true,
      views: 4250,
      likes: 387,
    },
    {
      id: 'react-hooks-masterclass',
      title: 'React Hooks Masterclass: Building Modern UIs',
      description:
        'Deep dive into React Hooks and learn how to build clean, efficient React applications. Covers useState, useEffect, useContext, useReducer, and custom hooks.',
      authorName: 'Sarah Johnson',
      authorRole: 'Lead Instructor, Full Stack Development',
      authorAvatar: 'assets/instructors/sarah-johnson.jpg',
      publishDate: 'May 8, 2024',
      duration: 210,
      difficulty: 'intermediate',
      category: 'web-development',
      tags: ['React', 'Hooks', 'Frontend', 'JavaScript'],
      imageUrl: 'assets/tutorials/react-hooks.jpg',
      sections: [
        { title: 'Introduction to React Hooks', duration: 20 },
        { title: 'useState and useEffect', duration: 45 },
        { title: 'Context API and useContext', duration: 35 },
        { title: 'useReducer for Complex State', duration: 40 },
        { title: 'Creating Custom Hooks', duration: 35 },
        { title: 'Performance Optimization', duration: 35 },
      ],
      progress: 20,
      isNew: true,
      views: 2180,
      likes: 245,
    },
    {
      id: 'python-data-analysis',
      title: 'Python for Data Analysis with Pandas',
      description:
        'Learn how to analyze and manipulate data using Python and Pandas. This tutorial covers data cleaning, transformation, visualization, and basic statistical analysis.',
      authorName: 'Mei Zhang, PhD',
      authorRole: 'Data Science & AI Instructor',
      authorAvatar: 'assets/instructors/mei-zhang.jpg',
      publishDate: 'April 28, 2024',
      duration: 240,
      difficulty: 'intermediate',
      category: 'data-science',
      tags: ['Python', 'Pandas', 'Data Analysis', 'NumPy'],
      imageUrl: 'assets/tutorials/python-data-analysis.jpg',
      sections: [
        { title: 'Introduction to Data Analysis', duration: 20 },
        { title: 'Pandas Fundamentals', duration: 40 },
        { title: 'Data Cleaning Techniques', duration: 45 },
        { title: 'Data Visualization with Matplotlib', duration: 40 },
        { title: 'Statistical Analysis', duration: 50 },
        { title: 'Real-world Case Study', duration: 45 },
      ],
      progress: 0,
      isFeatured: true,
      views: 3120,
      likes: 290,
    },
    {
      id: 'docker-containers',
      title: 'Docker Containers: Containerizing Your Applications',
      description:
        'A practical guide to containerizing applications with Docker. Learn container basics, Dockerfiles, Docker Compose, and best practices for deployment.',
      authorName: 'James Wilson',
      authorRole: 'DevOps & Cloud Instructor',
      authorAvatar: 'assets/instructors/james-wilson.jpg',
      publishDate: 'May 5, 2024',
      duration: 150,
      difficulty: 'intermediate',
      category: 'devops',
      tags: ['Docker', 'Containers', 'DevOps', 'Deployment'],
      imageUrl: 'assets/tutorials/docker-containers.jpg',
      sections: [
        { title: 'Container Fundamentals', duration: 25 },
        { title: 'Creating Dockerfiles', duration: 30 },
        { title: 'Managing Images and Containers', duration: 25 },
        { title: 'Docker Compose for Multi-container Apps', duration: 35 },
        { title: 'Docker Networking', duration: 20 },
        { title: 'Deployment Strategies', duration: 15 },
      ],
      progress: 10,
      isNew: true,
      views: 1870,
      likes: 165,
    },
    {
      id: 'flutter-mobile-apps',
      title: 'Building Cross-Platform Mobile Apps with Flutter',
      description:
        'Learn how to develop beautiful, native-quality apps for iOS and Android using Flutter. This tutorial covers widgets, state management, navigation, and deployment.',
      authorName: 'Ahmad Hassan',
      authorRole: 'Senior Instructor, Mobile Development',
      authorAvatar: 'assets/instructors/ahmad-hassan.jpg',
      publishDate: 'April 15, 2024',
      duration: 300,
      difficulty: 'intermediate',
      category: 'mobile-development',
      tags: ['Flutter', 'Dart', 'Mobile', 'Cross-platform'],
      imageUrl: 'assets/tutorials/flutter-apps.jpg',
      sections: [
        { title: 'Flutter and Dart Basics', duration: 35 },
        { title: 'Understanding Widgets', duration: 45 },
        { title: 'State Management', duration: 60 },
        { title: 'Navigation and Routing', duration: 40 },
        { title: 'Working with APIs', duration: 45 },
        { title: 'Deployment for iOS and Android', duration: 35 },
        { title: 'Advanced UI Techniques', duration: 40 },
      ],
      progress: 0,
      views: 2950,
      likes: 278,
    },
    {
      id: 'machine-learning-scikit',
      title: 'Machine Learning with scikit-learn',
      description:
        'A comprehensive guide to building machine learning models using scikit-learn. Covers classification, regression, clustering, and model evaluation techniques.',
      authorName: 'Mei Zhang, PhD',
      authorRole: 'Data Science & AI Instructor',
      authorAvatar: 'assets/instructors/mei-zhang.jpg',
      publishDate: 'March 20, 2024',
      duration: 270,
      difficulty: 'advanced',
      category: 'data-science',
      tags: ['Machine Learning', 'scikit-learn', 'Python', 'AI'],
      imageUrl: 'assets/tutorials/machine-learning.jpg',
      sections: [
        { title: 'ML Fundamentals', duration: 35 },
        { title: 'Data Preprocessing', duration: 40 },
        { title: 'Classification Algorithms', duration: 50 },
        { title: 'Regression Algorithms', duration: 45 },
        { title: 'Clustering Techniques', duration: 40 },
        { title: 'Model Evaluation', duration: 35 },
        { title: 'Hyperparameter Tuning', duration: 25 },
      ],
      progress: 15,
      views: 5680,
      likes: 495,
    },
    {
      id: 'aws-cloud-architecture',
      title: 'AWS Cloud Architecture: Building Scalable Solutions',
      description:
        'Learn how to design and implement scalable, resilient architectures on AWS. Covers core services, best practices, and real-world architecture patterns.',
      authorName: 'James Wilson',
      authorRole: 'DevOps & Cloud Instructor',
      authorAvatar: 'assets/instructors/james-wilson.jpg',
      publishDate: 'February 28, 2024',
      duration: 240,
      difficulty: 'advanced',
      category: 'cloud-computing',
      tags: ['AWS', 'Cloud', 'Architecture', 'DevOps'],
      imageUrl: 'assets/tutorials/aws-architecture.jpg',
      sections: [
        { title: 'AWS Fundamentals', duration: 30 },
        { title: 'Compute Services', duration: 35 },
        { title: 'Storage Solutions', duration: 30 },
        { title: 'Networking on AWS', duration: 35 },
        { title: 'Database Services', duration: 30 },
        { title: 'Security Best Practices', duration: 40 },
        { title: 'Scalable Architectures', duration: 40 },
      ],
      progress: 0,
      views: 3460,
      likes: 320,
    },
    {
      id: 'node-express-api',
      title: 'Building RESTful APIs with Node.js and Express',
      description:
        'A step-by-step guide to creating robust, scalable APIs using Node.js and Express. Learn route handling, middleware, authentication, and database integration.',
      authorName: 'Carlos Rodriguez',
      authorRole: 'Backend Development Instructor',
      authorAvatar: 'assets/instructors/carlos-rodriguez.jpg',
      publishDate: 'April 2, 2024',
      duration: 180,
      difficulty: 'intermediate',
      category: 'web-development',
      tags: ['Node.js', 'Express', 'API', 'Backend'],
      imageUrl: 'assets/tutorials/node-express.jpg',
      sections: [
        { title: 'RESTful API Fundamentals', duration: 25 },
        { title: 'Setting up Express', duration: 20 },
        { title: 'Routing and Controllers', duration: 30 },
        { title: 'Working with Middleware', duration: 25 },
        { title: 'Authentication and Authorization', duration: 40 },
        { title: 'Database Integration', duration: 40 },
      ],
      progress: 100,
      views: 2780,
      likes: 231,
    },
  ];

  // Categories
  categories: TutorialCategory[] = [
    {
      id: 'all',
      name: 'All Categories',
      count: this.tutorials.length,
      icon: 'bi-grid-fill',
    },
    {
      id: 'web-development',
      name: 'Web Development',
      count: this.countTutorialsInCategory('web-development'),
      icon: 'bi-code-slash',
    },
    {
      id: 'data-science',
      name: 'Data Science',
      count: this.countTutorialsInCategory('data-science'),
      icon: 'bi-graph-up',
    },
    {
      id: 'devops',
      name: 'DevOps',
      count: this.countTutorialsInCategory('devops'),
      icon: 'bi-gear-wide-connected',
    },
    {
      id: 'mobile-development',
      name: 'Mobile Development',
      count: this.countTutorialsInCategory('mobile-development'),
      icon: 'bi-phone',
    },
    {
      id: 'cloud-computing',
      name: 'Cloud Computing',
      count: this.countTutorialsInCategory('cloud-computing'),
      icon: 'bi-cloud-fill',
    },
  ];

  // Difficulty levels
  difficultyLevels: DifficultyLevel[] = [
    {
      id: 'beginner',
      name: 'Beginner',
      count: this.countTutorialsByDifficulty('beginner'),
      color: 'success',
    },
    {
      id: 'intermediate',
      name: 'Intermediate',
      count: this.countTutorialsByDifficulty('intermediate'),
      color: 'primary',
    },
    {
      id: 'advanced',
      name: 'Advanced',
      count: this.countTutorialsByDifficulty('advanced'),
      color: 'danger',
    },
  ];

  constructor(
    private scrollService: ScrollService,
    private route: ActivatedRoute,
    public themeService: ThemeService,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    this.scrollService.scrollToTop();

    // Check login status
    this.userService.currentUser$.subscribe((user) => {
      this.isLoggedIn = !!user;
    });

    // Check for query parameters
    this.route.queryParams.subscribe((params) => {
      if (params['category']) {
        this.selectedCategory = params['category'];
      }

      if (params['difficulty']) {
        this.selectedDifficulty = params['difficulty'];
      }

      if (params['search']) {
        this.searchQuery = params['search'];
      }

      if (params['sort']) {
        this.sortBy = params['sort'] as 'newest' | 'popular' | 'shortest';
      }
    });
  }

  /**
   * Format duration from minutes to hours and minutes
   */
  formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours > 0) {
      return `${hours}h${mins > 0 ? ` ${mins}m` : ''}`;
    } else {
      return `${mins}m`;
    }
  }

  /**
   * Count tutorials in a specific category
   */
  countTutorialsInCategory(categoryId: string): number {
    return this.tutorials.filter((tutorial) => tutorial.category === categoryId)
      .length;
  }

  /**
   * Count tutorials by difficulty level
   */
  countTutorialsByDifficulty(difficulty: string): number {
    return this.tutorials.filter(
      (tutorial) => tutorial.difficulty === difficulty
    ).length;
  }

  /**
   * Get category name by ID
   */
  getCategoryName(categoryId: string): string {
    const category = this.categories.find((c) => c.id === categoryId);
    return category ? category.name : '';
  }

  /**
   * Get category icon by ID
   */
  getCategoryIcon(categoryId: string): string {
    const category = this.categories.find((c) => c.id === categoryId);
    return category ? category.icon : 'bi-folder';
  }

  /**
   * Get difficulty name and color by ID
   */
  getDifficultyInfo(difficultyId: string): { name: string; color: string } {
    const difficulty = this.difficultyLevels.find((d) => d.id === difficultyId);
    return difficulty
      ? { name: difficulty.name, color: difficulty.color }
      : { name: 'Unknown', color: 'secondary' };
  }

  /**
   * Set active category
   */
  setCategory(categoryId: string): void {
    this.selectedCategory = categoryId;
    this.scrollService.scrollToTop();
  }

  /**
   * Set difficulty filter
   */
  setDifficulty(difficultyId: string): void {
    this.selectedDifficulty = difficultyId;
    this.scrollService.scrollToTop();
  }

  /**
   * Search for tutorials
   */
  searchTutorials(event: Event): void {
    event.preventDefault();
    // Search logic is handled by the filteredTutorials getter
  }

  /**
   * Clear search
   */
  clearSearch(): void {
    this.searchQuery = '';
  }

  /**
   * Get filtered and sorted tutorials
   */
  get filteredTutorials(): Tutorial[] {
    let filtered = this.tutorials;

    // Filter by category
    if (this.selectedCategory !== 'all') {
      filtered = filtered.filter(
        (tutorial) => tutorial.category === this.selectedCategory
      );
    }

    // Filter by difficulty
    if (this.selectedDifficulty !== 'all') {
      filtered = filtered.filter(
        (tutorial) => tutorial.difficulty === this.selectedDifficulty
      );
    }

    // Filter by search
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (tutorial) =>
          tutorial.title.toLowerCase().includes(query) ||
          tutorial.description.toLowerCase().includes(query) ||
          tutorial.authorName.toLowerCase().includes(query) ||
          tutorial.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          this.getCategoryName(tutorial.category).toLowerCase().includes(query)
      );
    }

    // Sort tutorials
    return filtered.sort((a, b) => {
      if (this.sortBy === 'newest') {
        return (
          new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime()
        );
      } else if (this.sortBy === 'popular') {
        return b.views - a.views;
      } else if (this.sortBy === 'shortest') {
        return a.duration - b.duration;
      }
      return 0;
    });
  }

  /**
   * Get featured tutorials
   */
  get featuredTutorials(): Tutorial[] {
    return this.tutorials.filter((tutorial) => tutorial.isFeatured);
  }

  /**
   * Get in-progress tutorials for logged in users
   */
  get inProgressTutorials(): Tutorial[] {
    if (!this.isLoggedIn) return [];
    return this.tutorials.filter(
      (tutorial) =>
        tutorial.progress && tutorial.progress > 0 && tutorial.progress < 100
    );
  }

  /**
   * Calculate total time for all tutorials in a category
   */
  getTotalTimeForCategory(categoryId: string): number {
    if (categoryId === 'all') {
      return this.tutorials.reduce(
        (total, tutorial) => total + tutorial.duration,
        0
      );
    } else {
      return this.tutorials
        .filter((tutorial) => tutorial.category === categoryId)
        .reduce((total, tutorial) => total + tutorial.duration, 0);
    }
  }

  /**
   * Format large numbers with K/M suffixes
   */
  formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    } else {
      return num.toString();
    }
  }
}
