import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface Feature {
  title: string;
  description: string;
  icon: string;
}

@Component({
  selector: 'app-features',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './features.component.html',
  styleUrls: ['./features.component.scss'],
})
export class FeaturesComponent {
  features: Feature[] = [
    {
      title: 'Your Own Cloud Lab, Ready in 10 Seconds',
      description:
        'Click Start Lab and you get a real, fully isolated cloud environment — Kubernetes, Docker, and VS Code — all in your browser. No installs, no configuration. Just open and start.',
      icon: 'bi-diagram-3',
    },
    {
      title: 'Code Right in Your Browser',
      description:
        'A full VS Code editor opens automatically in your lab. Open a terminal, write files, run commands — exactly like working on a real machine, without installing anything on yours.',
      icon: 'bi-code-square',
    },
    {
      title: 'An AI Tutor That Helps You Think',
      description:
        'Stuck on a task? Ask the AI. It won\'t just give you the answer — it asks the right questions to help you figure it out. That\'s how you build skills that stick.',
      icon: 'bi-robot',
    },
    {
      title: 'The AI Remembers Where You Left Off',
      description:
        'Every session picks up where the last one ended. The AI knows what topics you\'ve covered and what you struggled with — so it can help you more effectively each time.',
      icon: 'bi-infinity',
    },
    {
      title: 'Know Instantly If Your Work Is Correct',
      description:
        'When you complete a task, click Check — the platform runs your work and tells you immediately if it passed. No waiting, no guessing. Real feedback on real commands.',
      icon: 'bi-check2-circle',
    },
    {
      title: 'A Clear Path From Zero to Job-Ready',
      description:
        'Start with Linux basics, move to Docker, then Kubernetes. Each lesson builds on the last, so by the end you\'ll have the hands-on skills employers actually look for.',
      icon: 'bi-map',
    },
  ];

  keyFeatures: Feature[] = [
    {
      title: 'Learn By Doing, Not Watching',
      description:
        'Most platforms teach by showing you videos. RosettaCloud puts you in the environment — typing real commands, seeing real results. You learn faster and remember more.',
      icon: 'bi-lightbulb',
    },
    {
      title: 'Your Environment, Nobody Else\'s',
      description:
        'Your lab is completely separate from every other student\'s. You can\'t break anyone else\'s work, and nobody can interfere with yours. Practice freely without limits.',
      icon: 'bi-shield-lock',
    },
    {
      title: 'Real Feedback on Real Work',
      description:
        'When you complete a task, the platform actually runs your commands and checks the result. You\'ll know immediately if it worked — the same way a real job would tell you.',
      icon: 'bi-terminal-fill',
    },
  ];
}
