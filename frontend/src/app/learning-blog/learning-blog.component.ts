import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ScrollService } from '../services/scroll.service';
import { ThemeService } from '../services/theme.service';

interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  content: string[];
  category: string;
  authorName: string;
  authorRole: string;
  authorAvatar: string;
  publishDate: string;
  readTime: number;
  featured: boolean;
  tags: string[];
  imageUrl: string;
}

interface BlogCategory {
  id: string;
  name: string;
  description: string;
  count: number;
  icon: string;
}

@Component({
  selector: 'app-learning-blog',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './learning-blog.component.html',
  styleUrls: ['./learning-blog.component.scss'],
})
export class LearningBlogComponent implements OnInit {
  searchQuery: string = '';
  selectedCategory: string = 'all';

  // Blog posts data
  blogPosts: BlogPost[] = [
    {
      id: 'effective-study-techniques',
      title: 'Effective Study Techniques for Technical Subjects',
      excerpt:
        'Discover proven methods to improve retention and understanding when learning complex technical topics.',
      content: [
        'When it comes to mastering technical subjects, traditional study methods often fall short. Technical learning requires a different approach that emphasizes practical application and conceptual understanding.',
        'The Feynman Technique, named after physicist Richard Feynman, is particularly effective for technical subjects. This method involves explaining complex concepts in simple terms as if teaching someone else. When you can explain a concept clearly and simply, it demonstrates true understanding.',
        'Spaced repetition is another powerful technique. Instead of cramming information in one session, spread your study sessions over time. This approach is scientifically proven to improve long-term retention, which is crucial for building technical knowledge that builds upon itself.',
        'Active recall testing is also essential. Instead of passively reading or watching videos, challenge yourself to retrieve information from memory regularly. This strengthens neural pathways and makes knowledge more accessible when you need it.',
      ],
      category: 'study-techniques',
      authorName: 'Dr. Sarah Johnson',
      authorRole: 'Lead Instructor, Full Stack Development',
      authorAvatar: 'assets/instructors/sarah-johnson.jpg',
      publishDate: 'May 5, 2024',
      readTime: 7,
      featured: true,
      tags: ['learning', 'productivity', 'study-methods'],
      imageUrl: 'assets/blog/study-techniques.jpg',
    },
    {
      id: 'programming-learning-path',
      title: 'The Optimal Learning Path for New Programmers',
      excerpt:
        'A structured approach to learning programming that will take you from beginner to professional developer.',
      content: [
        'Learning to program can feel overwhelming with countless languages, frameworks, and technologies to choose from. This guide provides a clear, structured path that focuses on building a solid foundation first.',
        'Start with the fundamentals: variables, data types, control flow, and functions. These concepts are universal across programming languages and form the building blocks of all software. Once you understand these core concepts in one language, youll find it much easier to learn others.',
        'Next, develop problem-solving skills through regular practice with coding challenges. Sites like LeetCode, HackerRank, and Exercism offer progressive difficulty levels to grow your skills systematically.',
        'After building a strong foundation, focus on a specific area that interests you: web development, mobile apps, data science, or game development. Specializing allows you to deepen your knowledge in a particular domain while applying fundamental concepts.',
      ],
      category: 'programming',
      authorName: 'James Wilson',
      authorRole: 'DevOps & Cloud Instructor',
      authorAvatar: 'assets/instructors/james-wilson.jpg',
      publishDate: 'April 28, 2024',
      readTime: 9,
      featured: true,
      tags: ['programming', 'beginners', 'learning-path'],
      imageUrl: 'assets/blog/programming-path.jpg',
    },
    {
      id: 'ai-assisted-learning',
      title: 'How AI Can Enhance Your Learning Experience',
      excerpt:
        'Explore how artificial intelligence tools can be leveraged to improve study efficiency and knowledge retention.',
      content: [
        'Artificial intelligence has transformed many aspects of our lives, and education is no exception. AI-powered tools can personalize your learning experience, identify knowledge gaps, and help you study more efficiently.',
        'Spaced repetition systems powered by AI algorithms can track your learning progress and optimize review schedules based on your forgetting curve. This ensures you review content right before youre likely to forget it, maximizing retention efficiency.',
        'Natural language processing tools can help summarize complex texts, extract key concepts, and even generate practice questions. These tools are particularly valuable when tackling dense technical documentation or academic papers.',
        'AI tutoring systems can provide instant feedback on coding exercises, math problems, and written assignments. This immediate feedback loop accelerates learning by helping you identify and correct mistakes right away rather than reinforcing incorrect patterns.',
      ],
      category: 'technology',
      authorName: 'Mei Zhang, PhD',
      authorRole: 'Data Science & AI Instructor',
      authorAvatar: 'assets/instructors/mei-zhang.jpg',
      publishDate: 'May 2, 2024',
      readTime: 6,
      featured: false,
      tags: ['AI', 'EdTech', 'learning-tools'],
      imageUrl: 'assets/blog/ai-learning.jpg',
    },
    {
      id: 'mastering-technical-documentation',
      title: 'Mastering the Art of Technical Documentation',
      excerpt:
        'Learn how to create clear, effective documentation for technical projects and APIs.',
      content: [
        'Well-written technical documentation is crucial for any successful software project. It helps users understand your product, reduces support requests, and makes collaboration easier for development teams.',
        'Start by understanding your audience. Documentation for developers will differ significantly from documentation aimed at end-users. Tailor your language, examples, and level of technical detail to match your readers knowledge and needs.',
        'Structure is key to navigable documentation. Use clear hierarchies, logical grouping of topics, and consistent formatting. A well-organized table of contents and search functionality can dramatically improve user experience.',
        'Include plenty of examples and code snippets that readers can copy and adapt. Real-world use cases help bridge the gap between abstract concepts and practical application. Diagrams, screenshots, and other visual aids can clarify complex information much more effectively than text alone.',
      ],
      category: 'technical-writing',
      authorName: 'Layla Mahmoud',
      authorRole: 'Frontend Development Instructor',
      authorAvatar: 'assets/instructors/layla-mahmoud.jpg',
      publishDate: 'April 20, 2024',
      readTime: 8,
      featured: false,
      tags: ['documentation', 'technical-writing', 'development'],
      imageUrl: 'assets/blog/technical-docs.jpg',
    },
    {
      id: 'data-science-journey',
      title: 'My Journey from Beginner to Data Scientist',
      excerpt:
        'A personal account of the challenges and milestones on the path to becoming a data professional.',
      content: [
        'My transition from complete novice to working data scientist took two years of focused effort. This post outlines the key milestones, challenges, and lessons I learned along the way to help others on a similar journey.',
        'I started with Python fundamentals, focusing on data structures and algorithms. While tempting to jump straight into machine learning libraries, building a solid programming foundation proved invaluable for writing efficient, maintainable code later on.',
        'Statistics was initially challenging but essential. Understanding concepts like probability distributions, hypothesis testing, and experimental design helped me avoid common analytical pitfalls and build more robust models.',
        'Working on realistic projects was the single most valuable learning activity. Each project taught me not just technical skills, but how to frame problems, clean messy data, and communicate results effectively to non-technical stakeholders.',
      ],
      category: 'data-science',
      authorName: 'Sophia Chen',
      authorRole: 'Data Engineering Instructor',
      authorAvatar: 'assets/instructors/sophia-chen.jpg',
      publishDate: 'May 8, 2024',
      readTime: 10,
      featured: false,
      tags: ['data-science', 'career', 'learning-journey'],
      imageUrl: 'assets/blog/data-science.jpg',
    },
  ];

