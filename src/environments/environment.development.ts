export const environment = {
  production: false,
  apiUrl: 'https://api.dev.rosettacloud.app',
  feedbackApiUrl: 'https://feedback.dev.rosettacloud.app',
  chatbotApiUrl: 'wss://wss.dev.rosettacloud.app',
  momento: {
    cacheName: 'interactive-labs',
    feedbackTopic: 'FeedbackGiven',
  },
  labDefaultTimeout: {
    hours: 1,
    minutes: 0,
    seconds: 0,
  },
  pollingInterval: 10000,
};
