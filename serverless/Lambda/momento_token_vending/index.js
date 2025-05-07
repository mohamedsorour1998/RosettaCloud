const {
  AuthClient,
  CredentialProvider,
  GenerateDisposableTokenResponse,
  TokenScopes,
  AllTopics,
  ExpiresIn,
} = require("@gomomento/sdk");

let _momentoAuthClient = undefined;

// CORS headers for all responses
const CORS_HEADERS = {
  "Content-Type": "text/plain",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Access-Control-Allow-Headers,Access-Control-Allow-Origin",
  "Access-Control-Allow-Methods": "OPTIONS,GET",
  "Cache-Control": "no-store",
};

// CORS headers for errors
const ERROR_CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Access-Control-Allow-Headers,Access-Control-Allow-Origin",
  "Access-Control-Allow-Methods": "OPTIONS,GET",
};

exports.handler = async (event) => {
  // Handle preflight OPTIONS request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  try {
    // Get API key from environment variable
    const momentoApiKey = process.env.MOMENTO_API_KEY;
    if (!momentoApiKey) {
      throw new Error("Missing required env var 'MOMENTO_API_KEY'");
    }

    // Extract parameters from query string
    const userId = event.queryStringParameters?.user_id;
    const cacheName =
      event.queryStringParameters?.cache_name ||
      process.env.DEFAULT_CACHE ||
      "interactive-labs";
    const expiryMinutes = parseInt(
      event.queryStringParameters?.expiry_minutes || "30",
      10
    );
    const scope = event.queryStringParameters?.scope || "subscribe";

    // Log the request
    console.log(
      `Token request: user=${userId}, cache=${cacheName}, scope=${scope}, expiry=${expiryMinutes}min`
    );

    // Validate required parameters
    if (!userId) {
      return {
        statusCode: 400,
        headers: ERROR_CORS_HEADERS,
        body: JSON.stringify({
          error: "Missing required parameter: user_id",
        }),
      };
    }

    // Generate token
    console.log(
      `Generating token for user ${userId} with cache ${cacheName} and scope ${scope}`
    );
    const token = await generateToken(
      momentoApiKey,
      userId,
      cacheName,
      expiryMinutes,
      scope
    );

    // Return the token as plain text
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: token.authToken,
    };
  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      headers: ERROR_CORS_HEADERS,
      body: JSON.stringify({
        error: "Failed to generate token",
        message: err.message || String(err),
      }),
    };
  }
};

async function generateToken(apiKey, userId, cacheName, expiryMinutes, scope) {
  // Initialize auth client if not already done
  if (!_momentoAuthClient) {
    _momentoAuthClient = new AuthClient({
      credentialProvider: CredentialProvider.fromString({ apiKey }),
    });
  }

  // Determine token scope
  let tokenScope;
  if (scope === "subscribe") {
    tokenScope = TokenScopes.topicSubscribeOnly(cacheName, AllTopics);
  } else if (scope === "publish") {
    tokenScope = TokenScopes.topicPublishOnly(cacheName, AllTopics);
  } else {
    tokenScope = TokenScopes.topicPublishSubscribe(cacheName, AllTopics);
  }

  // Validate expiry (must be between 1 and 60 minutes)
  const validatedExpiryMinutes = Math.min(Math.max(1, expiryMinutes), 60);

  // Generate token
  const response = await _momentoAuthClient.generateDisposableToken(
    tokenScope,
    ExpiresIn.minutes(validatedExpiryMinutes),
    { tokenId: userId }
  );

  // Process response
  if (response.type === GenerateDisposableTokenResponse.Success) {
    console.log(
      `Token generated successfully for user ${userId}, expires in ${validatedExpiryMinutes} minutes`
    );
    return {
      authToken: response.authToken,
      expiresAt: response.expiresAt.epoch(),
    };
  } else {
    throw new Error(`Failed to generate token: ${response.message()}`);
  }
}
