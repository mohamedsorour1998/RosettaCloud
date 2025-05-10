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
  private shouldAutoScroll = true;
  private lastScrollHeight = 0;
  private pendingMessages = false;

  private subscriptions: Subscription[] = [];

  constructor(
    private chatbotService: ChatbotService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.chatbotService.messages$.subscribe((messages) => {
        this.messages = messages;
        this.pendingMessages = true;
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

  sendMessage(): void {
    const message = this.currentMessage.trim();
    if (!message) return;
    this.shouldAutoScroll = true;

    this.chatbotService.sendMessage(message);
    this.currentMessage = '';
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
  formatMessage(content: string): SafeHtml {
    try {
      let formattedContent = content
        .replace(
          /```([a-zA-Z]*)([\s\S]*?)(#!\/bin\/[a-z]*[\s\S]*?)```/g,
          (match, language, beforeShebang, fromShebangOn) => {
            return `<div class="shell-script-container"><pre class="shell-script">${this.escapeHtml(
              beforeShebang + fromShebangOn
            )}</pre></div>`;
          }
        )
        .replace(/```([a-zA-Z]*)([\s\S]*?)```/g, (match, language, code) => {
          if (!match.includes('#!/bin/')) {
            return `<div class="code-container"><pre class="code-content">${this.escapeHtml(
              code
            )}</pre></div>`;
          }
          return match; // Should be caught by first regex
        })
        .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
        .replace(/\n/g, '<br>')
        .replace(/<br><br>/g, '</p><p>');
      if (!formattedContent.startsWith('<p>')) {
        formattedContent = '<p>' + formattedContent + '</p>';
      }
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
  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
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
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }
  onScroll(event: Event): void {
    if (this.chatContainer) {
      const element = this.chatContainer.nativeElement;
      const atBottom =
        Math.abs(
          element.scrollHeight - element.clientHeight - element.scrollTop
        ) < 30;

      this.shouldAutoScroll = atBottom;
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
