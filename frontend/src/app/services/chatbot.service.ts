import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: Date;
  id?: string;
}

export interface Source {
  filename: string;
  path: string;
  bucket: string;
}

@Injectable({
  providedIn: 'root',
})
export class ChatbotService {
  private apiUrl = environment.chatbotApiUrl;
  private socket: WebSocket | null = null;
  private sessionId: string = '';
  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  private sourcesSubject = new BehaviorSubject<Source[]>([]);
  private loadingSubject = new BehaviorSubject<boolean>(false);
  private connectedSubject = new BehaviorSubject<boolean>(false);
  public messages$ = this.messagesSubject.asObservable();
  public sources$ = this.sourcesSubject.asObservable();
  public loading$ = this.loadingSubject.asObservable();
  public connected$ = this.connectedSubject.asObservable();

  constructor(private http: HttpClient) {
    this.sessionId = 'session-' + Math.random().toString(36).substring(2, 15);
    this.connect();
  }

  private connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      this.socket = new WebSocket(this.apiUrl);

      this.socket.onopen = () => {
        console.log('Connected to RosettaCloud Assistant');
        this.connectedSubject.next(true);
        this.addMessage({
          role: 'system',
          content:
            'Connected to RosettaCloud Assistant. Ask any questions about the lab!',
          timestamp: new Date(),
        });
      };

      this.socket.onmessage = (event) => {
        try {
          const response = JSON.parse(event.data);
          this.handleResponse(response);
        } catch (error) {
          console.error('Error parsing response:', error);
          this.addMessage({
            role: 'error',
            content: 'Error processing server response.',
            timestamp: new Date(),
          });
        }
      };

      this.socket.onclose = () => {
        console.log('Disconnected from RosettaCloud Assistant');
        this.connectedSubject.next(false);
        setTimeout(() => this.connect(), 5000);
      };

      this.socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.connectedSubject.next(false);
      };
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      this.addMessage({
        role: 'error',
        content:
          'Failed to connect to RosettaCloud Assistant. Please try again later.',
        timestamp: new Date(),
      });
    }
  }

  private handleResponse(response: any): void {
    switch (response.type) {
      case 'status':
        console.log('Status update:', response.content);
        break;

      case 'chunk':
        this.updateOrAddAssistantMessage(response.content);
        break;

      case 'source':
        const currentSources = this.sourcesSubject.getValue();
        this.sourcesSubject.next([...currentSources, response.content]);
        break;

      case 'sources':
        this.sourcesSubject.next(response.content);
        break;

      case 'error':
        this.addMessage({
          role: 'error',
          content: response.content,
          timestamp: new Date(),
        });
        this.loadingSubject.next(false);
        break;

      case 'complete':
        console.log('Response complete');
        this.loadingSubject.next(false);
        break;

      case 'heartbeat':
        console.log('Heartbeat received');
        break;

      default:
        console.log('Unknown response type:', response.type);
    }
  }

  private updateOrAddAssistantMessage(content: string): void {
    const currentMessages = this.messagesSubject.getValue();
    const lastMessage = currentMessages[currentMessages.length - 1];

    if (lastMessage && lastMessage.role === 'assistant') {
      const updatedMessages = [...currentMessages];
      updatedMessages[updatedMessages.length - 1] = {
        ...lastMessage,
        content: content,
      };
      this.messagesSubject.next(updatedMessages);
    } else {
      this.addMessage({
        role: 'assistant',
        content: content,
        timestamp: new Date(),
      });
    }
  }

  private addMessage(message: ChatMessage): void {
    const currentMessages = this.messagesSubject.getValue();
    this.messagesSubject.next([...currentMessages, message]);
  }

  public sendMessage(message: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.connect();
      setTimeout(() => this.sendActualMessage(message), 1000);
      return;
    }

    this.sendActualMessage(message);
  }

  private sendActualMessage(message: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.addMessage({
        role: 'error',
        content: 'Not connected to RosettaCloud Assistant. Please try again.',
        timestamp: new Date(),
      });
      return;
    }
    this.addMessage({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });
    this.sourcesSubject.next([]);
    this.loadingSubject.next(true);
    const request = {
      session_id: this.sessionId,
      prompt: message,
      bedrock_model_id: 'amazon.nova-lite-v1:0',
      model_kwargs: {
        temperature: 0.7,
        maxTokenCount: 1024,
        timeoutInMillis: 15000,
      },
      response_style: 'concise',
    };

    try {
      this.socket.send(JSON.stringify(request));
    } catch (error) {
      console.error('Error sending message:', error);
      this.addMessage({
        role: 'error',
        content: 'Failed to send message. Please try again.',
        timestamp: new Date(),
      });
      this.loadingSubject.next(false);
    }
  }

  public clearChat(): void {
    this.messagesSubject.next([
      {
        role: 'system',
        content: 'Chat cleared. Ask any questions about the lab!',
        timestamp: new Date(),
      },
    ]);
    this.sourcesSubject.next([]);
  }
}
