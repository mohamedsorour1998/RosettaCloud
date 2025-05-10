import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FeedbackService } from '../services/feedback.service';
import { UserService } from '../services/user.service';
import { Subscription, interval } from 'rxjs';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-feedback',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feedback.component.html',
  styleUrls: ['./feedback.component.scss'],
})
export class FeedbackComponent implements OnInit, OnDestroy {
  @Input() moduleUuid!: string;
  @Input() lessonUuid!: string;
  @Input() questions!: any[];
  @Input() userProgress: any = {};
  @Output() terminateLabRequest = new EventEmitter<void>();

  feedback: string | null = null;
  feedbackRequested = false;
  loading = false;
  feedbackId: string | null = null;
  showSaveSuccess = false;
  readonly COUNTDOWN_DURATION = 5 * 60;
  remainingSeconds = this.COUNTDOWN_DURATION;
  countdownMinutes: string = '5';
  countdownSeconds: string = '00';
  private countdownSubscription?: Subscription;

  private feedbackSubscription?: Subscription;
  private saveSuccessTimeout?: any;

  constructor(
    private feedbackService: FeedbackService,
    private userService: UserService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.feedbackService.connectToFeedbackWebSocket();
    this.feedbackSubscription =
      this.feedbackService.feedbackReceived$.subscribe((feedback) => {
        this.feedback = feedback;
        this.loading = false;
        this.startCountdownTimer();
      });
  }

  ngOnDestroy(): void {
    this.feedbackSubscription?.unsubscribe();
    this.countdownSubscription?.unsubscribe();
    if (this.saveSuccessTimeout) {
      clearTimeout(this.saveSuccessTimeout);
    }
    this.feedbackService.disconnectFromFeedbackWebSocket();
  }

  requestFeedback(): void {
    this.loading = true;
    this.feedbackRequested = true;

    const userId = this.userService.getCurrentUserId() || 'guest';

    this.feedbackService
      .requestFeedback(
        userId,
        this.moduleUuid,
        this.lessonUuid,
        this.questions,
        this.userProgress
      )
      .subscribe({
        next: (response) => {
          this.feedbackId = response.feedback_id;
          console.log(`Feedback requested with ID: ${this.feedbackId}`);
        },
        error: (err) => {
          console.error('Error requesting feedback:', err);
          this.loading = false;
        },
      });
  }
  startCountdownTimer(): void {
    this.remainingSeconds = this.COUNTDOWN_DURATION;
    this.updateCountdownDisplay();
    this.countdownSubscription = interval(1000).subscribe(() => {
      this.remainingSeconds--;
      this.updateCountdownDisplay();
      if (this.remainingSeconds <= 0) {
        this.notifyTerminateLab();
        this.countdownSubscription?.unsubscribe();
      }
    });
  }
  updateCountdownDisplay(): void {
    const minutes = Math.floor(this.remainingSeconds / 60);
    const seconds = this.remainingSeconds % 60;

    this.countdownMinutes = minutes.toString();
    this.countdownSeconds = seconds < 10 ? `0${seconds}` : seconds.toString();
  }
  formatFeedback(text: string): SafeHtml {
    if (!text) return this.sanitizer.bypassSecurityTrustHtml('');
    let formattedText = text.replace(/###\s+(.*?)(?=\n|$)/g, '<h3>$1</h3>');
    formattedText = formattedText.replace(
      /\*\*(.*?)\*\*/g,
      '<strong>$1</strong>'
    );
    let hasNumberedList = /\d+\.\s+.*?(?=\n|$)/g.test(text);

    if (hasNumberedList) {
      const lines = formattedText.split('\n');
      let inList = false;
      let listItems = [];
      let processedLines = [];
      for (let line of lines) {
        if (/^\d+\.\s+/.test(line)) {
          if (!inList) {
            inList = true;
          }
          listItems.push(`<li>${line.replace(/^\d+\.\s+/, '')}</li>`);
        } else {
          if (inList) {
            processedLines.push(`<ol>${listItems.join('')}</ol>`);
            listItems = [];
            inList = false;
          }
          processedLines.push(line);
        }
      }
      if (inList) {
        processedLines.push(`<ol>${listItems.join('')}</ol>`);
      }
      formattedText = processedLines.join('\n');
    }
    formattedText = formattedText.replace(
      /<h3>(.*?)<\/h3>/g,
      '</div><div class="feedback-section"><h3>$1</h3>'
    );
    formattedText = '<div class="feedback-section">' + formattedText + '</div>';
    formattedText = formattedText.replace(
      /<div class="feedback-section"><\/div>/g,
      ''
    );
    formattedText = formattedText.replace(/\n\n/g, '</p><p>');
    formattedText = formattedText.replace(/([^>])\n([^<])/g, '$1</p><p>$2');
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = formattedText;
    const textNodes = Array.from(tempDiv.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
    );

    textNodes.forEach((node) => {
      if (node.textContent && node.textContent.trim()) {
        const p = document.createElement('p');
        p.textContent = node.textContent;
        node.parentNode?.replaceChild(p, node);
      }
    });

    formattedText = tempDiv.innerHTML;

    return this.sanitizer.bypassSecurityTrustHtml(formattedText);
  }

  saveFeedback(): void {
    if (!this.feedback) return;

    try {
      const formattedContent = this.formatFeedbackForDownload(this.feedback);
      const feedbackBlob = new Blob([formattedContent], { type: 'text/plain' });
      const downloadLink = document.createElement('a');
      downloadLink.href = URL.createObjectURL(feedbackBlob);
      downloadLink.download = `Feedback-Module${this.moduleUuid}-${
        new Date().toISOString().split('T')[0]
      }.txt`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      this.showSaveSuccess = true;
      this.saveSuccessTimeout = setTimeout(() => {
        this.showSaveSuccess = false;
      }, 3000);
    } catch (error) {
      console.error('Error downloading feedback:', error);
    }
  }
  formatFeedbackForDownload(text: string): string {
    let result = `==================================================\n`;
    result += `           FEEDBACK FOR MODULE ${this.moduleUuid}           \n`;
    result += `==================================================\n\n`;
    const lines = text.split('\n');
    let inSection = false;

    for (let line of lines) {
      if (line.startsWith('###')) {
        if (inSection) {
          result += '\n';
        }
        inSection = true;
        const heading = line.replace(/^###\s+/, '').trim();
        result += `${heading.toUpperCase()}\n`;
        result += `${'='.repeat(heading.length)}\n`;
      } else if (/^\d+\.\s+/.test(line)) {
        result += `${line}\n`;
      } else if (line.includes('**')) {
        result += `${line.replace(/\*\*(.*?)\*\*/g, '$1')}\n`;
      } else {
        result += `${line}\n`;
      }
    }
    result += `\n--------------------------------------------------\n`;
    result += `Generated on: ${new Date().toLocaleString()}\n`;
    result += `--------------------------------------------------`;

    return result;
  }
  notifyTerminateLab(): void {
    this.countdownSubscription?.unsubscribe();
    this.terminateLabRequest.emit();
  }
}
