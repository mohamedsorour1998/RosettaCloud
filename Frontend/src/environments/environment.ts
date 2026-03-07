export const environment = {
  production: true,
  apiUrl: 'https://api.dev.rosettacloud.app',
  feedbackApiUrl: 'https://feedback.dev.rosettacloud.app',
  chatbotApiUrl: 'https://api.dev.rosettacloud.app/chat',
  labDefaultTimeout: {
    hours: 1,
    minutes: 30,
    seconds: 0,
  },
  pollingInterval: 30000,
  // Fill in after: terraform output -raw cognito_user_pool_id / cognito_user_pool_client_id
  cognito: {
    userPoolId: 'us-east-1_REPLACE_ME',
    userPoolClientId: 'REPLACE_ME',
    region: 'us-east-1',
  },
};
