import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { UserService, User } from '../services/user.service';

interface WizardStep {
  label: string;
}

@Component({
  selector: 'app-profile-wizard',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './profile-wizard.component.html',
  styleUrls: ['./profile-wizard.component.scss'],
})
export class ProfileWizardComponent implements OnInit {
  user: User | null = null;
  currentStep = 0;
  isLoading = true;
  isSaving = false;
  errorMessage = '';

  // Define steps
  steps: WizardStep[] = [
    { label: 'Personal Info' },
    { label: 'Professional Info' },
    { label: 'Learning Goals' },
    { label: 'Privacy' },
  ];

  // Form groups for each step
  personalInfoForm: FormGroup;
  professionalInfoForm: FormGroup;
  learningGoalsForm: FormGroup;
  privacyForm: FormGroup;

  constructor(
    private formBuilder: FormBuilder,
    private userService: UserService,
    private router: Router
  ) {
    // Initialize forms
    this.personalInfoForm = this.formBuilder.group({
      fullName: ['', Validators.required],
      displayName: ['', Validators.required],
      bio: [''],
      country: ['', Validators.required],
      language: ['en'],
    });

    this.professionalInfoForm = this.formBuilder.group({
      profession: [''],
      company: [''],
      education: [''],
      webDevelopment: [false],
      mobileDevelopment: [false],
      dataScience: [false],
      aiMl: [false],
      cloud: [false],
      cybersecurity: [false],
    });

    this.learningGoalsForm = this.formBuilder.group({
      experience: ['beginner'],
      goals: [''],
      prefersVideo: [true],
      prefersReading: [false],
      prefersPractical: [true],
      prefersPeerLearning: [false],
      timeCommitment: ['5_to_10'],
    });

    this.privacyForm = this.formBuilder.group({
      profileVisibility: ['students'],
      emailCourseUpdates: [true],
      emailReminders: [true],
      emailMarketing: [false],
      agreeTerms: [false, Validators.requiredTrue],
    });
  }

  ngOnInit(): void {
    this.loadUserData();
  }

  // Load user data if available
  async loadUserData(): Promise<void> {
    try {
      this.isLoading = true;

      const userId = this.userService.getCurrentUserId();

      if (!userId) {
        this.router.navigate(['/login']);
        return;
      }

      const fetchedUser = await this.userService.getUser(userId).toPromise();
      this.user = fetchedUser ?? null;

      if (this.user) {
        // Check if profile is already completed
        if (this.user.metadata?.profileCompleted) {
          this.router.navigate(['/dashboard']);
          return;
        }

        // Pre-fill forms with existing data
        this.prefillForms();
      }
    } catch (error: any) {
      this.errorMessage = error.message || 'Could not load user data';
    } finally {
      this.isLoading = false;
    }
  }

  // Pre-fill forms with existing user data
  prefillForms(): void {
    if (!this.user) return;

    // Personal info
    this.personalInfoForm.patchValue({
      fullName: this.user.name || '',
      displayName: this.user.metadata?.displayName || this.user.name || '',
      bio: this.user.metadata?.bio || '',
      country: this.user.metadata?.country || '',
      language: this.user.metadata?.language || 'en',
    });

    // Professional info
    if (this.user.metadata?.professional) {
      this.professionalInfoForm.patchValue({
        profession: this.user.metadata.professional.profession || '',
        company: this.user.metadata.professional.company || '',
        education: this.user.metadata.professional.education || '',
        webDevelopment:
          this.user.metadata.professional.interests?.includes(
            'web_development'
          ) || false,
        mobileDevelopment:
          this.user.metadata.professional.interests?.includes(
            'mobile_development'
          ) || false,
        dataScience:
          this.user.metadata.professional.interests?.includes('data_science') ||
          false,
        aiMl:
          this.user.metadata.professional.interests?.includes('ai_ml') || false,
        cloud:
          this.user.metadata.professional.interests?.includes('cloud') || false,
        cybersecurity:
          this.user.metadata.professional.interests?.includes(
            'cybersecurity'
          ) || false,
      });
    }

    // Learning goals
    if (this.user.metadata?.learning) {
      this.learningGoalsForm.patchValue({
        experience: this.user.metadata.learning.experience || 'beginner',
        goals: this.user.metadata.learning.goals || '',
        prefersVideo:
          this.user.metadata.learning.preferences?.includes('video') || true,
        prefersReading:
          this.user.metadata.learning.preferences?.includes('reading') || false,
        prefersPractical:
          this.user.metadata.learning.preferences?.includes('practical') ||
          true,
        prefersPeerLearning:
          this.user.metadata.learning.preferences?.includes('peer') || false,
        timeCommitment: this.user.metadata.learning.timeCommitment || '5_to_10',
      });
    }

    // Privacy settings
    if (this.user.metadata?.privacy) {
      this.privacyForm.patchValue({
        profileVisibility:
          this.user.metadata.privacy.profileVisibility || 'students',
        emailCourseUpdates:
          this.user.metadata.privacy.emailCourseUpdates ?? true,
        emailReminders: this.user.metadata.privacy.emailReminders ?? true,
        emailMarketing: this.user.metadata.privacy.emailMarketing ?? false,
      });
    }
  }

