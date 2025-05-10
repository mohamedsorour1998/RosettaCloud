import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { UserService, User } from '../services/user.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  user: User | null = null;
  isLoading = true;
  errorMessage = '';

  // User data
  userProgress: any = {};
  userLabs: string[] = [];
  userModules: string[] = [];
  completedLessons = 0;

  // UI state
  expandedModules: { [key: string]: boolean } = {};
  Object: any;

  constructor(private userService: UserService) {}

  ngOnInit(): void {
    this.loadDashboardData();
  }

  async loadDashboardData(): Promise<void> {
    try {
      this.isLoading = true;
      this.errorMessage = '';

      const userId = this.userService.getCurrentUserId();

      if (!userId) {
        throw new Error('User not found. Please login again.');
      }

      // Load user data
      const user = await this.userService.getUser(userId).toPromise();
      this.user = user ?? null;

      if (!this.user) {
        throw new Error('Could not load user data.');
      }

      // Load progress data
      this.userProgress = await this.userService
        .getUserProgress(userId)
        .toPromise();

      // Load labs
      const labsData = await this.userService.getUserLabs(userId).toPromise();
      this.userLabs = labsData?.labs || [];

      // Process data
      this.processUserData();
    } catch (error: any) {
      this.errorMessage = error.message || 'Could not load dashboard data.';
      console.error('Error loading dashboard:', error);
    } finally {
      this.isLoading = false;
    }
  }

  // Process user data for dashboard
  processUserData(): void {
    if (!this.userProgress) return;

    // Get modules
    this.userModules = Object.keys(this.userProgress);

    // Initialize module expansion state
    this.userModules.forEach((moduleId) => {
      this.expandedModules[moduleId] = false;
    });

    // Count completed lessons
    let completedCount = 0;

    this.userModules.forEach((moduleId) => {
      const moduleLessons = Object.keys(this.userProgress[moduleId]);

      moduleLessons.forEach((lessonId) => {
        const lessonQuestions = this.userProgress[moduleId][lessonId];
        const questionCount = Object.keys(lessonQuestions).length;
        const completedQuestions = Object.values(lessonQuestions).filter(
          (val) => val === true
        ).length;

        // Count as completed if all questions are completed
        if (completedQuestions === questionCount && questionCount > 0) {
          completedCount++;
        }
      });
    });

    this.completedLessons = completedCount;
  }

  // Toggle module expansion
  toggleModuleExpand(moduleId: string): void {
    this.expandedModules[moduleId] = !this.expandedModules[moduleId];
  }

  // Get lessons for a module
  getModuleLessons(moduleId: string): string[] {
    if (!this.userProgress || !this.userProgress[moduleId]) {
      return [];
    }

    return Object.keys(this.userProgress[moduleId]);
  }

  // Get total questions for a lesson
  getTotalQuestionsCount(moduleId: string, lessonId: string): number {
    if (
      !this.userProgress ||
      !this.userProgress[moduleId] ||
      !this.userProgress[moduleId][lessonId]
    ) {
      return 0;
    }

    return Object.keys(this.userProgress[moduleId][lessonId]).length;
  }

  // Get completed questions for a lesson
  getCompletedQuestionsCount(moduleId: string, lessonId: string): number {
    if (
      !this.userProgress ||
      !this.userProgress[moduleId] ||
      !this.userProgress[moduleId][lessonId]
    ) {
      return 0;
    }

    return Object.values(this.userProgress[moduleId][lessonId]).filter(
      (val) => val === true
    ).length;
  }

  // Check if lesson is completed
  isLessonCompleted(moduleId: string, lessonId: string): boolean {
    const total = this.getTotalQuestionsCount(moduleId, lessonId);
    if (total === 0) return false;

    const completed = this.getCompletedQuestionsCount(moduleId, lessonId);
    return completed === total;
  }

  // Calculate module completion percentage
  getModuleCompletionPercentage(moduleId: string): number {
    if (!this.userProgress || !this.userProgress[moduleId]) {
      return 0;
    }

    const lessons = Object.keys(this.userProgress[moduleId]);
    if (lessons.length === 0) return 0;

    let totalQuestions = 0;
    let completedQuestions = 0;

    lessons.forEach((lessonId) => {
      const lessonData = this.userProgress[moduleId][lessonId];
      const questionsInLesson = Object.keys(lessonData).length;

      totalQuestions += questionsInLesson;
      completedQuestions += Object.values(lessonData).filter(
        (val) => val === true
      ).length;
    });

    if (totalQuestions === 0) return 0;
    return Math.round((completedQuestions / totalQuestions) * 100);
  }
}
