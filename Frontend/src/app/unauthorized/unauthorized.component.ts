import { Component, ChangeDetectionStrategy } from '@angular/core';

import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-unauthorized',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './unauthorized.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./unauthorized.component.scss'],
})
export class UnauthorizedComponent {}
