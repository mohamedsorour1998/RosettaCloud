import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-university',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './university.component.html',
  styleUrls: ['./university.component.scss'],
})
export class UniversityComponent {
  benefits = [
    { icon: 'bi-diagram-3-fill', title: 'Real Infrastructure Per Student', desc: 'Every student gets a dedicated Kubernetes cluster + Docker + VS Code. No shared sandboxes.' },
    { icon: 'bi-robot', title: 'AI Tutor Included', desc: 'Full access to 3-agent AI tutor (Tutor/Grader/Planner) at every tier. No upsell required.' },
    { icon: 'bi-bar-chart-fill', title: 'Admin Dashboard', desc: 'Track cohort progress, question accuracy, lab time, and AI engagement per student.' },
    { icon: 'bi-people-fill', title: 'Bulk Enrollment', desc: 'Upload a CSV of student emails. Everyone gets access in seconds via Cognito.' },
    { icon: 'bi-journal-code', title: 'Custom Courses', desc: 'Add your own shell-script exercises. They auto-index into the AI knowledge base.' },
    { icon: 'bi-headset', title: 'Priority Support', desc: 'Direct line to engineering. SLA-backed response time for institutions.' },
  ];

  pricing = [
    { seats: '1–49 students', price: '$9/student/month', annual: '$89/student/year' },
    { seats: '50–199 students', price: '$7/student/month', annual: '$69/student/year' },
    { seats: '200+ students', price: 'Custom', annual: 'Contact us' },
  ];
}
