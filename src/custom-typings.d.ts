// src/custom-typings.d.ts
// Ambient module declaration for @gomomento/sdk-web
declare module '@gomomento/sdk-web' {
  /** The main client constructor and instance type */
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

  /** The union of responses from subscribe() */
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

  /** CredentialProvider factory */
  export const CredentialProvider: {
    fromString(opts: { apiKey: string }): any;
  };

  /** Configuration presets */
  export const Configurations: {
    Browser: {
      v1(): any;
    };
  };

  /** Error code enum */
  export enum MomentoErrorCode {
    AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  }
}
