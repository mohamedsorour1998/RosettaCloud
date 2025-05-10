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
  userProgress: any = {};
  userLabs: string[] = [];
  userModules: string[] = [];
  completedLessons = 0;

  // Form
  profileForm: FormGroup;
  Object: any;

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
        validators: this.passwordMatchValidator,
      }
    );
  }

  ngOnInit(): void {
    this.loadUserProfile();
  }

  // Password match validator
  passwordMatchValidator(formGroup: FormGroup) {
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
      this.user = (await this.userService.getUser(userId).toPromise()) || null;

      if (!this.user) {
        throw new Error('Could not load user profile.');
      }

      // Load progress data
      this.userProgress = await this.userService
        .getUserProgress(userId)
        .toPromise();

      // Load labs
      const labsData = await this.userService.getUserLabs(userId).toPromise();
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
    if (!this.userProgress) return;

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
      this.profileForm.get('currentPassword')?.setValue('');
      this.profileForm.get('newPassword')?.setValue('');
      this.profileForm.get('confirmPassword')?.setValue('');
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

      if (!this.user) {
        throw new Error('User data not found');
      }

      const formData = this.profileForm.value;
      const updateData: any = {
        name: formData.name,
        email: formData.email,
        metadata: {
          ...(this.user.metadata || {}),
          country: formData.country,
        },
      };

      // Only include password if user is changing it
      if (formData.newPassword && formData.currentPassword) {
        updateData.password = formData.newPassword;
      }

      // Update user data
      const updatedUser = await this.userService
        .updateUser(this.user.user_id, updateData)
        .toPromise();

      if (updatedUser) {
        this.user = updatedUser;
        this.successMessage = 'Profile updated successfully';
        this.isEditMode = false;

        // Clear password fields
        this.profileForm.get('currentPassword')?.setValue('');
        this.profileForm.get('newPassword')?.setValue('');
        this.profileForm.get('confirmPassword')?.setValue('');
      }
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to update profile';
      console.error('Error updating profile:', error);
    } finally {
      this.isUpdating = false;
    }
  }

  // Confirm account deletion
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
      if (!this.user) {
        throw new Error('User data not found');
      }

      this.isUpdating = true;

      await this.userService.deleteUser(this.user.user_id).toPromise();

      // Redirect to home page
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

    const nameParts = this.user.name.split(' ');
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
