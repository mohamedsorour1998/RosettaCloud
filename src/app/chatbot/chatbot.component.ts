// For standalone component approach

import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewChecked,
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

  messages: ChatMessage[] = [];
  sources: Source[] = [];
  isLoading = false;
  isConnected = false;
  currentMessage = '';
  showSources = false;

  // Track scroll position
  private shouldAutoScroll = true;
  private lastScrollHeight = 0;
  private pendingMessages = false;

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
        this.pendingMessages = true;
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
    // Check if we need to scroll after view update
    if (this.pendingMessages) {
      this.scrollToBottom();
      this.pendingMessages = false;
    }
  }

  ngOnDestroy(): void {
    // Unsubscribe to prevent memory leaks
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  sendMessage(): void {
    const message = this.currentMessage.trim();
    if (!message) return;

    // Always auto-scroll when user sends a message
    this.shouldAutoScroll = true;

    this.chatbotService.sendMessage(message);
    this.currentMessage = '';

    // Focus back on input field
    if (this.messageInput?.nativeElement) {
      this.messageInput.nativeElement.focus();
    }
  }

  clearChat(): void {
    this.chatbotService.clearChat();
  }

  toggleSources(): void {
    this.showSources = !this.showSources;
  }

  // Specialized format message function for handling shell scripts
  formatMessage(content: string): SafeHtml {
    try {
      // First look for shell script blocks with shebang
      let formattedContent = content
        // Special handling for code blocks with shebang (#!)
        .replace(
          /```([a-zA-Z]*)([\s\S]*?)(#!\/bin\/[a-z]*[\s\S]*?)```/g,
          (match, language, beforeShebang, fromShebangOn) => {
            // Create a container div with special styling
            return `<div class="shell-script-container"><pre class="shell-script">${this.escapeHtml(
              beforeShebang + fromShebangOn
            )}</pre></div>`;
          }
        )
        // Handle regular code blocks
        .replace(/```([a-zA-Z]*)([\s\S]*?)```/g, (match, language, code) => {
          // Only apply if the previous regex didn't match
          if (!match.includes('#!/bin/')) {
            return `<div class="code-container"><pre class="code-content">${this.escapeHtml(
              code
            )}</pre></div>`;
          }
          return match; // Should be caught by first regex
        })
        // Handle inline code
        .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
        // Convert newlines to breaks
        .replace(/\n/g, '<br>')
        // Paragraph handling
        .replace(/<br><br>/g, '</p><p>');

      // Wrap in paragraph if not already
      if (!formattedContent.startsWith('<p>')) {
        formattedContent = '<p>' + formattedContent + '</p>';
      }

      // Additional replacements for responsive elements
      formattedContent = formattedContent
        .replace(/<table/g, '<table class="responsive-table"')
        .replace(/<img/g, '<img class="responsive-img"')
        .replace(/<a /g, '<a class="break-word" ');

      return this.sanitizer.bypassSecurityTrustHtml(formattedContent);
    } catch (error) {
      console.error('Error formatting message:', error);
      return this.sanitizer.bypassSecurityTrustHtml(`<p>${content}</p>`);
    }
  }

  // Helper to escape HTML special characters
  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Scrolling function - reliable for Angular
  private scrollToBottom(): void {
    try {
      if (this.chatContainer && this.shouldAutoScroll) {
        const container = this.chatContainer.nativeElement;

        // Use setTimeout to ensure this happens after layout calculations
        setTimeout(() => {
          container.scrollTop = container.scrollHeight;

          // Record last scroll height
          this.lastScrollHeight = container.scrollHeight;
        }, 0);
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

  // Track when user manually scrolls
  onScroll(event: Event): void {
    if (this.chatContainer) {
      const element = this.chatContainer.nativeElement;

      // Check if scrolled near bottom (within 30px)
      const atBottom =
        Math.abs(
          element.scrollHeight - element.clientHeight - element.scrollTop
        ) < 30;

      this.shouldAutoScroll = atBottom;

      // Track last known scroll height
      this.lastScrollHeight = element.scrollHeight;
    }
  }

  getSourceDisplayName(source: Source): string {
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
