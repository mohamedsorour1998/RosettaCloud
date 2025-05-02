export const environment = {
  production: false,
  apiUrl: 'http://51.112.10.4:30085',
  feedbackApiUrl:
    'https://your-api-gateway-id.execute-api.region.amazonaws.com/prod',
  feedbackWebSocketUrl:
    'wss://your-websocket-api-id.execute-api.region.amazonaws.com/prod',
  labDefaultTimeout: {
    hours: 2,
    minutes: 0,
    seconds: 0,
  },
  pollingInterval: 10000, // 10 seconds
};