  // Categories
  categories: BlogCategory[] = [
    {
      id: 'all',
      name: 'All Categories',
      description: 'Browse all learning resources and articles',
      count: this.blogPosts.length,
      icon: 'bi-grid-fill',
    },
    {
      id: 'study-techniques',
      name: 'Study Techniques',
      description: 'Effective methods to improve learning and retention',
      count: this.countPostsInCategory('study-techniques'),
      icon: 'bi-book-fill',
    },
    {
      id: 'programming',
      name: 'Programming',
      description: 'Coding tutorials and development best practices',
      count: this.countPostsInCategory('programming'),
      icon: 'bi-code-square',
    },
    {
      id: 'technology',
      name: 'Technology',
      description: 'Latest tools and technologies in education',
      count: this.countPostsInCategory('technology'),
      icon: 'bi-cpu-fill',
    },
    {
      id: 'technical-writing',
      name: 'Technical Writing',
      description: 'Creating clear and effective documentation',
      count: this.countPostsInCategory('technical-writing'),
      icon: 'bi-file-text-fill',
    },
    {
      id: 'data-science',
      name: 'Data Science',
      description: 'Data analysis, visualization and machine learning',
      count: this.countPostsInCategory('data-science'),
      icon: 'bi-graph-up',
    },
  ];

  // Computed properties
  get featuredPosts(): BlogPost[] {
    return this.blogPosts.filter((post) => post.featured);
  }

  get filteredPosts(): BlogPost[] {
    let filtered = this.blogPosts;

    // Filter by category
    if (this.selectedCategory !== 'all') {
      filtered = filtered.filter(
        (post) => post.category === this.selectedCategory
      );
    }

    // Filter by search
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (post) =>
          post.title.toLowerCase().includes(query) ||
          post.excerpt.toLowerCase().includes(query) ||
          post.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          post.category.toLowerCase().includes(query) ||
          post.authorName.toLowerCase().includes(query)
      );
    }

    return filtered;
  }

  constructor(
    private scrollService: ScrollService,
    private route: ActivatedRoute,
    public themeService: ThemeService
  ) {}

  ngOnInit(): void {
    this.scrollService.scrollToTop();

    // Check for category parameter in URL
    this.route.queryParams.subscribe((params) => {
      if (params['category']) {
        this.selectedCategory = params['category'];
      }

      if (params['search']) {
        this.searchQuery = params['search'];
      }
    });
  }

  /**
   * Count posts in a specific category
   */
  countPostsInCategory(categoryId: string): number {
    return this.blogPosts.filter((post) => post.category === categoryId).length;
  }

  /**
   * Set active category
   */
  setCategory(categoryId: string): void {
    this.selectedCategory = categoryId;
    this.scrollService.scrollToTop();
  }

  /**
   * Search for posts
   */
  searchPosts(event: Event): void {
    event.preventDefault();
    // Search logic is handled by the filteredPosts getter
  }

  /**
   * Clear search
   */
  clearSearch(): void {
    this.searchQuery = '';
  }
  /**
   * Get category name by ID
   */
  getCategoryName(categoryId: string): string {
    const category = this.categories.find((c) => c.id === categoryId);
    return category ? category.name : '';
  }

  /**
   * Get category description by ID
   */
  getCategoryDescription(categoryId: string): string {
    const category = this.categories.find((c) => c.id === categoryId);
    return category ? category.description : '';
  }

  /**
   * Get category icon by ID
   */
  getCategoryIcon(categoryId: string): string {
    const category = this.categories.find((c) => c.id === categoryId);
    return category ? category.icon : 'bi-folder';
  }
}
