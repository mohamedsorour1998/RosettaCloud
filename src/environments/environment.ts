export const environment = {
  production: true,
  apiUrl: '/api', // This should be replaced with your actual production API URL
  labDefaultTimeout: {
    hours: 1,
    minutes: 30,
    seconds: 0
  },
  pollingInterval: 30000, // 30 seconds for production to reduce API calls
};
