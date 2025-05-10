import { Routes } from '@angular/router';
import { MainComponent } from './main/main.component';
import { FeaturesComponent } from './features/features.component';
import { InstructorsComponent } from './instructors/instructors.component';
import { PricingComponent } from './pricing/pricing.component';
import { LabComponent } from './lab/lab.component';
import { LoginComponent } from './login/login.component';
import { AuthGuard } from './guards/auth.guard';
import { DashboardComponent } from './dashboard/dashboard.component';
import { UserProfileComponent } from './user-profile/user-profile.component';
import { UnauthorizedComponent } from './unauthorized/unauthorized.component';
import { AccountVerificationComponent } from './account-verification/account-verification.component';
import { ForgotPasswordComponent } from './forgot-password/forgot-password.component';
import { ProfileWizardComponent } from './profile-wizard/profile-wizard.component';
import { UserSettingsComponent } from './user-settings/user-settings.component';

export const routes: Routes = [
  // Public routes
  { path: '', component: MainComponent },
  { path: 'features', component: FeaturesComponent },
  { path: 'pricing', component: PricingComponent },
  { path: 'instructors', component: InstructorsComponent },
  { path: 'login', component: LoginComponent },
  {
    path: 'register',
    component: LoginComponent,
    data: { register: true },
  },
  { path: 'verify-account', component: AccountVerificationComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },
  { path: 'unauthorized', component: UnauthorizedComponent },

  // Protected routes (require login)
  {
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [AuthGuard],
  },
  {
    path: 'profile',
    component: UserProfileComponent,
    canActivate: [AuthGuard],
    data: {
      title: 'User Profile',
      description: 'Manage your profile and account settings.',
    },
  },
  {
    path: 'settings',
    component: UserSettingsComponent,
    canActivate: [AuthGuard],
    data: {
      title: 'User Settings',
      description: 'Manage your account settings and preferences.',
    },
  },
  {
    path: 'profile-wizard',
    component: ProfileWizardComponent,
    canActivate: [AuthGuard],
  },
  {
    path: 'lab/module/:moduleUuid/lesson/:lessonUuid',
    component: LabComponent,
    canActivate: [AuthGuard],
  },

  // Fallback route
  { path: '**', redirectTo: '', pathMatch: 'full' },
];
