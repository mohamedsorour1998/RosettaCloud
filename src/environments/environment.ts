export const environment = {
  production: true,
  apiUrl: 'http://51.112.10.4:30085',
  feedbackApiUrl:
    'https://your-api-gateway-id.execute-api.region.amazonaws.com/prod',

  feedbackWebSocketUrl:
    'wss://your-websocket-api-id.execute-api.region.amazonaws.com/prod',
  labDefaultTimeout: {
    hours: 1,
    minutes: 30,
    seconds: 0,
  },
  pollingInterval: 30000, // 30 seconds for production to reduce API calls
};
