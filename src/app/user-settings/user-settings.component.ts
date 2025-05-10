import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { RouterModule } from '@angular/router';
import { UserService, User } from '../services/user.service';

interface SettingsSection {
  id: string;
  name: string;
  icon: string;
}

@Component({
  selector: 'app-user-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './user-settings.component.html',
  styleUrls: ['./user-settings.component.scss'],
})
export class UserSettingsComponent implements OnInit {
  user: User | null = null;
  isLoading = true;
  isSaving = false;
  submitted = false;
  errorMessage = '';
  successMessage = '';

  // Active section
  activeSection = 'account';

  // Settings sections
  settingsSections: SettingsSection[] = [
    { id: 'account', name: 'Account', icon: 'bi-person' },
    { id: 'notifications', name: 'Notifications', icon: 'bi-bell' },
    { id: 'privacy', name: 'Privacy', icon: 'bi-shield-lock' },
    { id: 'security', name: 'Security', icon: 'bi-key' },
  ];

  // Forms
  accountForm: FormGroup;
  notificationsForm: FormGroup;
  privacyForm: FormGroup;
  securityForm: FormGroup;

  constructor(
    private formBuilder: FormBuilder,
    private userService: UserService
  ) {
    // Initialize forms
    this.accountForm = this.formBuilder.group({
      username: ['', Validators.required],
      language: ['en'],
      timezone: ['UTC'],
    });

    this.notificationsForm = this.formBuilder.group({
      emailCourseUpdates: [true],
      emailAssignments: [true],
      emailFeedback: [true],
      emailMarketing: [false],
      platformMessages: [true],
      platformCourseUpdates: [true],
      platformReminders: [true],
    });

    this.privacyForm = this.formBuilder.group({
      profileVisibility: ['students'],
      shareProgress: [true],
      shareCertificates: [true],
      allowAnalytics: [true],
      allowMarketing: [false],
    });

    this.securityForm = this.formBuilder.group(
      {
        currentPassword: ['', Validators.required],
        newPassword: ['', [Validators.required, Validators.minLength(6)]],
        confirmPassword: ['', Validators.required],
        twoFactorAuth: [false],
      },
      {
        validators: this.passwordMatchValidator,
      }
    );
  }

  ngOnInit(): void {
    this.loadUserSettings();

    // Check for active section in URL
    const hash = window.location.hash.substr(1);
    if (hash && this.settingsSections.some((section) => section.id === hash)) {
      this.activeSection = hash;
    }
  }

  // Password match validator
  passwordMatchValidator(formGroup: FormGroup) {
    const newPassword = formGroup.get('newPassword')?.value;
    const confirmPassword = formGroup.get('confirmPassword')?.value;

    if (newPassword !== confirmPassword) {
      formGroup.get('confirmPassword')?.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }

    return null;
  }

  // Load user settings
  async loadUserSettings(): Promise<void> {
    try {
      this.isLoading = true;
      this.errorMessage = '';

      const userId = this.userService.getCurrentUserId();

      if (!userId) {
        throw new Error('User not found. Please login again.');
      }

      // Load user data
      const fetchedUser = await this.userService.getUser(userId).toPromise();
      this.user = fetchedUser || null;

      if (!this.user) {
        throw new Error('Could not load user data.');
      }

      // Populate forms with user data
      this.populateForms();
    } catch (error: any) {
      this.errorMessage = error.message || 'Could not load settings.';
      console.error('Error loading settings:', error);
    } finally {
      this.isLoading = false;
    }
  }

