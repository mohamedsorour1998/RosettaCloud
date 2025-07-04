import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { lastValueFrom } from 'rxjs';
import {
  TopicClient,
  TopicSubscribeResponse,
  CredentialProvider,
  Configurations,
  MomentoErrorCode,
} from '@gomomento/sdk-web';

@Injectable({
  providedIn: 'root',
})
export class MomentoService {
  private apiUrl = environment.feedbackApiUrl;
  private cacheName = 'interactive-labs';
  private topicName = 'FeedbackGiven';
  private topicClient: TopicClient | null = null;
  private tokenExpiry = 60;
  private subscription: TopicSubscribeResponse['Subscription'] | null = null;

  constructor(private http: HttpClient, private zone: NgZone) {}
  async getToken(userId: string): Promise<string> {
    const url =
      `${this.apiUrl}/auth/momento/token` +
      `?user_id=${encodeURIComponent(userId)}` +
      `&expiry_minutes=${this.tokenExpiry}` +
      `&scope=subscribe`;
    try {

      return await lastValueFrom(this.http.get(url, { responseType: 'text' }));
    } catch (err) {
      
      console.error('Error getting Momento token:', err);
      throw err;
    }
  }
  initializeClient(token: string): TopicClient {
    this.topicClient = new TopicClient({
      configuration: Configurations.Browser.v1(),
      credentialProvider: CredentialProvider.fromString({ apiKey: token }),
    });
    return this.topicClient;
  }

  /**
   * Subscribe to feedback events for a given feedbackId.
   * onItem will be called whenever a matching item arrives.
   */
  async subscribe(
    feedbackId: string,
    onItem: (data: any) => void,
    onError: (err: any) => void
  ): Promise<boolean> {
    if (!this.topicClient) {
      throw new Error('Momento client not initialized');
    }

    const resp = await this.topicClient.subscribe(
      this.cacheName,
      this.topicName,
      {
        onItem: (item: { valueString(): string }) => {
          try {
            const data = JSON.parse(item.valueString());
            if (data.feedback_id === feedbackId) {
              this.zone.run(() => onItem(data));
            }
          } catch (e) {
            console.error('Error parsing Momento message', e);
          }
        },
        onError: (err: { errorCode(): string }) => {
          console.error('Momento subscription error:', err);
          this.zone.run(() => {
            if (err.errorCode() === MomentoErrorCode.AUTHENTICATION_ERROR) {
              onError({ type: 'token_expired' });
            } else {
              onError(err);
            }
          });
        },
      }
    );

    if (resp.type === TopicSubscribeResponse.Subscription) {
      this.subscription = resp as TopicSubscribeResponse['Subscription'];
      return true;
    } else {
      console.error('Failed to subscribe:', (resp as any).message());
      return false;
    }
  }
  unsubscribe(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
  generateFeedbackId(): string {
    return 'fb-' + Math.random().toString(36).slice(2, 10);
  }
}
