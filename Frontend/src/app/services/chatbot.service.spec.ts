import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ChatbotService, ChatMessage } from './chatbot.service';
import { environment } from '../../environments/environment';

describe('ChatbotService', () => {
  let svc: ChatbotService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(ChatbotService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should be created', () => {
    expect(svc).toBeTruthy();
  });

  it('parses the RFC7807 top-level code + payload on the AI-quota 403', () => {
    let last: ChatMessage | undefined;
    svc.messages$.subscribe((m) => (last = m.at(-1)));

    svc.sendMessage('hi');

    http.expectOne(environment.chatbotApiUrl).flush(
      {
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'Weekly AI message quota exhausted.',
        code: 'AI_QUOTA_EXHAUSTED',
        payload: { messages_used: 5, messages_remaining: 0, messages_limit: 5, week_resets_at: 1750000000 },
      },
      { status: 403, statusText: 'Forbidden' }
    );

    expect(last?.role).toBe('error');
    expect(last?.content).toContain('all 5 free AI messages');
  });

  it('still parses the legacy FastAPI nested quota shape (dual-run)', () => {
    let last: ChatMessage | undefined;
    svc.messages$.subscribe((m) => (last = m.at(-1)));

    svc.sendMessage('hi');

    http.expectOne(environment.chatbotApiUrl).flush(
      {
        detail: {
          code: 'AI_QUOTA_EXHAUSTED',
          message: 'no more messages',
          quota: { messages_used: 5, messages_remaining: 0, messages_limit: 5, week_resets_at: 0 },
        },
      },
      { status: 403, statusText: 'Forbidden' }
    );

    expect(last?.role).toBe('error');
    expect(last?.content).toContain('all 5 free AI messages');
  });

  it('surfaces a normalized message for a generic (non-quota) error', () => {
    let last: ChatMessage | undefined;
    svc.messages$.subscribe((m) => (last = m.at(-1)));

    svc.sendMessage('hi');

    http.expectOne(environment.chatbotApiUrl).flush(
      { title: 'Internal Server Error', status: 500, detail: 'boom' },
      { status: 500, statusText: 'Server Error' }
    );

    expect(last?.role).toBe('error');
    expect(last?.content).toBe('Agent error: boom');
  });

  it('adds an assistant message on a successful reply', () => {
    let last: ChatMessage | undefined;
    svc.messages$.subscribe((m) => (last = m.at(-1)));

    svc.sendMessage('hello');

    http.expectOne(environment.chatbotApiUrl).flush({
      response: 'Hi there!',
      agent: 'tutor',
      session_id: 's1',
    });

    expect(last?.role).toBe('assistant');
    expect(last?.content).toBe('Hi there!');
    expect(last?.agent).toBe('tutor');
  });
});