  // Populate forms with user data
  populateForms(): void {
    if (!this.user || !this.user.metadata) return;

    // Account settings
    this.accountForm.patchValue({
      username: this.user.name || '',
      language: this.user.metadata.language || 'en',
      timezone: this.user.metadata.timezone || 'UTC',
    });

    // Notification settings
    if (this.user.metadata.notifications) {
      this.notificationsForm.patchValue({
        emailCourseUpdates:
          this.user.metadata.notifications.emailCourseUpdates ?? true,
        emailAssignments:
          this.user.metadata.notifications.emailAssignments ?? true,
        emailFeedback: this.user.metadata.notifications.emailFeedback ?? true,
        emailMarketing:
          this.user.metadata.notifications.emailMarketing ?? false,
        platformMessages:
          this.user.metadata.notifications.platformMessages ?? true,
        platformCourseUpdates:
          this.user.metadata.notifications.platformCourseUpdates ?? true,
        platformReminders:
          this.user.metadata.notifications.platformReminders ?? true,
      });
    }

    // Privacy settings
    if (this.user.metadata.privacy) {
      this.privacyForm.patchValue({
        profileVisibility:
          this.user.metadata.privacy.profileVisibility || 'students',
        shareProgress: this.user.metadata.privacy.shareProgress ?? true,
        shareCertificates: this.user.metadata.privacy.shareCertificates ?? true,
        allowAnalytics: this.user.metadata.privacy.allowAnalytics ?? true,
        allowMarketing: this.user.metadata.privacy.allowMarketing ?? false,
      });
    }

    // Security settings
    if (this.user.metadata.security) {
      this.securityForm.patchValue({
        twoFactorAuth: this.user.metadata.security.twoFactorAuth || false,
      });
    }
  }

  // Set active section
  setActiveSection(sectionId: string): void {
    this.activeSection = sectionId;
    window.location.hash = sectionId;
    this.submitted = false;
    this.successMessage = '';
    this.errorMessage = '';
  }

  // Save account settings
  async saveAccountSettings(): Promise<void> {
    this.submitted = true;

    if (this.accountForm.invalid) {
      return;
    }

    await this.saveSettings('account', this.accountForm.value);
  }

  // Save notification settings
  async saveNotificationSettings(): Promise<void> {
    this.submitted = true;

    if (this.notificationsForm.invalid) {
      return;
    }

    await this.saveSettings('notifications', this.notificationsForm.value);
  }

  // Save privacy settings
  async savePrivacySettings(): Promise<void> {
    this.submitted = true;

    if (this.privacyForm.invalid) {
      return;
    }

    await this.saveSettings('privacy', this.privacyForm.value);
  }

  // Save security settings
  async saveSecuritySettings(): Promise<void> {
    this.submitted = true;

    if (this.securityForm.invalid) {
      return;
    }

    // For password change, we need to handle it separately
    if (this.securityForm.get('newPassword')?.value) {
      await this.changePassword();
    } else {
      // Just save the 2FA setting
      await this.saveSettings('security', {
        twoFactorAuth: this.securityForm.get('twoFactorAuth')?.value,
      });
    }
  }

  // Change password
  async changePassword(): Promise<void> {
    if (!this.user) return;

    try {
      this.isSaving = true;

      // In a real app, you would call an API endpoint to change the password
      // This is a simplified example
      const updateData = {
        password: this.securityForm.get('newPassword')?.value,
      };

      await this.userService
        .updateUser(this.user.user_id, updateData)
        .toPromise();

      this.successMessage = 'Password changed successfully.';
      this.securityForm.patchValue({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      this.submitted = false;
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to change password.';
    } finally {
      this.isSaving = false;
    }
  }

  // Generic method to save settings
  async saveSettings(section: string, data: any): Promise<void> {
    if (!this.user) return;

    try {
      this.isSaving = true;
      this.errorMessage = '';

      // Prepare the update data
      const metadata = this.user.metadata || {};
      metadata[section] = { ...metadata[section], ...data };

      // Special case for account section
      if (section === 'account') {
        const updateData = {
          name: data.username,
          metadata: metadata,
        };

        const updatedUser = await this.userService
          .updateUser(this.user.user_id, updateData)
          .toPromise();
        if (updatedUser) {
          this.user = updatedUser;
        }
      } else {
        // For other sections, just update the metadata
        const updateData = {
          metadata: metadata,
        };

        const updatedUser = await this.userService
          .updateUser(this.user.user_id, updateData)
          .toPromise();
        if (updatedUser) {
          this.user = updatedUser;
        }
      }

      this.successMessage = 'Settings saved successfully.';
      this.submitted = false;
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to save settings.';
    } finally {
      this.isSaving = false;
    }
  }
}
