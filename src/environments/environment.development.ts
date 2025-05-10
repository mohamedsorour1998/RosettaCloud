export const environment = {
  production: false,
  apiUrl: 'http://51.112.10.4:30085',
  feedbackApiUrl: 'https://api.dev.rosettacloud.app',
  chatbotApiUrl: 'wss://wss.dev.rosettacloud.app',
  momento: {
    cacheName: 'interactive-labs',
    feedbackTopic: 'FeedbackGiven',
  },
  labDefaultTimeout: {
    hours: 2,
    minutes: 0,
    seconds: 0,
  },
  pollingInterval: 10000,
};
