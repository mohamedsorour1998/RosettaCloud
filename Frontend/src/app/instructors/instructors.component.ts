import { Component, ChangeDetectionStrategy } from '@angular/core';

import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-instructors',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './instructors.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./instructors.component.scss'],
})
export class InstructorsComponent {}
