import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../services/theme.service';

interface Instructor {
  id: string;
  name: string;
  role: string;
  bio: string;
  expertise: string[];
  imageUrl: string;
  socialLinks?: {
    twitter?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  };
}

@Component({
  selector: 'app-instructors',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './instructors.component.html',
  styleUrls: ['./instructors.component.scss'],
})
export class InstructorsComponent implements OnInit {
  // Search functionality
  searchQuery: string = '';
  allInstructors: Instructor[] = [];
  filteredFeaturedInstructors: Instructor[] = [];
  filteredInstructors: Instructor[] = [];
  isSearching: boolean = false;
  showNoResults: boolean = false;

  featuredInstructors: Instructor[] = [
    {
      id: 'sarah-johnson',
      name: 'Dr. Sarah Johnson',
      role: 'Lead Instructor, Full Stack Development',
      bio: 'Dr. Johnson has over 15 years of experience in software development and has worked with companies like Google and Microsoft. She specializes in modern web technologies and has helped thousands of students start their tech careers.',
      expertise: ['JavaScript', 'React', 'Node.js', 'System Design'],
      imageUrl: 'assets/instructors/sarah-johnson.jpg',
      socialLinks: {
        twitter: 'https://twitter.com/sarahjdev',
        linkedin: 'https://linkedin.com/in/sarahjohnsondev',
        github: 'https://github.com/sarahjdev',
      },
    },
    {
      id: 'ahmad-hassan',
      name: 'Ahmad Hassan',
      role: 'Senior Instructor, Mobile Development',
      bio: 'Ahmad is a mobile development expert with experience building apps for startups and enterprises. Previously at Uber, he now focuses on teaching the next generation of mobile developers with a focus on cross-platform technologies.',
      expertise: ['Flutter', 'React Native', 'iOS', 'Android'],
      imageUrl: 'assets/instructors/ahmad-hassan.jpg',
      socialLinks: {
        twitter: 'https://twitter.com/ahmadmobile',
        github: 'https://github.com/ahmadhassan',
        website: 'https://ahmadhassan.dev',
      },
    },
    {
      id: 'mei-zhang',
      name: 'Mei Zhang, PhD',
      role: 'Data Science & AI Instructor',
      bio: 'Dr. Zhang is a former research scientist at OpenAI with expertise in machine learning and data science. She has published numerous papers on AI and is passionate about making complex technical concepts accessible to everyone.',
      expertise: ['Machine Learning', 'Python', 'Data Visualization', 'NLP'],
      imageUrl: 'assets/instructors/mei-zhang.jpg',
      socialLinks: {
        linkedin: 'https://linkedin.com/in/meizhanggai',
        github: 'https://github.com/meizhang',
      },
    },
  ];

  instructors: Instructor[] = [
    {
      id: 'james-wilson',
      name: 'James Wilson',
      role: 'DevOps & Cloud Instructor',
      bio: 'James specializes in cloud infrastructure and DevOps practices. With certifications in AWS, Azure, and GCP, he brings practical experience from his work at financial institutions to help students master cloud deployments.',
      expertise: ['AWS', 'Docker', 'Kubernetes', 'CI/CD'],
      imageUrl: 'assets/instructors/james-wilson.jpg',
    },
    {
      id: 'layla-mahmoud',
      name: 'Layla Mahmoud',
      role: 'Frontend Development Instructor',
      bio: 'Layla is a UI/UX specialist and frontend developer who has worked with startups across the MENA region. She focuses on teaching modern frontend frameworks and responsive design principles.',
      expertise: ['UI/UX', 'React', 'CSS', 'Design Systems'],
      imageUrl: 'assets/instructors/layla-mahmoud.jpg',
    },
    {
      id: 'carlos-rodriguez',
      name: 'Carlos Rodriguez',
      role: 'Backend Development Instructor',
      bio: 'Carlos has 10+ years of experience building scalable backend systems. He previously worked at Amazon Web Services and now specializes in teaching distributed systems and microservices architecture.',
      expertise: ['Java', 'Spring Boot', 'Microservices', 'Databases'],
      imageUrl: 'assets/instructors/carlos-rodriguez.jpg',
    },
    {
      id: 'priya-patel',
      name: 'Priya Patel',
      role: 'Cybersecurity Instructor',
      bio: 'Priya comes from a background in cybersecurity consulting for Fortune 500 companies. She is CISSP certified and passionate about teaching practical security skills that are in high demand.',
      expertise: ['Network Security', 'Ethical Hacking', 'Security Auditing'],
      imageUrl: 'assets/instructors/priya-patel.jpg',
    },
    {
      id: 'david-mensah',
      name: 'David Mensah',
      role: 'Game Development Instructor',
      bio: 'David has worked on several successful indie games and AAA titles. He specializes in teaching game development fundamentals and helping students build their first playable games from scratch.',
      expertise: ['Unity', 'C#', 'Game Design', '3D Modeling'],
      imageUrl: 'assets/instructors/david-mensah.jpg',
    },
    {
      id: 'sophia-chen',
      name: 'Sophia Chen',
      role: 'Data Engineering Instructor',
      bio: 'Sophia specializes in big data processing and data engineering pipelines. She has helped companies implement data solutions and enjoys teaching students how to work with large-scale data systems.',
      expertise: ['Hadoop', 'Spark', 'ETL', 'Data Pipelines'],
      imageUrl: 'assets/instructors/sophia-chen.jpg',
    },
  ];

