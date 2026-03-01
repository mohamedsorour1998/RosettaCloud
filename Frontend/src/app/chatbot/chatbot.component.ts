import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import {
  ChatbotService,
  ChatMessage,
  Source,
  AgentType,
} from '../services/chatbot.service';
import { Subscription } from 'rxjs';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-chatbot',
  templateUrl: './chatbot.component.html',
  styleUrls: ['./chatbot.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
})
export class ChatbotComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('chatContainer') chatContainer!: ElementRef;
  @ViewChild('messageInput') messageInput!: ElementRef;

  messages: ChatMessage[] = [];
  sources: Source[] = [];
  isLoading = false;
  isConnected = false;
  currentMessage = '';
  showSources = false;
  showClearConfirmation = false;

  get hasUserSentMessage(): boolean {
    return this.messages.some(m => m.role === 'user' || m.role === 'assistant');
  }

  public shouldAutoScroll = true;
  private lastScrollHeight = 0;
  private pendingMessages = false;
  copiedMessageId: string | null = null;
  messageRatings: Map<string, 'up' | 'down'> = new Map();

  private subscriptions: Subscription[] = [];

  constructor(
    private chatbotService: ChatbotService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.chatbotService.messages$.subscribe((messages) => {
        this.messages = messages;
        this.pendingMessages = true;

        // Reset copied message notification after message updates
        this.copiedMessageId = null;
      })
    );

    this.subscriptions.push(
      this.chatbotService.sources$.subscribe((sources) => {
        this.sources = sources;
      })
    );

    this.subscriptions.push(
      this.chatbotService.loading$.subscribe((isLoading) => {
        this.isLoading = isLoading;
      })
    );

    this.subscriptions.push(
      this.chatbotService.connected$.subscribe((isConnected) => {
        this.isConnected = isConnected;
      })
    );
  }

  ngAfterViewChecked(): void {
    if (this.pendingMessages) {
      this.scrollToBottom();
      this.pendingMessages = false;
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  /**
   * Confirms clearing the chat with a modal
   */
  confirmClearChat(): void {
    this.showClearConfirmation = true;
  }

  /**
   * Cancels the clear chat operation
   */
  cancelClearChat(): void {
    this.showClearConfirmation = false;
  }

  /**
   * Actually clears the chat after confirmation
   */
  doClearChat(): void {
    this.chatbotService.clearChat();
    this.showClearConfirmation = false;
  }

  /**
   * Sends the current message to the chatbot service
   */
  sendMessage(): void {
    const message = this.currentMessage.trim();
    if (!message) return;
    this.shouldAutoScroll = true;

    this.chatbotService.sendMessage(message);
    this.currentMessage = '';

    // Focus the input and adjust height
    if (this.messageInput?.nativeElement) {
      this.messageInput.nativeElement.focus();
      this.adjustTextareaHeight();
    }
  }

  /**
   * Sends a suggestion as if it was typed by the user
   */
  sendSuggestion(suggestion: string): void {
    // Set the message as the current message
    this.currentMessage = suggestion;

    // Then send it immediately
    this.sendMessage();
  }

  /**
   * Toggles the sources panel visibility
   */
  toggleSources(): void {
    this.showSources = !this.showSources;
  }

  /**
   * Formats raw message content with markdown → HTML.
   * Uses a placeholder technique to protect code blocks, then
   * processes headers, bold/italic, lists, inline code, and line breaks.
   */
  formatMessage(content: string): SafeHtml {
    try {
      // Step 1: Extract and replace code blocks with null-char placeholders
      const codeBlocks: string[] = [];
      let processed = content.replace(
        /```([a-zA-Z]*)([\s\S]*?)```/g,
        (match, lang, code) => {
          const isShell = code.includes('#!/bin/');
          const cls = isShell ? 'shell-script-container' : 'code-container';
          const preCls = isShell ? 'shell-script' : 'code-content';
          const placeholder = `\x00CODE${codeBlocks.length}\x00`;
          codeBlocks.push(
            `<div class="${cls}" data-language="${this.escapeHtml(lang || 'code')}">` +
            `<pre class="${preCls}">${this.escapeHtml(code)}</pre></div>`
          );
          return placeholder;
        }
      );

      // Step 2: Headers (must run before bold/italic; ^ needs real \n chars)
      processed = processed
        .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (?!#)(.+)$/gm, '<h1>$1</h1>');

      // Step 3: Bold and italic (order matters: *** before ** before *)
      processed = processed
        .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

      // Step 4: Lists — split into lines, group consecutive list items into ul/ol
      const lines = processed.split('\n');
      const htmlLines: string[] = [];
      let listState: 'none' | 'ul' | 'ol' = 'none';

      for (const line of lines) {
        const ulMatch = line.match(/^[-*] (.+)/);
        const olMatch = line.match(/^\d+\. (.+)/);
        const neededState = ulMatch ? 'ul' : olMatch ? 'ol' : 'none';

        if (neededState !== 'none') {
          if (listState !== neededState) {
            if (listState !== 'none') htmlLines.push(`</${listState}>`);
            htmlLines.push(`<${neededState}>`);
            listState = neededState;
          }
          htmlLines.push(`<li>${(ulMatch ? ulMatch[1] : olMatch![1])}</li>`);
        } else {
          if (listState !== 'none') {
            htmlLines.push(`</${listState}>`);
            listState = 'none';
          }
          htmlLines.push(line);
        }
      }
      if (listState !== 'none') htmlLines.push(`</${listState}>`);
      processed = htmlLines.join('\n');

      // Step 5: Inline code
      processed = processed.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

      // Step 6: Newlines → <br>, double <br> → paragraph break;
      // strip spurious <br> that appears adjacent to block-level tags
      processed = processed
        .replace(/\n/g, '<br>')
        .replace(/<br><br>/g, '</p><p>')
        .replace(/<\/(h[1-4]|ul|ol|li)><br>/g, '</$1>')
        .replace(/<br><(ul|ol|li)/g, '<$1');

      // Step 7: Wrap in <p> if not already block-level
      if (!processed.match(/^<(h[1-4]|ul|ol|p|div)/)) {
        processed = '<p>' + processed + '</p>';
      }

      // Step 8: Restore code block placeholders
      codeBlocks.forEach((block, i) => {
        processed = processed.replace(`\x00CODE${i}\x00`, block);
      });

      // Step 9: Inject responsive classes on tables/imgs/links
      processed = processed
        .replace(/<table/g, '<table class="responsive-table"')
        .replace(/<img/g, '<img class="responsive-img"')
        .replace(/<a /g, '<a target="_blank" rel="noopener" class="break-word" ');

      return this.sanitizer.bypassSecurityTrustHtml(processed);
    } catch (error) {
      console.error('Error formatting message:', error);
      return this.sanitizer.bypassSecurityTrustHtml(`<p>${this.escapeHtml(content)}</p>`);
    }
  }

  /**
   * Escapes HTML special characters to prevent XSS
   * @param unsafe Raw string with potential HTML
   * @returns Escaped safe string
   */
  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Scrolls the chat container to the bottom
   */
  private scrollToBottom(): void {
    try {
      if (this.chatContainer && this.shouldAutoScroll) {
        const container = this.chatContainer.nativeElement;
        setTimeout(() => {
          container.scrollTop = container.scrollHeight;
          this.lastScrollHeight = container.scrollHeight;
        }, 0);
      }
    } catch (err) {
      console.error('Error scrolling to bottom:', err);
    }
  }

  /**
   * Manually scrolls to the bottom when the button is clicked
   */
  scrollToBottomManually(): void {
    this.shouldAutoScroll = true;
    this.scrollToBottom();
  }

  /**
   * Handles Enter key in the textarea
   * @param event Keyboard event
   */
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  /**
   * Tracks scroll position and determines if auto-scroll should be enabled
   * @param event Scroll event
   */
  onScroll(event: Event): void {
    if (this.chatContainer) {
      const element = this.chatContainer.nativeElement;
      const atBottom =
        Math.abs(
          element.scrollHeight - element.clientHeight - element.scrollTop
        ) < 50;

      this.shouldAutoScroll = atBottom;
      this.lastScrollHeight = element.scrollHeight;
    }
  }

  /**
   * Adjusts the textarea height based on content
   */
  adjustTextareaHeight(): void {
    if (this.messageInput) {
      const textarea = this.messageInput.nativeElement;
      // Reset height to measure scrollHeight correctly
      textarea.style.height = 'auto';

      // Calculate new height (clamped between 42px and 160px)
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 42), 160);
      textarea.style.height = `${newHeight}px`;
    }
  }

  /**
   * Copies a message to the clipboard
   * @param content Message content to copy
   */
  copyMessage(content: string): void {
    // Strip markdown formatting for clipboard
    const plainText = content
      .replace(/```[\s\S]*?```/g, (match) => {
        // Extract code blocks without the backticks
        return match.replace(/```(?:[a-zA-Z]*\n)?|\n```$/g, '');
      })
      .replace(/`([^`]+)`/g, '$1'); // Remove inline code formatting

    navigator.clipboard.writeText(plainText).then(
      () => {
        // Set a temporary "Copied!" notification
        this.copiedMessageId = content.substring(0, 20); // Use part of content as ID
        setTimeout(() => {
          this.copiedMessageId = null;
          this.cdr.detectChanges();
        }, 2000);
      },
      (err) => {
        console.error('Could not copy text: ', err);
      }
    );
  }

  /**
   * Lets the user rate a message as helpful or not
   * @param message The message being rated
   * @param rating Up or down rating
   */
  rateMessage(message: ChatMessage, rating: 'up' | 'down'): void {
    const messageId = message.id || message.content.substring(0, 20);

    // Check if already rated and user is changing their rating
    const existingRating = this.messageRatings.get(messageId);
    if (existingRating === rating) {
      // User clicked the same rating again, remove it
      this.messageRatings.delete(messageId);
    } else {
      // User is setting or changing rating
      this.messageRatings.set(messageId, rating);
    }

    // In a real implementation, you would send this rating to the backend
    // this.chatbotService.rateMessage(messageId, rating);

    // For now, just log it
    console.log(
      `Message rated: ${rating === 'up' ? 'Helpful' : 'Not helpful'}`
    );
  }

  /**
   * Returns whether a message has been rated
   * @param message The message to check
   * @param ratingType Up or down rating
   * @returns Boolean indicating if message has this rating
   */
  hasRating(message: ChatMessage, ratingType: 'up' | 'down'): boolean {
    const messageId = message.id || message.content.substring(0, 20);
    return this.messageRatings.get(messageId) === ratingType;
  }

  /**
   * Formats a source filename for display
   * @param source Source object
   * @returns Formatted display name
   */
  getSourceDisplayName(source: Source): string {
    return (
      source.filename ||
      (source.path ? source.path.split('/').pop() || '' : 'Unknown file')
    );
  }

  /**
   * Returns the appropriate CSS class for a message role
   * @param role Message role (user, assistant, system, etc.)
   * @returns CSS class name
   */
  getRoleClass(role: string): string {
    switch (role) {
      case 'user':
        return 'user-message';
      case 'assistant':
        return 'assistant-message';
      case 'system':
        return 'system-message';
      case 'error':
        return 'error-message';
      default:
        return '';
    }
  }

  getAgentIcon(agent: AgentType): string {
    switch (agent) {
      case 'tutor':
        return 'bi-mortarboard-fill';
      case 'grader':
        return 'bi-check-circle-fill';
      case 'planner':
        return 'bi-map-fill';
      default:
        return 'bi-robot';
    }
  }

  getAgentName(agent: AgentType): string {
    switch (agent) {
      case 'tutor':
        return 'Tutor Agent';
      case 'grader':
        return 'Grader Agent';
      case 'planner':
        return 'Curriculum Planner';
      default:
        return 'Assistant';
    }
  }

  getAgentClass(agent: AgentType): string {
    switch (agent) {
      case 'tutor':
        return 'agent-tutor';
      case 'grader':
        return 'agent-grader';
      case 'planner':
        return 'agent-planner';
      default:
        return '';
    }
  }
}
