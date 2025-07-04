import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface TeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  imageUrl: string;
  socialLinks?: {
    twitter?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  };
}

interface MilestoneItem {
  year: string;
  title: string;
  description: string;
  icon: string;
}

interface ValueItem {
  icon: string;
  title: string;
  description: string;
}

@Component({
  selector: 'app-about-us',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './about-us.component.html',
  styleUrl: './about-us.component.scss',
})
export class AboutUsComponent implements OnInit {
  // Company founding year for calculating years of service
  foundingYear: number = 2015;
  currentYear: number = new Date().getFullYear();
  yearsActive: number = this.currentYear - this.foundingYear;

  // Key stats for the company
  stats = [
    { value: '50k+', label: 'Students Worldwide', icon: 'bi-people-fill' },
    {
      value: this.yearsActive + '+',
      label: 'Years of Excellence',
      icon: 'bi-calendar-check-fill',
    },
    { value: '25+', label: 'Countries Reached', icon: 'bi-globe-americas' },
    { value: '120+', label: 'Team Members', icon: 'bi-person-workspace' },
  ];

  // Core values section
  coreValues: ValueItem[] = [
    {
      icon: 'bi-lightbulb-fill',
      title: 'Innovation',
      description:
        'We embrace emerging technologies and pedagogical approaches to create learning experiences that are effective, engaging, and forward-thinking.',
    },
    {
      icon: 'bi-globe',
      title: 'Accessibility',
      description:
        'We believe quality education should be accessible to all, regardless of location, language, or background. We design our platform to be inclusive and supportive.',
    },
    {
      icon: 'bi-stars',
      title: 'Excellence',
      description:
        'We strive for excellence in everything we do, from course content and platform reliability to student support and instructor development.',
    },
    {
      icon: 'bi-people',
      title: 'Community',
      description:
        'We foster a supportive, collaborative learning community where students and instructors can connect, share knowledge, and grow together.',
    },
    {
      icon: 'bi-shield-check',
      title: 'Integrity',
      description:
        'We operate with transparency, honesty, and ethical standards that build trust with our students, instructors, and partners.',
    },
    {
      icon: 'bi-arrow-repeat',
      title: 'Continuous Learning',
      description:
        'We practice what we teach by continuously learning, adapting, and improving our platform and approaches based on feedback and research.',
    },
  ];

  // Company milestones for timeline
  milestones: MilestoneItem[] = [
    {
      year: '2015',
      title: 'Foundation',
      description:
        'RosettaCloud was founded in Cairo with a mission to transform education across the MENA region through accessible, high-quality learning experiences.',
      icon: 'bi-flag-fill',
    },
    {
      year: '2017',
      title: 'First 10,000 Students',
      description:
        'Reached our first major milestone of 10,000 enrolled students and expanded our course offerings to cover technical and professional skills.',
      icon: 'bi-people-fill',
    },
    {
      year: '2018',
      title: 'Mobile App Launch',
      description:
        'Launched our mobile application to enable learning on-the-go, making education more accessible to students with limited computer access.',
      icon: 'bi-phone-fill',
    },
    {
      year: '2020',
      title: 'Regional Expansion',
      description:
        'Expanded operations across the Middle East and North Africa, offering localized content and support in multiple languages.',
      icon: 'bi-geo-alt-fill',
    },
    {
      year: '2022',
      title: 'Enterprise Solutions',
      description:
        'Introduced enterprise learning solutions for organizations looking to upskill their workforce with customized training programs.',
      icon: 'bi-building-fill',
    },
    {
      year: this.currentYear.toString(),
      title: 'AI-Enhanced Learning',
      description:
        'Integrated AI-powered learning tools to provide personalized learning paths and adaptive content for every student.',
      icon: 'bi-robot',
    },
  ];

  // Leadership team
  leadershipTeam: TeamMember[] = [
    {
      id: 'fatima-ibrahim',
      name: 'Fatima Ibrahim',
      role: 'Founder & CEO',
      bio: 'Fatima founded RosettaCloud with a vision to democratize education across the MENA region. With a background in EdTech and previous experience at leading technology companies, she has led the company through consistent growth and innovation.',
      imageUrl: 'assets/team/fatima-ibrahim.jpg',
      socialLinks: {
        twitter: 'https://twitter.com/fatima_ibrahim',
        linkedin: 'https://linkedin.com/in/fatimaibrahim',
      },
    },
    {
      id: 'omar-hassan',
      name: 'Omar Hassan',
      role: 'Chief Technology Officer',
      bio: 'Omar leads our technology strategy and engineering teams. His expertise in scalable architecture and AI has been instrumental in building our platform to serve millions of learners while maintaining a personalized experience.',
      imageUrl: 'assets/team/omar-hassan.jpg',
      socialLinks: {
        linkedin: 'https://linkedin.com/in/omarhassan',
        github: 'https://github.com/omarhassan',
      },
    },
    {
      id: 'nadia-el-said',
      name: 'Dr. Nadia El-Said',
      role: 'Chief Academic Officer',
      bio: 'With a PhD in Education and extensive experience in curriculum development, Dr. El-Said ensures our academic content meets the highest standards of quality and effectiveness, while being culturally relevant to our diverse student base.',
      imageUrl: 'assets/team/nadia-elsaid.jpg',
      socialLinks: {
        twitter: 'https://twitter.com/dr_nadia_elsaid',
        linkedin: 'https://linkedin.com/in/dr-nadia-elsaid',
      },
    },
  ];

  constructor() {}

  ngOnInit(): void {
    this.addScrollAnimations();
  }

  // Handle image loading errors with placeholder
  handleImageError(event: Event, member: TeamMember): void {
    const target = event.target as HTMLImageElement;
    const initials = this.getInitials(member.name);

    // Hide the img element
    target.style.display = 'none';

    // Create an avatar element
    const parent = target.parentElement;
    if (parent) {
      const avatar = document.createElement('div');
      avatar.className = 'team-avatar';
      avatar.textContent = initials;

      // Generate a color based on the member name for consistency
      const hue = this.getHashCode(member.name) % 360;
      avatar.style.background = `linear-gradient(135deg, hsl(${hue}, 70%, 35%), hsl(${hue}, 80%, 25%))`;

      parent.appendChild(avatar);
    }
  }

  // Generate initials for avatar fallback
  getInitials(name: string): string {
    if (!name) return '';
    const parts = name.split(' ');
    return (
      parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')
    ).toUpperCase();
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
