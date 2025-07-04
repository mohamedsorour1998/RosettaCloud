import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ScrollService } from '../services/scroll.service';
import { ThemeService } from '../services/theme.service';

interface Webinar {
  id: string;
  title: string;
  description: string;
  speakerName: string;
  speakerRole: string;
  speakerAvatar: string;
  date: string;
  time: string;
  duration: number; // in minutes
  category: string;
  tags: string[];
  imageUrl: string;
  registrationUrl: string;
  isUpcoming: boolean;
  recordingUrl?: string;
  slides?: string;
  attendees?: number;
}

interface WebinarCategory {
  id: string;
  name: string;
  count: number;
  icon: string;
}

@Component({
  selector: 'app-webinars',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './webinars.component.html',
  styleUrls: ['./webinars.component.scss'],
})
export class WebinarsComponent implements OnInit {
  searchQuery: string = '';
  selectedCategory: string = 'all';
  showPastWebinars: boolean = false;

  // Webinars data
  webinars: Webinar[] = [
    {
      id: 'modern-js-frameworks',
      title: 'Modern JavaScript Frameworks: Comparing React, Vue, and Angular',
      description:
        "This webinar will provide an in-depth comparison of today's most popular JavaScript frameworks. We'll analyze their strengths, weaknesses, and ideal use cases to help you choose the right tool for your next project.",
      speakerName: 'Layla Mahmoud',
      speakerRole: 'Frontend Development Instructor',
      speakerAvatar: 'assets/instructors/layla-mahmoud.jpg',
      date: 'May 25, 2024',
      time: '2:00 PM EST',
      duration: 90,
      category: 'web-development',
      tags: ['JavaScript', 'React', 'Vue', 'Angular', 'Frontend'],
      imageUrl: 'assets/webinars/js-frameworks.jpg',
      registrationUrl: '/register-webinar/modern-js-frameworks',
      isUpcoming: true,
      attendees: 235,
    },
    {
      id: 'cloud-architecture',
      title: 'Cloud Architecture Patterns for Scalable Applications',
      description:
        "Learn proven architectural patterns for building highly scalable and resilient applications in the cloud. We'll cover microservices, serverless architecture, and distributed systems design with practical examples.",
      speakerName: 'James Wilson',
      speakerRole: 'DevOps & Cloud Instructor',
      speakerAvatar: 'assets/instructors/james-wilson.jpg',
      date: 'June 10, 2024',
      time: '1:30 PM EST',
      duration: 120,
      category: 'cloud-computing',
      tags: ['AWS', 'Azure', 'Microservices', 'Serverless', 'DevOps'],
      imageUrl: 'assets/webinars/cloud-arch.jpg',
      registrationUrl: '/register-webinar/cloud-architecture',
      isUpcoming: true,
      attendees: 187,
    },
    {
      id: 'machine-learning-beginners',
      title: 'Machine Learning for Beginners: From Theory to Practice',
      description:
        "A beginner-friendly introduction to machine learning fundamentals. We'll demystify key concepts and demonstrate how to build your first ML model, all while avoiding complex mathematics.",
      speakerName: 'Mei Zhang, PhD',
      speakerRole: 'Data Science & AI Instructor',
      speakerAvatar: 'assets/instructors/mei-zhang.jpg',
      date: 'May 30, 2024',
      time: '3:00 PM EST',
      duration: 90,
      category: 'data-science',
      tags: ['Machine Learning', 'AI', 'Python', 'Beginners'],
      imageUrl: 'assets/webinars/ml-beginners.jpg',
      registrationUrl: '/register-webinar/machine-learning-beginners',
      isUpcoming: true,
      attendees: 312,
    },
    {
      id: 'api-design',
      title: 'RESTful API Design Best Practices',
      description:
        'Explore the principles of well-designed APIs that are maintainable, scalable, and developer-friendly. This session covers resource modeling, versioning strategies, authentication methods, and documentation.',
      speakerName: 'Carlos Rodriguez',
      speakerRole: 'Backend Development Instructor',
      speakerAvatar: 'assets/instructors/carlos-rodriguez.jpg',
      date: 'May 3, 2024',
      time: '2:00 PM EST',
      duration: 75,
      category: 'web-development',
      tags: ['API', 'REST', 'Backend', 'Web Services'],
      imageUrl: 'assets/webinars/api-design.jpg',
      registrationUrl: '',
      isUpcoming: false,
      recordingUrl: 'https://www.rosettacloud.app/recordings/api-design',
      slides: 'https://www.rosettacloud.app/slides/api-design.pdf',
      attendees: 245,
    },
    {
      id: 'cybersecurity-fundamentals',
      title: 'Cybersecurity Fundamentals: Protecting Your Digital Assets',
      description:
        'An essential overview of cybersecurity principles for developers and IT professionals. Learn about common vulnerabilities, threat modeling, and practical security measures you can implement today.',
      speakerName: 'Priya Patel',
      speakerRole: 'Cybersecurity Instructor',
      speakerAvatar: 'assets/instructors/priya-patel.jpg',
      date: 'April 18, 2024',
      time: '1:00 PM EST',
      duration: 90,
      category: 'security',
      tags: ['Cybersecurity', 'Security', 'Vulnerability', 'Protection'],
      imageUrl: 'assets/webinars/cybersecurity.jpg',
      registrationUrl: '',
      isUpcoming: false,
      recordingUrl:
        'https://www.rosettacloud.app/recordings/cybersecurity-fundamentals',
      slides:
        'https://www.rosettacloud.app/slides/cybersecurity-fundamentals.pdf',
      attendees: 198,
    },
    {
      id: 'data-visualization',
      title: 'Data Visualization Techniques for Effective Communication',
      description:
        'Master the art of transforming complex data into compelling visual stories. This webinar covers visualization principles, tool selection, and design techniques that make your insights more accessible and impactful.',
      speakerName: 'Sophia Chen',
      speakerRole: 'Data Engineering Instructor',
      speakerAvatar: 'assets/instructors/sophia-chen.jpg',
      date: 'April 10, 2024',
      time: '11:00 AM EST',
      duration: 60,
      category: 'data-science',
      tags: ['Data Visualization', 'Charts', 'Dashboards', 'D3.js'],
      imageUrl: 'assets/webinars/data-viz.jpg',
      registrationUrl: '',
      isUpcoming: false,
      recordingUrl:
        'https://www.rosettacloud.app/recordings/data-visualization',
      slides: 'https://www.rosettacloud.app/slides/data-visualization.pdf',
      attendees: 176,
    },
  ];

