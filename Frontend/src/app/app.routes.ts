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
import { AboutUsComponent } from './about-us/about-us.component';
import { ContactUsComponent } from './contact-us/contact-us.component';
import { AdminUsersComponent } from './admin-users/admin-users.component';
import { AdminGuard } from './guards/admin.guard';
import { CoursesComponent } from './courses/courses.component';
import { MyCoursesComponent } from './my-courses/my-courses.component';
import { HelpCenterComponent } from './help-center/help-center.component';
import { PrivacyPolicyComponent } from './privacy-policy/privacy-policy.component';
import { AccessibilityComponent } from './accessibility/accessibility.component';
import { TermsOfServiceComponent } from './terms-of-service/terms-of-service.component';
import { TutorialsComponent } from './tutorials/tutorials.component';
import { WebinarsComponent } from './webinars/webinars.component';
import { LearningBlogComponent } from './learning-blog/learning-blog.component';
import { MyTeachingComponent } from './my-teaching/my-teaching.component';
import { ChatbotFlowDiagramComponent } from './chatbot-flow-diagram/chatbot-flow-diagram.component';

export const routes: Routes = [
  // Public routes
  { path: '', component: MainComponent },
  { path: 'features', component: FeaturesComponent },
  { path: 'pricing', component: PricingComponent },
  { path: 'instructors', component: InstructorsComponent },
  { path: 'courses', component: CoursesComponent },
  { path: 'login', component: LoginComponent },
  {
    path: 'register',
    component: LoginComponent,
    data: { register: true },
  },
  { path: 'verify-account', component: AccountVerificationComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },
  { path: 'unauthorized', component: UnauthorizedComponent },
  {
    path: 'about',
    component: AboutUsComponent,
  },
  {
    path: 'faq',
    component: HelpCenterComponent,
  },
  {
    path: 'privacy',
    component: PrivacyPolicyComponent,
  },
  {
    path: 'terms',
    component: TermsOfServiceComponent,
  },
  {
    path: 'accessibility',
    component: AccessibilityComponent,
  },
  {
    path: 'contact',
    component: ContactUsComponent,
  },
  {
    path: 'blog',
    component: LearningBlogComponent,
  },
  {
    path: 'webinars',
    component: WebinarsComponent,
  },
  {
    path: 'tutorials',
    component: TutorialsComponent,
  },

  {
    path: 'docs',
    component: ChatbotFlowDiagramComponent,
  },
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
    path: 'my-courses',
    component: MyCoursesComponent,
    canActivate: [AuthGuard],
    data: {
      title: 'My Courses',
      description: 'View and manage your enrolled courses.',
    },
  },
  {
    path: 'my-teaching',
    component: MyTeachingComponent,
    canActivate: [AuthGuard],
    data: {
      title: 'My Teaching',
      description: 'View and manage your taught courses.',
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
  {
    path: 'admin/users',
    component: AdminUsersComponent,
    canActivate: [AuthGuard, AdminGuard],
  },

  // Fallback route
  { path: '**', redirectTo: '', pathMatch: 'full' },
];