  // Move to next step
  nextStep(): void {
    if (this.currentStep < this.steps.length) {
      this.currentStep++;
      window.scrollTo(0, 0);
    }
  }

  // Move to previous step
  prevStep(): void {
    if (this.currentStep > 0) {
      this.currentStep--;
      window.scrollTo(0, 0);
    }
  }

  // Complete wizard and save all data
  async completeWizard(): Promise<void> {
    if (!this.user) return;

    this.isSaving = true;

    try {
      // Compile all form data
      const personalData = this.personalInfoForm.value;
      const professionalData = this.professionalInfoForm.value;
      const learningData = this.learningGoalsForm.value;
      const privacyData = this.privacyForm.value;

      // Process interests
      const interests: string[] = [];
      if (professionalData.webDevelopment) interests.push('web_development');
      if (professionalData.mobileDevelopment)
        interests.push('mobile_development');
      if (professionalData.dataScience) interests.push('data_science');
      if (professionalData.aiMl) interests.push('ai_ml');
      if (professionalData.cloud) interests.push('cloud');
      if (professionalData.cybersecurity) interests.push('cybersecurity');

      // Process learning preferences
      const preferences: string[] = [];
      if (learningData.prefersVideo) preferences.push('video');
      if (learningData.prefersReading) preferences.push('reading');
      if (learningData.prefersPractical) preferences.push('practical');
      if (learningData.prefersPeerLearning) preferences.push('peer');

      // Prepare metadata
      const metadata = {
        ...this.user.metadata,
        displayName: personalData.displayName,
        bio: personalData.bio,
        country: personalData.country,
        language: personalData.language,
        professional: {
          profession: professionalData.profession,
          company: professionalData.company,
          education: professionalData.education,
          interests: interests,
        },
        learning: {
          experience: learningData.experience,
          goals: learningData.goals,
          preferences: preferences,
          timeCommitment: learningData.timeCommitment,
        },
        privacy: {
          profileVisibility: privacyData.profileVisibility,
          emailCourseUpdates: privacyData.emailCourseUpdates,
          emailReminders: privacyData.emailReminders,
          emailMarketing: privacyData.emailMarketing,
        },
        profileCompleted: true,
        profileCompletedAt: Math.floor(Date.now() / 1000),
      };

      // Update user data
      const updateData = {
        name: personalData.fullName,
        metadata: metadata,
      };

      await this.userService
        .updateUser(this.user.user_id, updateData)
        .toPromise();

      // Move to completion step
      this.nextStep();
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to save profile data';
    } finally {
      this.isSaving = false;
    }
  }

  // Check if a particular step is valid
  isStepValid(step: number): boolean {
    switch (step) {
      case 0:
        return this.personalInfoForm.valid;
      case 1:
        return true; // Professional info is optional
      case 2:
        return true; // Learning goals are optional
      case 3:
        return this.privacyForm.valid;
      default:
        return false;
    }
  }
}
