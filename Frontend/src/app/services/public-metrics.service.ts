import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface PublicStats {
  labs_launched: number;
  questions_answered: number;
  ai_messages: number;
  active_users: number;
}

@Injectable({ providedIn: 'root' })
export class PublicMetricsService {
  private readonly url = `${environment.apiUrl}/public/stats`;

  constructor(private http: HttpClient) {}

  getStats(): Observable<PublicStats | null> {
    return this.http
      .get<PublicStats>(this.url)
      .pipe(catchError(() => of(null)));
  }
}
