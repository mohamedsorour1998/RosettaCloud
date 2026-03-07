import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-chatbot-flow-diagram',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chatbot-flow-diagram.component.html',
  styleUrls: ['./chatbot-flow-diagram.component.scss'],
})
export class ChatbotFlowDiagramComponent {
  activeTab: string = 'platform';
  expandedSection: string | null = null;

  setActiveTab(tab: string): void {
    this.activeTab = tab;
    this.expandedSection = null;
  }

  toggleSection(id: string): void {
    this.expandedSection = this.expandedSection === id ? null : id;
  }
}
