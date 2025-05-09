// For standalone component approach

import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import {
  ChatbotService,
  ChatMessage,
  Source,
} from '../services/chatbot.service';
import { Subscription } from 'rxjs';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-chatbot',
  templateUrl: './chatbot.component.html',
  styleUrls: ['./chatbot.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  providers: [ChatbotService],
})
export class ChatbotComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('chatContainer') chatContainer!: ElementRef;
  @ViewChild('messageInput') messageInput!: ElementRef;
  @Output() toggleChatbot = new EventEmitter<void>();

  messages: ChatMessage[] = [];
  sources: Source[] = [];
  isLoading = false;
  isConnected = false;
  currentMessage = '';
  showSources = false;
  isMinimized = false;

  private subscriptions: Subscription[] = [];

  constructor(
    private chatbotService: ChatbotService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    // Subscribe to messages
    this.subscriptions.push(
      this.chatbotService.messages$.subscribe((messages) => {
        this.messages = messages;
        // Ensure proper scrolling when messages are updated
        this.ensureProperScrolling();
      })
    );

    // Subscribe to sources
    this.subscriptions.push(
      this.chatbotService.sources$.subscribe((sources) => {
        this.sources = sources;
      })
    );

    // Subscribe to loading status
    this.subscriptions.push(
      this.chatbotService.loading$.subscribe((isLoading) => {
        this.isLoading = isLoading;
      })
    );

    // Subscribe to connection status
    this.subscriptions.push(
      this.chatbotService.connected$.subscribe((isConnected) => {
        this.isConnected = isConnected;
      })
    );
  }

  ngAfterViewChecked(): void {
    // Skip the automatic scrolling here to avoid conflicts with controlled scrolling
    // We'll handle scrolling explicitly in message updates and sends
  }

  ngOnDestroy(): void {
    // Unsubscribe to prevent memory leaks
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  sendMessage(): void {
    const message = this.currentMessage.trim();
    if (!message) return;

    this.chatbotService.sendMessage(message);
    this.currentMessage = '';

    // Wait for change detection to complete before scrolling
    setTimeout(() => {
      this.scrollToBottom();

      // Focus back on input field
      if (this.messageInput?.nativeElement) {
        this.messageInput.nativeElement.focus();
      }
    }, 50); // Increased timeout to ensure DOM updates
  }

  // Add a method to ensure proper scrolling when new messages arrive
  ensureProperScrolling(): void {
    // Wait for the changes to be applied to the DOM
    setTimeout(() => this.scrollToBottom(), 50);
  }

  clearChat(): void {
    this.chatbotService.clearChat();
  }

  toggleSources(): void {
    this.showSources = !this.showSources;
  }

  toggleMinimize(): void {
    this.isMinimized = !this.isMinimized;
    this.toggleChatbot.emit();
  }

  // Improved message formatting function
  formatMessage(content: string): SafeHtml {
    try {
      // Basic formatting for code blocks
      let formattedContent = content
        // Format code blocks with triple backticks - ensure they don't expand beyond container
        .replace(
          /```([a-zA-Z]*)([\s\S]*?)```/g,
          '<pre><code class="$1">$2</code></pre>'
        )
        // Format inline code with single backticks
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Convert newlines to line breaks
        .replace(/\n/g, '<br>')
        // Handle paragraphs for readability
        .replace(/<br><br>/g, '</p><p>');

      // Wrap in paragraph if not already wrapped
      if (!formattedContent.startsWith('<p>')) {
        formattedContent = '<p>' + formattedContent + '</p>';
      }

      // Remove any horizontal overflow causing elements
      formattedContent = formattedContent
        // Add class to ensure tables don't cause overflow
        .replace(/<table/g, '<table class="responsive-table"')
        // Add classes to images to ensure they're responsive
        .replace(/<img/g, '<img class="responsive-img"')
        // Ensure links don't overflow
        .replace(/<a /g, '<a class="break-word" ');

      // Sanitize HTML to prevent XSS
      return this.sanitizer.bypassSecurityTrustHtml(formattedContent);
    } catch (error) {
      console.error('Error formatting message:', error);
      return this.sanitizer.bypassSecurityTrustHtml(`<p>${content}</p>`);
    }
  }

  // Improved scrolling function using requestAnimationFrame
  private scrollToBottom(): void {
    try {
      if (this.chatContainer) {
        // Use requestAnimationFrame to ensure the DOM has updated before scrolling
        window.requestAnimationFrame(() => {
          const container = this.chatContainer.nativeElement;
          container.scrollTop = container.scrollHeight;
        });
      }
    } catch (err) {
      console.error('Error scrolling to bottom:', err);
    }
  }

  // Handle Enter key press
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  getSourceDisplayName(source: Source): string {
    // Extract filename from path if available
    return (
      source.filename ||
      (source.path ? source.path.split('/').pop() || '' : 'Unknown file')
    );
  }

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
}