  // Categories
  categories: WebinarCategory[] = [
    {
      id: 'all',
      name: 'All Categories',
      count: this.webinars.length,
      icon: 'bi-grid-fill',
    },
    {
      id: 'web-development',
      name: 'Web Development',
      count: this.countWebinarsInCategory('web-development'),
      icon: 'bi-code-slash',
    },
    {
      id: 'data-science',
      name: 'Data Science',
      count: this.countWebinarsInCategory('data-science'),
      icon: 'bi-graph-up',
    },
    {
      id: 'cloud-computing',
      name: 'Cloud Computing',
      count: this.countWebinarsInCategory('cloud-computing'),
      icon: 'bi-cloud-fill',
    },
    {
      id: 'security',
      name: 'Security',
      count: this.countWebinarsInCategory('security'),
      icon: 'bi-shield-lock-fill',
    },
  ];

  constructor(
    private scrollService: ScrollService,
    private route: ActivatedRoute,
    public themeService: ThemeService
  ) {}

  ngOnInit(): void {
    this.scrollService.scrollToTop();

    // Check for query parameters
    this.route.queryParams.subscribe((params) => {
      if (params['category']) {
        this.selectedCategory = params['category'];
      }

      if (params['search']) {
        this.searchQuery = params['search'];
      }

      if (params['past'] === 'true') {
        this.showPastWebinars = true;
      }
    });
  }

  /**
   * Get webinar date in readable format
   */
  getWebinarDate(webinar: Webinar): string {
    return `${webinar.date} at ${webinar.time}`;
  }

  /**
   * Get remaining days until webinar
   */
  getRemainingDays(dateString: string): number {
    const today = new Date();
    const webinarDate = new Date(dateString);
    const timeDiff = webinarDate.getTime() - today.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
  }

  /**
   * Count webinars in a specific category
   */
  countWebinarsInCategory(categoryId: string): number {
    return this.webinars.filter((webinar) => webinar.category === categoryId)
      .length;
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
   * Set active category
   */
  setCategory(categoryId: string): void {
    this.selectedCategory = categoryId;
    this.scrollService.scrollToTop();
  }

  /**
   * Toggle between upcoming and past webinars
   */
  togglePastWebinars(): void {
    this.showPastWebinars = !this.showPastWebinars;
    this.scrollService.scrollToTop();
  }

  /**
   * Search for webinars
   */
  searchWebinars(event: Event): void {
    event.preventDefault();
    // Search logic is handled by the filteredWebinars getter
  }

  /**
   * Clear search
   */
  clearSearch(): void {
    this.searchQuery = '';
  }

  /**
   * Get filtered webinars based on search, category, and upcoming/past selection
   */
  get filteredWebinars(): Webinar[] {
    let filtered = this.webinars;

    // Filter by upcoming/past
    filtered = filtered.filter(
      (webinar) => webinar.isUpcoming === !this.showPastWebinars
    );

    // Filter by category
    if (this.selectedCategory !== 'all') {
      filtered = filtered.filter(
        (webinar) => webinar.category === this.selectedCategory
      );
    }

    // Filter by search
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (webinar) =>
          webinar.title.toLowerCase().includes(query) ||
          webinar.description.toLowerCase().includes(query) ||
          webinar.speakerName.toLowerCase().includes(query) ||
          webinar.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          this.getCategoryName(webinar.category).toLowerCase().includes(query)
      );
    }

    // Sort upcoming webinars by date (nearest first)
    // Sort past webinars by date (most recent first)
    return filtered.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);

      if (this.showPastWebinars) {
        return dateB.getTime() - dateA.getTime(); // Descending for past
      } else {
        return dateA.getTime() - dateB.getTime(); // Ascending for upcoming
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
}
