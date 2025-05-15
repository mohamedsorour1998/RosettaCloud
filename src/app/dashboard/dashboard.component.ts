import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { UserService, User } from '../services/user.service';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { ThemeService } from '../services/theme.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  // User data
  user: User | null = null;
  userProgress: Record<string, any> = {};
  userLabs: string[] = [];
  userModules: string[] = [];
  completedLessons = 0;

  // UI state
  isLoading = true;
  errorMessage = '';
  expandedModules: Record<string, boolean> = {};
  retryCount = 0;

  // Component cleanup
  private destroy$ = new Subject<void>();
  Object: any;

  constructor(
    private userService: UserService,
    private themeService: ThemeService
  ) {}

  ngOnInit(): void {
    this.loadDashboardData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Load all dashboard data
   */
  async loadDashboardData(): Promise<void> {
    try {
      this.isLoading = true;
      this.errorMessage = '';

      const userId = this.userService.getCurrentUserId();

      if (!userId) {
        throw new Error('Session expired. Please login again.');
      }

      // Load all data concurrently for better performance
      const [user, progressData, labsData] = await Promise.all([
        firstValueFrom(this.userService.getUser(userId)),
        firstValueFrom(this.userService.getUserProgress(userId)),
        firstValueFrom(this.userService.getUserLabs(userId)),
      ]);

      // Set user data
      this.user = user ?? null;

      if (!this.user) {
        throw new Error('Could not load user data. Please try again.');
      }

      // Set progress data
      this.userProgress = progressData || {};

      // Set labs data
      this.userLabs = labsData?.labs || [];

      // Process data
      this.processUserData();
      this.retryCount = 0;
    } catch (error: any) {
      console.error('Error loading dashboard:', error);

      // Provide different error message based on retry count
      if (this.retryCount > 2) {
        this.errorMessage =
          'There seems to be a problem connecting to the server. Please try again later.';
      } else {
        this.errorMessage =
          error.message || 'Could not load dashboard data. Please try again.';
      }

      this.retryCount++;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Process user data for dashboard
   */
  processUserData(): void {
    if (!this.userProgress || Object.keys(this.userProgress).length === 0) {
      this.userModules = [];
      this.completedLessons = 0;
      return;
    }

    // Get modules and sort them
    this.userModules = Object.keys(this.userProgress).sort();

    // Initialize module expansion state
    // By default, expand the first module if available
    this.userModules.forEach((moduleId, index) => {
      this.expandedModules[moduleId] =
        index === 0 && this.getModuleLessons(moduleId).length > 0;
    });

    // Count completed lessons
    let completedCount = 0;

    this.userModules.forEach((moduleId) => {
      const moduleLessons = this.getModuleLessons(moduleId);

      moduleLessons.forEach((lessonId) => {
        if (this.isLessonCompleted(moduleId, lessonId)) {
          completedCount++;
        }
      });
    });

    this.completedLessons = completedCount;
  }

  /**
   * Toggle module expansion
   */
  toggleModuleExpand(moduleId: string): void {
    this.expandedModules[moduleId] = !this.expandedModules[moduleId];
  }

  /**
   * Get lessons for a module
   * Returns sorted array of lesson IDs
   */
  getModuleLessons(moduleId: string): string[] {
    if (!this.userProgress || !this.userProgress[moduleId]) {
      return [];
    }

    return Object.keys(this.userProgress[moduleId]).sort();
  }

  /**
   * Get total questions for a lesson
   */
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

  /**
   * Get completed questions for a lesson
   */
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

  /**
   * Check if lesson is completed
   * A lesson is considered completed when all questions are completed
   */
  isLessonCompleted(moduleId: string, lessonId: string): boolean {
    const total = this.getTotalQuestionsCount(moduleId, lessonId);
    if (total === 0) return false;

    const completed = this.getCompletedQuestionsCount(moduleId, lessonId);
    return completed === total;
  }

  /**
   * Calculate module completion percentage
   */
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

  /**
   * Get recommended next module and lesson
   * Returns the next incomplete lesson or the first lesson of the next incomplete module
   */
  getRecommendedNext(): { moduleId: string; lessonId: string } | null {
    if (this.userModules.length === 0) return null;

    // Look for incomplete lessons in modules
    for (const moduleId of this.userModules) {
      const lessons = this.getModuleLessons(moduleId);

      for (const lessonId of lessons) {
        if (!this.isLessonCompleted(moduleId, lessonId)) {
          return { moduleId, lessonId };
        }
      }
    }

    // If all lessons are complete, return the first lesson of the first module
    if (this.userModules.length > 0) {
      const firstModule = this.userModules[0];
      const firstModuleLessons = this.getModuleLessons(firstModule);

      if (firstModuleLessons.length > 0) {
        return {
          moduleId: firstModule,
          lessonId: firstModuleLessons[0],
        };
      }
    }

    return null;
  }

  /**
   * Get the most recent lab
   * Returns the first lab in the list (assumed to be the most recent)
   */
  getMostRecentLab(): string | null {
    return this.userLabs.length > 0 ? this.userLabs[0] : null;
  }

  /**
   * Format date to a readable format
   */
  formatDate(dateString: string): string {
    if (!dateString) return '';

    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
}
