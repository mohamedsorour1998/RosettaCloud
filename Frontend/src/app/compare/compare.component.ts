import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';

interface CompareRow {
  dimension: string;
  competitor: string;
  rosetta: string;
  winner: 'us' | 'them' | 'tie';
}

interface Comparison {
  slug: string;
  competitorName: string;
  headline: string;
  subheadline: string;
  rows: CompareRow[];
  verdict: string;
}

@Component({
  selector: 'app-compare',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './compare.component.html',
  styleUrls: ['./compare.component.scss'],
})
export class CompareComponent implements OnInit {
  comparisons: Record<string, Comparison> = {
    kodekloud: {
      slug: 'kodekloud',
      competitorName: 'KodeKloud',
      headline: 'RosettaCloud vs KodeKloud',
      subheadline: 'KodeKloud hands you a shared sandbox. We provision a dedicated cluster — from scratch, every session.',
      rows: [
        { dimension: 'Environment type', competitor: 'Pre-existing shared K8s sandbox you log into', rosetta: 'Fresh dedicated cluster provisioned from scratch per session', winner: 'us' },
        { dimension: 'Docker daemon', competitor: 'Shared playground — you don\'t own the daemon', rosetta: 'Full Docker daemon — docker build, docker run, on your own cluster', winner: 'us' },
        { dimension: 'VS Code', competitor: 'Browser terminal only', rosetta: 'Full VS Code (code-server) with integrated AI chat', winner: 'us' },
        { dimension: 'AI pedagogy', competitor: '$46/mo AI plan — validates your step after you complete it', rosetta: 'Hint-first — guides thinking BEFORE you attempt; always included', winner: 'us' },
        { dimension: 'Cross-session AI memory', competitor: 'None', rosetta: 'AgentCore Memory — tutor remembers your history across sessions', winner: 'us' },
        { dimension: 'Free tier', competitor: 'Courses only, no lab access on free plan', rosetta: '2h/week real lab time + AI tutor included', winner: 'us' },
        { dimension: 'Price with full AI', competitor: '$46/month (AI plan)', rosetta: '$19/month (AI always included)', winner: 'us' },
        { dimension: 'Content breadth', competitor: '1,280 labs, 180+ courses', rosetta: 'Focused curriculum growing weekly', winner: 'them' },
        { dimension: 'Community & reputation', competitor: 'Established, 1M+ learners', rosetta: 'Early stage — AIdeas Top 50, growing', winner: 'them' },
      ],
      verdict: 'KodeKloud is the gold standard for existing DevOps learning. But even KodeKloud gives students shared, pre-existing environments. RosettaCloud provisions a fresh, dedicated Kind cluster + full Docker daemon + VS Code per student, per session. And while KodeKloud\'s AI validates your step after you complete it, RosettaCloud\'s hint-first tutor guides your thinking before you attempt — the difference between training for an exam and developing real instincts.',
    },
    'skill-builder': {
      slug: 'skill-builder',
      competitorName: 'AWS Skill Builder',
      headline: 'RosettaCloud vs AWS Skill Builder',
      subheadline: 'Skill Builder teaches you to pass the exam. RosettaCloud teaches you to do the job.',
      rows: [
        { dimension: 'Primary goal', competitor: 'AWS certification exam preparation', rosetta: 'Employable SWE, DevOps, and cloud engineering skills', winner: 'us' },
        { dimension: 'Hands-on format', competitor: 'Step-by-step AWS console walkthroughs', rosetta: 'Real kubectl, docker run in your own dedicated cluster', winner: 'us' },
        { dimension: 'Docker daemon', competitor: 'No real Docker daemon available', rosetta: 'Full daemon — docker build, docker run, Dockerfile authoring', winner: 'us' },
        { dimension: 'AI pedagogy', competitor: 'Learning Assistant answers questions (exam-prep style)', rosetta: 'Hint-first, 3 agents (Tutor/Grader/Planner) — guides discovery', winner: 'us' },
        { dimension: 'Skills portability', competitor: 'AWS-specific console navigation', rosetta: 'Portable: kubectl, docker, helm work on AWS, GCP, Azure, on-prem', winner: 'us' },
        { dimension: 'Price', competitor: '$29/month', rosetta: '$0 free / $19 pro', winner: 'us' },
        { dimension: 'Free tier', competitor: 'Limited labs (Cloud Foundations only)', rosetta: '2h/week real lab + full course access', winner: 'us' },
        { dimension: 'Brand recognition', competitor: 'Official AWS platform', rosetta: 'Independent, AIdeas Top-50 finalist', winner: 'them' },
        { dimension: 'Certification prep', competitor: 'Purpose-built for AWS certs', rosetta: 'Not a cert-prep platform', winner: 'them' },
      ],
      verdict: 'AWS Skill Builder is excellent for passing AWS certification exams. But passing a cert does not equal being able to do the job. Employers in technical interviews test CLI proficiency — kubectl apply, docker build, helm install — not which menu item you clicked in the AWS console. RosettaCloud builds the muscle memory that shows up in day-one performance on the job.',
    },
    coursera: {
      slug: 'coursera',
      competitorName: 'Coursera',
      headline: 'RosettaCloud vs Coursera',
      subheadline: 'Coursera teaches you about Docker. RosettaCloud puts you inside a Docker container.',
      rows: [
        { dimension: 'Learning format', competitor: 'Video lectures + multiple choice quizzes', rosetta: 'Hands-on labs with real commands and automated grading', winner: 'us' },
        { dimension: 'Docker/K8s practice', competitor: 'Video demos, Qwiklabs (external platform)', rosetta: 'Real Docker daemon + Kind cluster per student', winner: 'us' },
        { dimension: 'Completion rate', competitor: '5–15% (MOOC industry average)', rosetta: 'Lab-based active learning drives significantly higher completion', winner: 'us' },
        { dimension: 'AI tutor', competitor: 'QA chatbot over course content', rosetta: 'Hint-first, 3 specialized agents with cross-session memory', winner: 'us' },
        { dimension: 'Grading', competitor: 'Multiple choice, peer review', rosetta: 'Automated exit-code verification — real pass/fail', winner: 'us' },
        { dimension: 'Price', competitor: '$8–24/month (sale price)', rosetta: '$0 free / $19 pro', winner: 'us' },
        { dimension: 'Course breadth', competitor: '10,000+ courses across all domains', rosetta: 'Focused: SWE, DevOps, cloud engineering', winner: 'them' },
        { dimension: 'Brand recognition', competitor: '197M registered learners', rosetta: 'Early stage — AIdeas Top-50 finalist', winner: 'them' },
      ],
      verdict: 'Coursera democratises access to content. But 10,000 courses is also 10,000 ways to procrastinate. And a Coursera certificate means you watched the videos — not that you can run kubectl. RosettaCloud has a focused curriculum where every question requires you to type the right command and the system verifies it automatically. Passive beats active every time in knowledge retention. Active beats passive every time.',
    },
  };

  current: Comparison | null = null;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug') ?? '';
      this.current = this.comparisons[slug] ?? null;
    });
  }
}
