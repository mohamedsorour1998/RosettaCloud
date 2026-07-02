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
  // Strangler cutover flag. The SPA tolerates BOTH RFC7807 (Java problem+json)
  // and legacy FastAPI error shapes via core/problem-detail; this documents the
  // Java shape as the expected default during/after the bake. (Plan §8.4)
  apiFlags: { useJavaProblemDetails: true },
  // Fill in after: terraform output -raw cognito_user_pool_id / cognito_user_pool_client_id
  cognito: {
    userPoolId: 'us-east-1_jPds5WJ0I',
    userPoolClientId: 'i5ilqkdrsl714trat6qkt0al0',
    region: 'us-east-1',
  },
};
