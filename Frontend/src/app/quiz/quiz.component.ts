import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface Question {
  q: string;
  options: string[];
  correct: number;
  explanation: string;
}

@Component({
  selector: 'app-quiz',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './quiz.component.html',
  styleUrls: ['./quiz.component.scss'],
})
export class QuizComponent {
  questions: Question[] = [
    {
      q: 'What command creates a Kubernetes deployment from a YAML file?',
      options: ['kubectl create deploy', 'kubectl apply -f deploy.yaml', 'kubectl run --file', 'kubectl start deploy'],
      correct: 1,
      explanation: '`kubectl apply -f` is the declarative approach. It creates or updates resources defined in YAML — the production-standard way.',
    },
    {
      q: 'Which Docker flag runs a container in the background (detached mode)?',
      options: ['-f', '-d', '-b', '-r'],
      correct: 1,
      explanation: '`-d` stands for detached mode. The container runs as a background process and returns the container ID.',
    },
    {
      q: 'A Kubernetes Service of type ClusterIP is accessible from:',
      options: ['The internet', 'Only within the cluster', 'Other clusters via peering', 'Only the same node'],
      correct: 1,
      explanation: 'ClusterIP is internal-only. Use NodePort or LoadBalancer to expose services externally.',
    },
    {
      q: 'What does a Dockerfile ENTRYPOINT define?',
      options: ['The base image', 'Environment variables', 'The executable that always runs when the container starts', 'Which port to expose'],
      correct: 2,
      explanation: 'ENTRYPOINT defines the main process. CMD provides default arguments. Together they form the container\'s startup command.',
    },
    {
      q: 'Which tool does RosettaCloud use to auto-provision spot K8s nodes?',
      options: ['Cluster Autoscaler', 'Karpenter', 'HPA', 'VPA'],
      correct: 1,
      explanation: 'RosettaCloud uses Karpenter with a custom NodePool (t3.xlarge, spot). It scales to zero overnight and provisions new nodes in seconds.',
    },
  ];

  current = 0;
  selected: number | null = null;
  score = 0;
  finished = false;

  select(idx: number): void {
    if (this.selected !== null) return;
    this.selected = idx;
    if (idx === this.questions[this.current].correct) this.score++;
  }

  next(): void {
    if (this.current < this.questions.length - 1) {
      this.current++;
      this.selected = null;
    } else {
      this.finished = true;
    }
  }

  restart(): void {
    this.current = 0;
    this.selected = null;
    this.score = 0;
    this.finished = false;
  }

  get shareText(): string {
    return `I scored ${this.score}/5 on the RosettaCloud K8s quiz! Test your Kubernetes knowledge: dev.rosettacloud.app/quiz 🚀 #Kubernetes #DevOps #CloudEngineering`;
  }

  copyShare(): void {
    navigator.clipboard.writeText(this.shareText);
  }
}
