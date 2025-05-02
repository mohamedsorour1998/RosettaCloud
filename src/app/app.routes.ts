import { Routes } from '@angular/router';
import { MainComponent } from './main/main.component';
import { FeaturesComponent } from './features/features.component';
import { InstructorsComponent } from './instructors/instructors.component';
import { PricingComponent } from './pricing/pricing.component';
import { LabComponent } from './lab/lab.component';
import { LoginComponent } from './login/login.component';
import { AuthGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', component: MainComponent },
  { path: 'features', component: FeaturesComponent },
  { path: 'pricing', component: PricingComponent },
  { path: 'instructors', component: InstructorsComponent },
  { path: 'login', component: LoginComponent },
  {
    path: 'lab/module/:moduleUuid/lesson/:lessonUuid',
    component: LabComponent,
    canActivate: [AuthGuard],
  },
  { path: '**', redirectTo: '', pathMatch: 'full' },
];