  // Track which instructor's details are being viewed
  selectedInstructor: Instructor | null = null;

  // Stats with animations
  stats = [
    { value: '25+', label: 'Expert Instructors', icon: 'bi-people-fill' },
    { value: '15+', label: 'Years Avg. Experience', icon: 'bi-award-fill' },
    { value: '50k+', label: 'Students Taught', icon: 'bi-mortarboard-fill' },
    { value: '98%', label: 'Satisfaction Rate', icon: 'bi-star-fill' },
  ];

  constructor(private themeService: ThemeService) {}

  ngOnInit(): void {
    // Initialize with animation classes
    this.addScrollAnimations();

    // Combine all instructors for search
    this.allInstructors = [...this.featuredInstructors, ...this.instructors];

    // Initialize filtered lists
    this.filteredFeaturedInstructors = [...this.featuredInstructors];
    this.filteredInstructors = [...this.instructors];
  }

  // Search functionality
  searchInstructors(): void {
    this.isSearching = true;
    this.showNoResults = false;

    // If search is empty, reset to original lists
    if (!this.searchQuery.trim()) {
      this.filteredFeaturedInstructors = [...this.featuredInstructors];
      this.filteredInstructors = [...this.instructors];
      this.isSearching = false;
      return;
    }

    // Normalize the search query
    const query = this.searchQuery.toLowerCase().trim();

    // Perform the search
    setTimeout(() => {
      // Filter both lists
      this.filteredFeaturedInstructors = this.featuredInstructors.filter(
        (instructor) => this.instructorMatchesSearch(instructor, query)
      );

      this.filteredInstructors = this.instructors.filter((instructor) =>
        this.instructorMatchesSearch(instructor, query)
      );

      // Check if we have any results
      this.showNoResults =
        this.filteredFeaturedInstructors.length === 0 &&
        this.filteredInstructors.length === 0;

      this.isSearching = false;
    }, 300); // Small delay to show loading state
  }

  // Helper to check if instructor matches search query
  private instructorMatchesSearch(
    instructor: Instructor,
    query: string
  ): boolean {
    return (
      instructor.name.toLowerCase().includes(query) ||
      instructor.role.toLowerCase().includes(query) ||
      instructor.bio.toLowerCase().includes(query) ||
      instructor.expertise.some((skill) => skill.toLowerCase().includes(query))
    );
  }

  // Reset search
  clearSearch(): void {
    this.searchQuery = '';
    this.searchInstructors();
  }

  // Show instructor details
  showInstructorDetails(instructor: Instructor): void {
    this.selectedInstructor = instructor;

    // Use setTimeout to ensure the modal has time to be created in the DOM
    setTimeout(() => {
      const modalElement = document.getElementById('instructorModal');
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

  // Close instructor details modal
  closeInstructorDetails(): void {
    this.selectedInstructor = null;
  }

  // Generate initials for avatar fallback
  getInitials(name: string): string {
    if (!name) return '';
    const parts = name.split(' ');
    return (
      parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')
    ).toUpperCase();
  }

  // Handle image loading errors
  handleImageError(event: any, instructor: Instructor): void {
    // Create a colored avatar with initials
    const initials = this.getInitials(instructor.name);

    // Hide the img element
    event.target.style.display = 'none';

    // Create an avatar element
    const parent = event.target.parentElement;
    if (parent) {
      const avatar = document.createElement('div');
      avatar.className = 'instructor-avatar';
      avatar.textContent = initials;

      // Generate a color based on the instructor name for consistency
      const hue = this.getHashCode(instructor.name) % 360;
      avatar.style.background = `linear-gradient(135deg, hsl(${hue}, 70%, 35%), hsl(${hue}, 80%, 25%))`;

      parent.appendChild(avatar);
    }
  }

  // Generate a consistent hash code from a string
  private getHashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
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
}
