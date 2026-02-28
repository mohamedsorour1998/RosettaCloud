import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, of } from 'rxjs';
import { environment } from '../../environments/environment';

export type AgentType = 'tutor' | 'grader' | 'planner' | null;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: Date;
  id?: string;
  agent?: AgentType;
}

export interface Source {
  filename: string;
  path: string;
  bucket: string;
}

interface ChatApiResponse {
  response: string;
  agent: string;
  session_id: string;
}

@Injectable({
  providedIn: 'root',
})
export class ChatbotService {
  private apiUrl = environment.chatbotApiUrl;
  private sessionId: string;

  private userId = '';
  private moduleUuid = '';
  private lessonUuid = '';

  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  private loadingSubject = new BehaviorSubject<boolean>(false);

  // HTTP is always "connected"; sources are not returned by AgentCore.
  public messages$ = this.messagesSubject.asObservable();
  public loading$ = this.loadingSubject.asObservable();
  public connected$ = of(true);
  public sources$ = of<Source[]>([]);

  constructor(private http: HttpClient) {
    this.sessionId = 'session-' + crypto.randomUUID() + '-' + Date.now();
    this.addMessage({
      role: 'system',
      content: 'Connected to RosettaCloud Assistant. Ask any questions about the lab!',
      timestamp: new Date(),
    });
  }

  public setUserId(userId: string): void {
    this.userId = userId;
  }

  public setLabContext(moduleUuid: string, lessonUuid: string): void {
    this.moduleUuid = moduleUuid;
    this.lessonUuid = lessonUuid;
  }

  public sendMessage(message: string): void {
    this.addMessage({ role: 'user', content: message, timestamp: new Date() });
    this.loadingSubject.next(true);

    this.http
      .post<ChatApiResponse>(this.apiUrl, {
        session_id: this.sessionId,
        message,
        user_id: this.userId,
        module_uuid: this.moduleUuid,
        lesson_uuid: this.lessonUuid,
        type: 'chat',
      })
      .subscribe({
        next: (res) => {
          this.addMessage({
            role: 'assistant',
            content: res.response,
            timestamp: new Date(),
            agent: res.agent as AgentType,
          });
          this.loadingSubject.next(false);
        },
        error: (err) => {
          this.addMessage({
            role: 'error',
            content: `Agent error: ${err.message ?? 'Unknown error'}`,
            timestamp: new Date(),
          });
          this.loadingSubject.next(false);
        },
      });
  }

  public sendGradeMessage(
    moduleUuid: string,
    lessonUuid: string,
    questionNumber: number,
    result: string
  ): void {
    this.loadingSubject.next(true);

    this.http
      .post<ChatApiResponse>(this.apiUrl, {
        session_id: this.sessionId,
        user_id: this.userId,
        type: 'grade',
        message: '',
        module_uuid: moduleUuid,
        lesson_uuid: lessonUuid,
        question_number: questionNumber,
        result,
      })
      .subscribe({
        next: (res) => {
          this.addMessage({
            role: 'assistant',
            content: res.response,
            timestamp: new Date(),
            agent: res.agent as AgentType,
          });
          this.loadingSubject.next(false);
        },
        error: (err) => {
          this.addMessage({
            role: 'error',
            content: `Grade error: ${err.message ?? 'Unknown error'}`,
            timestamp: new Date(),
          });
          this.loadingSubject.next(false);
        },
      });
  }

  public sendFeedbackRequest(
    moduleUuid: string,
    lessonUuid: string,
    questions: any[],
    userProgress: any
  ): void {
    const questionSummary = questions
      .map((q: any) => {
        const qNum = q.question_number || q.id;
        const completed = userProgress?.[qNum?.toString()] === true;
        return `Q${qNum}: ${q.question || q.question_text} — ${completed ? 'Completed' : 'Not completed'}`;
      })
      .join('\n');

    const feedbackPrompt =
      `Please provide comprehensive feedback for this lab session.\n` +
      `Module: ${moduleUuid}\nLesson: ${lessonUuid}\n` +
      `Progress summary:\n${questionSummary}\n\n` +
      `Provide: overall performance assessment, strengths, areas for improvement, and next steps.`;

    this.addMessage({
      role: 'user',
      content: 'Generate my lab feedback report',
      timestamp: new Date(),
    });
    this.loadingSubject.next(true);

    this.http
      .post<ChatApiResponse>(this.apiUrl, {
        session_id: this.sessionId,
        user_id: this.userId,
        type: 'grade',
        message: feedbackPrompt,
        module_uuid: moduleUuid,
        lesson_uuid: lessonUuid,
        question_number: 0,
        result: `Lab feedback request. ${questions.length} total questions.`,
      })
      .subscribe({
        next: (res) => {
          this.addMessage({
            role: 'assistant',
            content: res.response,
            timestamp: new Date(),
            agent: res.agent as AgentType,
          });
          this.loadingSubject.next(false);
        },
        error: (err) => {
          this.addMessage({
            role: 'error',
            content: `Feedback error: ${err.message ?? 'Unknown error'}`,
            timestamp: new Date(),
          });
          this.loadingSubject.next(false);
        },
      });
  }

  public clearChat(): void {
    this.messagesSubject.next([
      {
        role: 'system',
        content: 'Chat cleared. Ask any questions about the lab!',
        timestamp: new Date(),
      },
    ]);
  }

  private addMessage(message: ChatMessage): void {
    const current = this.messagesSubject.getValue();
    this.messagesSubject.next([...current, message]);
  }
}
