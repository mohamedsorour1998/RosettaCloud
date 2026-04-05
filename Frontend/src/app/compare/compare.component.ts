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
      subheadline: 'KodeKloud hands you a shared sandbox. We provision a dedicated cluster.',
      rows: [
        { dimension: 'Environment', competitor: 'Pre-existing shared K8s sandbox', rosetta: 'Fresh dedicated cluster per student, per session', winner: 'us' },
        { dimension: 'AI Tutor', competitor: '$46/mo AI plan — validates steps after', rosetta: 'Included free — hints BEFORE you attempt', winner: 'us' },
        { dimension: 'Docker', competitor: 'Shared playground only', rosetta: 'Full Docker daemon, your own per lab', winner: 'us' },
        { dimension: 'IDE', competitor: 'Browser terminal only', rosetta: 'Full VS Code in browser', winner: 'us' },
        { dimension: 'Content breadth', competitor: '1,280 labs, 180+ courses', rosetta: 'Focused curriculum, growing weekly', winner: 'them' },
        { dimension: 'Free tier', competitor: 'Courses only, no lab access', rosetta: '2h/week real lab + AI tutor', winner: 'us' },
        { dimension: 'Price with AI', competitor: '$46/month', rosetta: '$19/month (AI always included)', winner: 'us' },
      ],
      verdict: 'KodeKloud is the best existing DevOps platform. But even KodeKloud gives students shared, pre-existing environments. RosettaCloud provisions a fresh, dedicated Kind cluster + full Docker daemon + VS Code IDE per student, per session — real infrastructure isolation that mirrors how production environments actually work.',
    },
    'skill-builder': {
      slug: 'skill-builder',
      competitorName: 'AWS Skill Builder',
      headline: 'RosettaCloud vs AWS Skill Builder',
      subheadline: 'Skill Builder teaches you to pass the exam. RosettaCloud teaches you to do the job.',
      rows: [
        { dimension: 'Purpose', competitor: 'AWS certification exam prep', rosetta: 'Employable SWE, DevOps, and cloud skills', winner: 'us' },
        { dimension: 'Hands-on', competitor: 'Guided AWS console walkthroughs', rosetta: 'Real kubectl, docker run in your own cluster', winner: 'us' },
        { dimension: 'AI pedagogy', competitor: 'Answers your questions', rosetta: 'Hint-first: guides your thinking', winner: 'us' },
        { dimension: 'Docker/K8s', competitor: 'No real Docker daemon or K8s cluster', rosetta: 'Full Docker daemon + Kind cluster per session', winner: 'us' },
        { dimension: 'Price', competitor: '$29/month', rosetta: '$0 free / $19 pro', winner: 'us' },
        { dimension: 'Skills portability', competitor: 'AWS-specific console navigation', rosetta: 'Portable: works on AWS, GCP, Azure, on-prem', winner: 'us' },
        { dimension: 'Brand recognition', competitor: 'Official AWS platform', rosetta: 'Independent, AIdeas Top-50 finalist', winner: 'them' },
      ],
      verdict: 'AWS Skill Builder is excellent for passing certification exams. But passing a cert does not equal being able to do the job. Employers test CLI proficiency, not console button knowledge. RosettaCloud teaches the hands-on skills that show up in technical interviews.',
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
