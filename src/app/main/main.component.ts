import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface Testimonial {
  quote: string;
  name: string;
  title: string;
  company: string;
}

interface Statistic {
  value: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-main',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.scss'],
})
export class MainComponent implements OnInit {
  testimonials: Testimonial[] = [
    {
      quote:
        'RosettaCloud has completely transformed how I teach programming. My students are more engaged and learn faster than ever before.',
      name: 'Ahmed Hassan',
      title: 'Computer Science Professor',
      company: 'Cairo University',
    },
    {
      quote:
        'The interactive labs made all the difference in my learning journey. I went from beginner to employed developer in just 6 months!',
      name: 'Layla Mahmoud',
      title: 'Frontend Developer',
      company: 'Tech Innovations',
    },
    {
      quote:
        "As an employer in the MENA region, I've found RosettaCloud graduates to be exceptionally well-prepared for real-world challenges.",
      name: 'Omar Farouk',
      title: 'CTO',
      company: 'Digital Solutions LLC',
    },
  ];

  statistics: Statistic[] = [
    { value: '25,000+', label: 'Active Students', icon: 'bi-people-fill' },
    { value: '150+', label: 'Expert Instructors', icon: 'bi-person-workspace' },
    { value: '300+', label: 'Courses & Labs', icon: 'bi-collection-fill' },
    { value: '92%', label: 'Employment Rate', icon: 'bi-briefcase-fill' },
  ];

  ngOnInit(): void {}
}
