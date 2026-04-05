import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { environment } from '../../environments/environment';

interface StatsData {
  labs_launched: number;
  questions_answered: number;
  ai_messages: number;
  total_users_seen: number;
}

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './stats.component.html',
  styleUrls: ['./stats.component.scss'],
})
export class StatsComponent implements OnInit {
  stats: StatsData | null = null;
  loading = true;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http
      .get<StatsData>(`${environment.apiUrl}/public/stats`)
      .pipe(catchError(() => of(null)))
      .subscribe((data) => {
        this.stats = data;
        this.loading = false;
      });
  }
}
