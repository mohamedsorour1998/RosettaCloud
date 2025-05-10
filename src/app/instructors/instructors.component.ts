import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

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
  imports: [CommonModule, RouterModule],
  templateUrl: './instructors.component.html',
  styleUrls: ['./instructors.component.scss'],
})
export class InstructorsComponent {
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
}
