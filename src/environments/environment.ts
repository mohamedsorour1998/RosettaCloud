export const environment = {
  production: true,
  apiUrl: 'http://51.112.10.4:30085',
  labDefaultTimeout: {
    hours: 1,
    minutes: 30,
    seconds: 0,
  },
  pollingInterval: 30000, // 30 seconds for production to reduce API calls
};
