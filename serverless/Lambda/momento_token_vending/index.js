const {
  AuthClient,
  CredentialProvider,
  GenerateDisposableTokenResponse,
  TokenScopes,
  AllTopics,
  ExpiresIn,
} = require("@gomomento/sdk");

let _momentoAuthClient = undefined;

exports.handler = async (event) => {
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

    // Validate required parameters
    if (!userId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "OPTIONS,GET",
        },
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
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,GET",
        "Cache-Control": "no-store",
      },
      body: token.authToken,
    };
  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,GET",
      },
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

  // Generate token
  const response = await _momentoAuthClient.generateDisposableToken(
    tokenScope,
    ExpiresIn.minutes(Math.min(Math.max(1, expiryMinutes), 60)),
    { tokenId: userId }
  );

  // Process response
  if (response.type === GenerateDisposableTokenResponse.Success) {
    return {
      authToken: response.authToken,
      expiresAt: response.expiresAt.epoch(),
    };
  } else {
    throw new Error(`Failed to generate token: ${response.message()}`);
  }
}
