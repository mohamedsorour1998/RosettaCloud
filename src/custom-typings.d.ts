declare module '@gomomento/sdk-web' {
  export const TopicClient: {
    new (config: any): TopicClient;
  };
  export type TopicClient = {
    subscribe(
      cacheName: string,
      topicName: string,
      handlers: {
        onItem: (item: { valueString(): string }) => void;
        onError: (err: { errorCode(): string }) => void;
      }
    ): Promise<TopicSubscribeResponse>;
  };
  export type TopicSubscribeResponse = SubscriptionResponse | ErrorResponse;
  export namespace TopicSubscribeResponse {
    export type Subscription = {
      type: 'Subscription';
      unsubscribe(): void;
      message(): string;
    };
    export const Subscription: { new (): Subscription };

    export type ErrorResponse = {
      type: 'Error';
      message(): string;
    };
    export const Error: { new (): ErrorResponse };
  }
  export const CredentialProvider: {
    fromString(opts: { apiKey: string }): any;
  };
  export const Configurations: {
    Browser: {
      v1(): any;
    };
  };
  export enum MomentoErrorCode {
    AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  }
}
