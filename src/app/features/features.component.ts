import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ThemeService } from '../services/theme.service';

interface Feature {
  title: string;
  description: string;
  icon: string;
}

interface Testimonial {
  quote: string;
  author: string;
  role: string;
  company: string;
  imageUrl?: string;
}

@Component({
  selector: 'app-features',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './features.component.html',
  styleUrls: ['./features.component.scss'],
})
export class FeaturesComponent implements OnInit {
  features: Feature[] = [
    {
      title: 'Interactive Learning Labs',
      description:
        'Practice coding in real-time with our browser-based development environments. No setup required - just start coding instantly.',
      icon: 'bi-laptop',
    },
    {
      title: 'AI-Powered Feedback',
      description:
        'Receive instant, personalized feedback on your code from our intelligent grading system, helping you learn from mistakes faster.',
      icon: 'bi-robot',
    },
    {
      title: 'Expert-Led Courses',
      description:
        'Learn from industry professionals with real-world experience at top tech companies across the MENA region and globally.',
      icon: 'bi-person-video3',
    },
    {
      title: 'Project-Based Learning',
      description:
        'Build real-world projects that you can add to your portfolio, demonstrating your skills to potential employers.',
      icon: 'bi-kanban',
    },
    {
      title: 'Career Support',
      description:
        'Get guidance on resume building, interview preparation, and job hunting strategies to kickstart your tech career.',
      icon: 'bi-briefcase',
    },
    {
      title: 'Community Engagement',
      description:
        'Connect with fellow learners, collaborate on projects, and build your professional network within our thriving community.',
      icon: 'bi-people',
    },
  ];

  keyFeatures: Feature[] = [
    {
      title: 'Personalized Learning Paths',
      description:
        'Our platform adapts to your skill level and learning goals, creating a customized curriculum that evolves as you progress.',
      icon: 'bi-signpost-split',
    },
    {
      title: 'Multilingual Support',
      description:
        'Access courses in Arabic and English, making tech education accessible across the entire MENA region.',
      icon: 'bi-translate',
    },
    {
      title: 'Offline Learning',
      description:
        'Download course materials to continue learning even without an internet connection, perfect for areas with limited connectivity.',
      icon: 'bi-cloud-download',
    },
  ];

  testimonials: Testimonial[] = [
    {
      quote:
        'RosettaCloud transformed my career path. The interactive labs and personalized feedback helped me master coding concepts I had struggled with for years.',
      author: 'Fatima Al-Zahra',
      role: 'Junior Developer',
      company: 'TechVision Cairo',
      imageUrl: 'assets/testimonials/fatima.jpg',
    },
    {
      quote:
        'As someone with no technical background, I was intimidated by programming. RosettaCloud made it approachable with step-by-step guidance and real-time support.',
      author: 'Omar Khalid',
      role: 'UX Designer',
      company: 'Creative Solutions',
      imageUrl: 'assets/testimonials/omar.jpg',
    },
    {
      quote:
        'The project-based approach gave me practical experience that I could immediately apply in my job. My company has already promoted me based on my new skills!',
      author: 'Leila Mansour',
      role: 'Data Analyst',
      company: 'FinTech Innovations',
      imageUrl: 'assets/testimonials/leila.jpg',
    },
  ];

  constructor(private themeService: ThemeService) {}

  ngOnInit(): void {
    // Scroll to the features section if the URL has the #features hash
    setTimeout(() => {
      if (window.location.hash === '#features') {
        const featuresSection = document.getElementById('features');
        if (featuresSection) {
          featuresSection.scrollIntoView({ behavior: 'smooth' });
        }
      }
    }, 100);
  }

  // Method to get initials for avatar fallback
  getInitials(name: string): string {
    if (!name) return '';
    const parts = name.split(' ');
    return (
      parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')
    ).toUpperCase();
  }

  // Helper for responsive image loading
  imageError(event: any): void {
    // Create initials for the fallback
    const testimonial = this.testimonials.find(
      (t) =>
        t.imageUrl === event.target.src || event.target.alt.includes(t.author)
    );

    if (testimonial) {
      const initials = this.getInitials(testimonial.author);
      // Set a solid color background with initials instead
      event.target.style.display = 'none';
      const parent = event.target.parentElement;

      if (parent) {
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'author-avatar';
        avatarDiv.textContent = initials;
        parent.appendChild(avatarDiv);
      }
    } else {
      // Generic fallback
      event.target.src = 'https://via.placeholder.com/60x60?text=User';
    }
  }
}
