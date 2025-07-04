import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { UserService, User } from '../services/user.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './user-profile.component.html',
  styleUrls: ['./user-profile.component.scss'],
})
export class UserProfileComponent implements OnInit {
  user: User | null = null;
  isLoading = true;
  isEditMode = false;
  isUpdating = false;
  submitted = false;
  errorMessage = '';
  successMessage = '';

  // User data
  userProgress: Record<string, any> = {};
  userLabs: string[] = [];
  userModules: string[] = [];
  completedLessons = 0;

  // Form
  profileForm: FormGroup;

  // Make Object available to template
  protected readonly Object = Object;

  constructor(
    private userService: UserService,
    private formBuilder: FormBuilder
  ) {
    this.profileForm = this.formBuilder.group(
      {
        name: ['', Validators.required],
        email: ['', [Validators.required, Validators.email]],
        country: [''],
        currentPassword: [''],
        newPassword: ['', [Validators.minLength(6)]],
        confirmPassword: [''],
      },
      {
        validators: UserProfileComponent.passwordMatchValidator,
      }
    );
  }

  ngOnInit(): void {
    this.loadUserProfile();
  }

  // Password match validator
  static passwordMatchValidator(formGroup: FormGroup) {
    const newPassword = formGroup.get('newPassword')?.value;
    const confirmPassword = formGroup.get('confirmPassword')?.value;

    if (newPassword && newPassword !== confirmPassword) {
      formGroup.get('confirmPassword')?.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }

    return null;
  }

  // Load user profile data
  async loadUserProfile(): Promise<void> {
    try {
      this.isLoading = true;
      this.errorMessage = '';

      const userId = this.userService.getCurrentUserId();

      if (!userId) {
        throw new Error('User not found. Please login again.');
      }

      // Load user data
      this.user = await firstValueFrom(this.userService.getUser(userId));

      if (!this.user) {
        throw new Error('Could not load user profile.');
      }

      // Load progress data
      this.userProgress =
        (await firstValueFrom(this.userService.getUserProgress(userId))) || {};

      // Load labs
      const labsData = await firstValueFrom(
        this.userService.getUserLabs(userId)
      );
      this.userLabs = labsData?.labs || [];

      // Process data
      this.calculateProgressMetrics();

      // Populate form
      this.populateProfileForm();
    } catch (error: any) {
      this.errorMessage = error.message || 'Could not load profile data.';
      console.error('Error loading profile:', error);
    } finally {
      this.isLoading = false;
    }
  }

  // Calculate progress metrics
  calculateProgressMetrics(): void {
    if (!this.userProgress) {
      this.userModules = [];
      this.completedLessons = 0;
      return;
    }

    // Get modules
    this.userModules = Object.keys(this.userProgress);

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

        // Count as completed if any questions are completed
        if (completedQuestions > 0) {
          completedCount++;
        }
      });
    });

    this.completedLessons = completedCount;
  }

  // Populate form with user data
  populateProfileForm(): void {
    if (!this.user) return;

    this.profileForm.patchValue({
      name: this.user.name,
      email: this.user.email,
      country: this.user.metadata?.country || '',
    });
  }

  // Toggle edit mode
  toggleEditMode(): void {
    this.isEditMode = !this.isEditMode;
    this.submitted = false;
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.isEditMode) {
      // Reset form when canceling
      this.populateProfileForm();
      this.profileForm.patchValue({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    }
  }

  // Update profile
  async updateProfile(): Promise<void> {
    this.submitted = true;

    if (this.profileForm.invalid) {
      return;
    }

    try {
      this.isUpdating = true;
      this.errorMessage = '';

      if (!this.user?.user_id) {
        throw new Error('User data not found');
      }

      const formData = this.profileForm.value;
      const updateData: Record<string, any> = {
        name: formData.name,
        email: formData.email,
        metadata: {
          ...(this.user.metadata || {}),
          country: formData.country,
        },
      };

      // Only include password if user is changing it
      if (formData.newPassword && formData.currentPassword) {
        // Check if current password is provided
        if (!formData.currentPassword) {
          this.profileForm
            .get('currentPassword')
            ?.setErrors({ required: true });
          throw new Error('Current password is required to change password');
        }

        // Using bracket notation to avoid TypeScript errors
        updateData['password'] = formData.newPassword;
        updateData['currentPassword'] = formData.currentPassword;
      }

      // Update user data
      const updatedUser = await firstValueFrom(
        this.userService.updateUser(this.user.user_id, updateData)
      );

      if (updatedUser) {
        this.user = updatedUser;
        this.successMessage = 'Profile updated successfully';
        this.isEditMode = false;

        // Clear password fields
        this.profileForm.patchValue({
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
      }
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to update profile';
      console.error('Error updating profile:', error);
    } finally {
      this.isUpdating = false;
    }
  }

  // Confirm account deletion with a better confirmation dialog
  confirmDeleteAccount(): void {
    if (
      confirm(
        'Are you sure you want to delete your account? This action cannot be undone.'
      )
    ) {
      this.deleteAccount();
    }
  }

  // Delete account
  async deleteAccount(): Promise<void> {
    try {
      if (!this.user?.user_id) {
        throw new Error('User data not found');
      }

      this.isUpdating = true;
      this.errorMessage = '';

      await firstValueFrom(this.userService.deleteUser(this.user.user_id));

      // Log out and redirect
      await this.userService.logout();
      window.location.href = '/';
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to delete account';
      console.error('Error deleting account:', error);
      this.isUpdating = false;
    }
  }

  // Get profile initials
  getProfileInitials(): string {
    if (!this.user?.name) return '?';

    const nameParts = this.user.name.trim().split(/\s+/);
    if (nameParts.length === 1) {
      return nameParts[0].charAt(0).toUpperCase();
    }

    return (
      nameParts[0].charAt(0) + nameParts[nameParts.length - 1].charAt(0)
    ).toUpperCase();
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

  // Get lesson progress percentage
  getLessonProgressPercentage(moduleId: string, lessonId: string): number {
    const total = this.getTotalQuestionsCount(moduleId, lessonId);
    if (total === 0) return 0;

    const completed = this.getCompletedQuestionsCount(moduleId, lessonId);
    return Math.round((completed / total) * 100);
  }
}
