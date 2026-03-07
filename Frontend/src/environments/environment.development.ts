export const environment = {
  production: false,
  apiUrl: 'https://api.dev.rosettacloud.app',
  feedbackApiUrl: 'https://feedback.dev.rosettacloud.app',
  chatbotApiUrl: 'https://api.dev.rosettacloud.app/chat',
  labDefaultTimeout: {
    hours: 1,
    minutes: 0,
    seconds: 0,
  },
  pollingInterval: 10000,
  // Same pool as production — swap for a dev pool if you create one later
  cognito: {
    userPoolId: 'us-east-1_jPds5WJ0I',
    userPoolClientId: 'i5ilqkdrsl714trat6qkt0al0',
    region: 'us-east-1',
  },
};
