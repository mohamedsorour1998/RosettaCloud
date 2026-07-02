import { Component, ChangeDetectionStrategy } from '@angular/core';

import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-courses',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './courses.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./courses.component.scss'],
})
export class CoursesComponent {}
