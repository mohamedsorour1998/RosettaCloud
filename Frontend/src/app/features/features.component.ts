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
      title: 'Dedicated Kubernetes Cluster',
      description:
        'A fresh Kind cluster + full Docker daemon provisioned per student in under 10 seconds. Run kubectl apply, docker build, and helm install on infrastructure you fully own.',
      icon: 'bi-diagram-3',
    },
    {
      title: 'VS Code in Browser',
      description:
        'Full code-server IDE served at your lab subdomain. Edit files, open terminals, run commands — exactly like your local dev environment, with no local setup.',
      icon: 'bi-code-square',
    },
    {
      title: '3 Specialized AI Agents',
      description:
        'Tutor (hint-first teaching), Grader (exit-code validation), Planner (learning path). Powered by Amazon Nova 2 Lite via AgentCore + MCP Gateway with 6 tools.',
      icon: 'bi-robot',
    },
    {
      title: 'Cross-Session AI Memory',
      description:
        'AgentCore Memory persists your learning history across sessions. The AI remembers what you struggled with last week and adapts explanations accordingly.',
      icon: 'bi-infinity',
    },
    {
      title: 'Exit-Code Grading',
      description:
        'Practical exercises are graded by executing validation scripts inside your live pod. Real verification — not multiple choice. Same as how production CI/CD pipelines work.',
      icon: 'bi-check2-circle',
    },
    {
      title: 'Structured Curriculum',
      description:
        'Linux fundamentals → Docker → Kubernetes → Cloud Engineering. Each lesson builds on the last with MCQ and practical questions validated against real running infrastructure.',
      icon: 'bi-map',
    },
  ];

  keyFeatures: Feature[] = [
    {
      title: 'Hint-First AI Pedagogy',
      description:
        'Our AI tutor engages before you attempt, guiding your reasoning through hints. When you get stuck, it asks questions — not gives answers. You build real intuition, not exam memory.',
      icon: 'bi-lightbulb',
    },
    {
      title: 'Isolated Infrastructure Per Student',
      description:
        'Every lab session provisions a dedicated Kubernetes pod, Service, and Istio VirtualService. No shared environments, no noisy neighbours. Mirrors how production cloud infrastructure actually works.',
      icon: 'bi-shield-lock',
    },
    {
      title: 'Automated Exit-Code Grading',
      description:
        'Practical exercises are validated by running scripts inside your live pod via kubectl exec. Pass or fail is determined by real exit codes — the same way CI/CD pipelines work.',
      icon: 'bi-terminal-fill',
    },
  ];

  testimonials: Testimonial[] = [];

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

}
