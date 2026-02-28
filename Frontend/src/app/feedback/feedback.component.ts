import {
  Component,
  Input,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatbotService } from '../services/chatbot.service';
import { UserService } from '../services/user.service';

@Component({
  selector: 'app-feedback',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feedback.component.html',
  styleUrls: ['./feedback.component.scss'],
})
export class FeedbackComponent {
  @Input() moduleUuid!: string;
  @Input() lessonUuid!: string;
  @Input() questions!: any[];
  @Input() userProgress: any = {};
  @Output() terminateLabRequest = new EventEmitter<void>();
  @Output() openChatRequest = new EventEmitter<void>();

  feedbackRequested = false;

  constructor(
    private chatbotService: ChatbotService,
    private userService: UserService
  ) {}

  requestFeedback(): void {
    this.feedbackRequested = true;

    // Send feedback request via the grader agent in chat
    this.chatbotService.sendFeedbackRequest(
      this.moduleUuid,
      this.lessonUuid,
      this.questions,
      this.userProgress
    );

    // Open the chat panel to show the grader response
    this.openChatRequest.emit();
  }
}
