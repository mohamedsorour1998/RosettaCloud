export interface TimeRemaining {
  hours: number;
  minutes: number;
  seconds: number;
}

export interface LabInfo {
  lab_id: string;
  pod_ip: string | null;
  time_remaining: TimeRemaining | null;
  status: string;
}

export interface LabCreationResponse {
  lab_id: string;
}

export interface Question {
  id: number;
  question: string;
  description?: string;
  hints?: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
  type?: 'quiz' | 'coding' | 'terminal';
  completed: boolean;
}

export interface QuestionsResponse {
  questions: Question[];
  total_count: number;
}

export interface QuestionSetupResponse {
  status: 'success' | 'error';
  message: string;
  completed: boolean;
}

export interface QuestionCheckResponse {
  status: 'success' | 'error';
  message: string;
  completed: boolean;
  feedback?: string;
  next_question?: number;
}

export interface ErrorResponse {
  error: string;
  detail?: string;
}

export enum LabStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  ERROR = 'error',
  TERMINATED = 'terminated',
  EXPIRED = 'expired',
}
