import { Routes } from '@angular/router';
import { MainComponent } from './main/main.component';
import { FeaturesComponent } from './features/features.component';
import { InstructorsComponent } from './instructors/instructors.component';
import { PricingComponent } from './pricing/pricing.component';
import { LabComponent } from './lab/lab.component';

export const routes: Routes = [
  { path: '', component: MainComponent },
  { path: 'features', component: FeaturesComponent },
  { path: 'pricing', component: PricingComponent },
  { path: 'instructors', component: InstructorsComponent },
  {
    path: 'lab/module/:moduleUuid/lesson/:lessonUuid',
    component: LabComponent,
  }, // Correct route with params
  { path: '**', redirectTo: '', pathMatch: 'full' },
];
