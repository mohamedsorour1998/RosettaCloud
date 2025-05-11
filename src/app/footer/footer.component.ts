import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss',
})
export class FooterComponent {
  year: number = new Date().getFullYear();

  // Social media links
  socialLinks = [
    {
      icon: 'bi-twitter',
      url: 'https://twitter.com/rosettacloud',
      label: 'Twitter',
    },
    {
      icon: 'bi-linkedin',
      url: 'https://linkedin.com/company/rosettacloud',
      label: 'LinkedIn',
    },
    {
      icon: 'bi-instagram',
      url: 'https://instagram.com/rosettacloud',
      label: 'Instagram',
    },
    {
      icon: 'bi-youtube',
      url: 'https://youtube.com/c/rosettacloud',
      label: 'YouTube',
    },
  ];

  // Footer navigation links
  navigationLinks = [
    { name: 'Home', route: '/' },
    { name: 'Courses', route: '/courses' },
    { name: 'Instructors', route: '/instructors' },
    { name: 'About Us', route: '/about' },
    { name: 'Contact', route: '/contact' },
  ];

  // Legal links
  legalLinks = [
    { name: 'Privacy Policy', route: '/privacy' },
    { name: 'Terms of Service', route: '/terms' },
    { name: 'Accessibility', route: '/accessibility' },
  ];
}
