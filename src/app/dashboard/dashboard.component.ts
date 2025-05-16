import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { UserService, User } from '../services/user.service';
import { LabService } from '../services/lab.service';
import { Subject, forkJoin, of, EMPTY } from 'rxjs';
import {
  catchError,
  finalize,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs/operators';
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
  showCleanupConfirmation = false;
  showSuccessNotification = false;

  // Component cleanup
  private destroy$ = new Subject<void>();
Object: any;

  constructor(
    private userService: UserService,
    private themeService: ThemeService,
    private labService: LabService
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
  loadDashboardData(): void {
    this.isLoading = true;
    this.errorMessage = '';

    const userId = this.userService.getCurrentUserId();

    if (!userId) {
      this.errorMessage = 'Session expired. Please login again.';
      this.isLoading = false;
      return;
    }

    forkJoin({
      user: this.userService.getUser(userId).pipe(
        catchError((error) => {
          console.error('Error loading user data:', error);
          return of(null);
        })
      ),
      progressData: this.userService.getUserProgress(userId).pipe(
        catchError((error) => {
          console.error('Error loading progress data:', error);
          return of({});
        })
      ),
      labsData: this.userService.getUserLabs(userId).pipe(
        catchError((error) => {
          console.error('Error loading labs data:', error);
          return of({ labs: [] });
        })
      ),
    })
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe({
        next: ({ user, progressData, labsData }) => {
          this.user = user;

          if (!this.user) {
            this.errorMessage = 'Could not load user data. Please try again.';
            return;
          }

          this.userProgress = progressData || {};

          // Support both array and object response for labsData
          if (Array.isArray(labsData)) {
            this.userLabs = labsData;
          } else if (labsData && Array.isArray(labsData.labs)) {
            this.userLabs = labsData.labs;
          } else {
            this.userLabs = [];
          }

          this.processUserData();
          this.retryCount = 0;
        },
        error: (error) => {
          console.error('Error loading dashboard:', error);

          if (this.retryCount > 2) {
            this.errorMessage =
              'There seems to be a problem connecting to the server. Please try again later.';
          } else {
            this.errorMessage =
              error.message ||
              'Could not load dashboard data. Please try again.';
          }

          this.retryCount++;
        },
      });
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

    this.userModules = Object.keys(this.userProgress).sort();

    this.userModules.forEach((moduleId, index) => {
      this.expandedModules[moduleId] =
        index === 0 && this.getModuleLessons(moduleId).length > 0;
    });

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
   * Shows the confirmation modal before terminating all labs
   */
  terminateAllLabs(): void {
    if (!this.userLabs || this.userLabs.length === 0) {
      return;
    }
    this.showCleanupConfirmation = true;
  }

  /**
   * Cancels the cleanup operation and hides the confirmation modal
   */
  cancelCleanup(): void {
    this.showCleanupConfirmation = false;
  }

  /**
   * Close the success notification
   */
  closeNotification(): void {
    this.showSuccessNotification = false;
  }

  /**
   * Confirms and executes the cleanup of all labs
   */
  confirmCleanup(): void {
    this.showCleanupConfirmation = false;
    this.executeLabCleanup();
  }

  /**
   * Toggle module expansion
   */
  toggleModuleExpand(moduleId: string): void {
    this.expandedModules[moduleId] = !this.expandedModules[moduleId];
  }

  /**
   * Get lessons for a module
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
   * Actually performs termination of all active labs for the current user
   */
  private executeLabCleanup(): void {
    if (!this.userLabs || this.userLabs.length === 0) {
      return;
    }

    this.isLoading = true;

    const userId = this.userService.getCurrentUserId();
    if (!userId) {
      this.errorMessage = 'User ID not found. Please log in again.';
      this.isLoading = false;
      return;
    }

    const terminationRequests$ = this.userLabs.map((labId) => {
      return this.labService.terminateLab(labId, userId).pipe(
        switchMap(() => this.userService.unlinkLabFromUser(userId, labId)),
        catchError((error) => {
          console.error(`Error terminating lab ${labId}:`, error);
          return EMPTY;
        })
      );
    });

    forkJoin(terminationRequests$)
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.clearLabStorageItems();
          this.showSuccessNotification = true;
          setTimeout(() => {
            if (this.showSuccessNotification) {
              this.showSuccessNotification = false;
            }
          }, 5000);
          this.userLabs = [];
        }),
        catchError((error) => {
          console.error('Error terminating labs:', error);
          this.errorMessage = 'Failed to terminate all labs. Please try again.';
          return of(null);
        }),
        finalize(() => {
          this.isLoading = false;
          this.loadDashboardData();
        })
      )
      .subscribe();
  }

  /**
   * Clears all lab-related storage items to ensure a complete cleanup
   */
  private clearLabStorageItems(): void {
    try {
      sessionStorage.removeItem('activeLabId');
      const labQStateKeys = Array.from(
        { length: sessionStorage.length },
        (_, i) => sessionStorage.key(i)
      ).filter((key) => key && key.startsWith('lab-question-state'));
      labQStateKeys.forEach((key) => {
        if (key) sessionStorage.removeItem(key);
      });
      const labLocalKeys = Array.from({ length: localStorage.length }, (_, i) =>
        localStorage.key(i)
      ).filter((key) => key && (key.includes('lab') || key.startsWith('pod_')));
      labLocalKeys.forEach((key) => {
        if (key) localStorage.removeItem(key);
      });
      document.cookie.split(';').forEach((cookie) => {
        const cookieName = cookie.split('=')[0].trim();
        if (cookieName.includes('lab') || cookieName.startsWith('pod_')) {
          document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        }
      });
      console.log('All lab storage items cleared');
    } catch (error) {
      console.error('Error clearing lab storage items:', error);
    }
  }

  /**
   * Get recommended next module and lesson
   */
  getRecommendedNext(): { moduleId: string; lessonId: string } | null {
    if (this.userModules.length === 0) return null;
    for (const moduleId of this.userModules) {
      const lessons = this.getModuleLessons(moduleId);
      for (const lessonId of lessons) {
        if (!this.isLessonCompleted(moduleId, lessonId)) {
          return { moduleId, lessonId };
        }
      }
    }
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
