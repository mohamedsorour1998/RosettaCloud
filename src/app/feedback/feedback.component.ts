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

  // Countdown timer properties - changed to 5 minutes
  readonly COUNTDOWN_DURATION = 5 * 60; // 5 minutes in seconds
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
    // Initialize services for feedback
    this.feedbackService.connectToFeedbackWebSocket();

    // Subscribe to feedback updates
    this.feedbackSubscription =
      this.feedbackService.feedbackReceived$.subscribe((feedback) => {
        this.feedback = feedback;
        this.loading = false;

        // Start countdown timer once feedback is loaded
        this.startCountdownTimer();
      });
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.feedbackSubscription?.unsubscribe();
    this.countdownSubscription?.unsubscribe();

    // Clear any pending timeouts
    if (this.saveSuccessTimeout) {
      clearTimeout(this.saveSuccessTimeout);
    }

    // Disconnect from services
    this.feedbackService.disconnectFromFeedbackWebSocket();
  }

  requestFeedback(): void {
    // No confirmation dialog, just use the existing text explanation
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
          // Store the feedback ID
          this.feedbackId = response.feedback_id;
          console.log(`Feedback requested with ID: ${this.feedbackId}`);
        },
        error: (err) => {
          console.error('Error requesting feedback:', err);
          this.loading = false;
        },
      });
  }

  // Start countdown timer for auto-termination
  startCountdownTimer(): void {
    // Reset the countdown to initial state
    this.remainingSeconds = this.COUNTDOWN_DURATION;
    this.updateCountdownDisplay();

    // Create a timer that fires every second
    this.countdownSubscription = interval(1000).subscribe(() => {
      this.remainingSeconds--;
      this.updateCountdownDisplay();

      // When timer reaches zero, terminate the lab
      if (this.remainingSeconds <= 0) {
        this.notifyTerminateLab();
        this.countdownSubscription?.unsubscribe();
      }
    });
  }

  // Update the display values for minutes and seconds
  updateCountdownDisplay(): void {
    const minutes = Math.floor(this.remainingSeconds / 60);
    const seconds = this.remainingSeconds % 60;

    this.countdownMinutes = minutes.toString();
    this.countdownSeconds = seconds < 10 ? `0${seconds}` : seconds.toString();
  }

  // Format feedback to properly handle Markdown-like syntax
  formatFeedback(text: string): SafeHtml {
    if (!text) return this.sanitizer.bypassSecurityTrustHtml('');

    // Format headings (###)
    let formattedText = text.replace(/###\s+(.*?)(?=\n|$)/g, '<h3>$1</h3>');

    // Format bold (**text**)
    formattedText = formattedText.replace(
      /\*\*(.*?)\*\*/g,
      '<strong>$1</strong>'
    );

    // Handle numbered lists properly
    let hasNumberedList = /\d+\.\s+.*?(?=\n|$)/g.test(text);

    if (hasNumberedList) {
      // Split by newlines to handle each line
      const lines = formattedText.split('\n');

      // Track when we're inside a list
      let inList = false;
      let listItems = [];
      let processedLines = [];

      // Process each line
      for (let line of lines) {
        // Check if it's a list item (starts with number and period)
        if (/^\d+\.\s+/.test(line)) {
          if (!inList) {
            inList = true;
          }
          // Add to current list items
          listItems.push(`<li>${line.replace(/^\d+\.\s+/, '')}</li>`);
        } else {
          // If we're leaving a list, wrap it and add to processed
          if (inList) {
            processedLines.push(`<ol>${listItems.join('')}</ol>`);
            listItems = [];
            inList = false;
          }
          // Add non-list line
          processedLines.push(line);
        }
      }

      // If we end with a list, make sure to close it
      if (inList) {
        processedLines.push(`<ol>${listItems.join('')}</ol>`);
      }

      // Join everything back together
      formattedText = processedLines.join('\n');
    }

    // Wrap sections in div with class
    formattedText = formattedText.replace(
      /<h3>(.*?)<\/h3>/g,
      '</div><div class="feedback-section"><h3>$1</h3>'
    );
    formattedText = '<div class="feedback-section">' + formattedText + '</div>';
    formattedText = formattedText.replace(
      /<div class="feedback-section"><\/div>/g,
      ''
    );

    // Format paragraphs (after other formatting)
    formattedText = formattedText.replace(/\n\n/g, '</p><p>');
    formattedText = formattedText.replace(/([^>])\n([^<])/g, '$1</p><p>$2');

    // Wrap text in paragraphs when not already in a block element
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
      // Format the feedback for better appearance in the downloaded file
      const formattedContent = this.formatFeedbackForDownload(this.feedback);

      // Create a Blob with the formatted feedback content
      const feedbackBlob = new Blob([formattedContent], { type: 'text/plain' });

      // Create a temporary link element
      const downloadLink = document.createElement('a');
      downloadLink.href = URL.createObjectURL(feedbackBlob);
      downloadLink.download = `Feedback-Module${this.moduleUuid}-${
        new Date().toISOString().split('T')[0]
      }.txt`;

      // Append to the document, click to download, and remove
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

      // Show toast notification
      this.showSaveSuccess = true;

      // Hide the toast after 3 seconds
      this.saveSuccessTimeout = setTimeout(() => {
        this.showSaveSuccess = false;
      }, 3000);
    } catch (error) {
      console.error('Error downloading feedback:', error);
    }
  }

  // Format feedback for better appearance in downloaded file
  formatFeedbackForDownload(text: string): string {
    // Add a title
    let result = `==================================================\n`;
    result += `           FEEDBACK FOR MODULE ${this.moduleUuid}           \n`;
    result += `==================================================\n\n`;

    // Process the content line by line
    const lines = text.split('\n');

    // Track section levels for formatting
    let inSection = false;

    for (let line of lines) {
      // Format headings
      if (line.startsWith('###')) {
        // Add extra space before sections except the first one
        if (inSection) {
          result += '\n';
        }
        inSection = true;

        // Replace ### with proper section formatting
        const heading = line.replace(/^###\s+/, '').trim();
        result += `${heading.toUpperCase()}\n`;
        result += `${'='.repeat(heading.length)}\n`;
      }
      // Format lists
      else if (/^\d+\.\s+/.test(line)) {
        // Keep the original numbering
        result += `${line}\n`;
      }
      // Format bold text
      else if (line.includes('**')) {
        // Replace bold markers with ASCII alternatives
        result += `${line.replace(/\*\*(.*?)\*\*/g, '$1')}\n`;
      }
      // Regular text
      else {
        result += `${line}\n`;
      }
    }

    // Add a footer with timestamp
    result += `\n--------------------------------------------------\n`;
    result += `Generated on: ${new Date().toLocaleString()}\n`;
    result += `--------------------------------------------------`;

    return result;
  }

  // Emit event to parent component to terminate lab
  notifyTerminateLab(): void {
    // Clean up countdown timer if manually terminating
    this.countdownSubscription?.unsubscribe();
    this.terminateLabRequest.emit();
  }

  // No closeFeedback method as we don't allow closing the modal
  // The only options are to download or terminate
}
