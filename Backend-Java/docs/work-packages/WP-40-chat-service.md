# WP-40 — chat-service

> Sub-agent brief. Self-contained. Read this + `docs/MIGRATION-PLAN.md` §3.5,§6,§7 + WP-10 pattern. No assumptions — web-search & cite if unsure.
> Depends on: WP-00, WP-10 (user-service AI-quota client). Verify: `JAVA_HOME=~/tools/jdk25 ./mvnw -q -pl chat-service -am verify`

## Objective
Port the `/chat` endpoint of `main.py` (AgentCore proxy + session history + rate limit + AI-quota gate + image validation).
Externalize the in-process dicts to **Redis** (multi-replica safe).

## Source references
- `Backend/app/main.py` — `/chat` handler, `_chat_history_*`, `_check_rate_limit`, `_track_event`, payload construction, image validation, `invoke_agent_runtime`.

## AgentCore invoke (§3.5)
- `software.amazon.awssdk.services.bedrockagentcore.BedrockAgentCoreClient`; `invokeAgentRuntime(InvokeAgentRuntimeRequest.builder()
  .agentRuntimeArn(AGENT_RUNTIME_ARN).runtimeSessionId(sid).qualifier("DEFAULT").payload(SdkBytes.fromUtf8String(json)).build())`.
  Read response payload bytes → JSON `{response, agent, session_id}`. IAM auth via IRSA. Wrap in Resilience4j (timeout/CB) — Phase 4.
- `runtimeSessionId`: if `session_id.length() < 33` append `"-" + 16 hex chars` (parity).

## Behaviour (parity)
- Types: `chat|hint|session_start|explain|grade`. Build payload: message,user_id,session_id,type,module_uuid,lesson_uuid,conversation_history;
  grade adds question_number,result; image adds base64. `session_start`/`explain` skip history read/write.
- **AI quota gate**: for `type=chat`, call user-service `getAiQuota`; if `messages_remaining<=0` → 403 body
  `{code:"AI_QUOTA_EXHAUSTED", quota:{...}}`. After success, user-service `incrementAiMessages`.
- **Image**: strip data-url prefix, base64-decode (validate), assert JPEG magic `FF D8 FF` else 400; cap ~1.5MB (`@Size`/manual).
- **Session history (Redis)**: key `chat:hist:{sid}`, TTL 4h, max 40 msgs; append user+assistant turns.
- **Rate limit (Redis)**: sliding window `chat` 30/3600s per user (Lua or ZSET); 429 on exceed.

## Agent invocation abstraction (prod vs CI/local) — REQUIRED
Define interface `AgentInvoker { AgentReply invoke(AgentPayload p); }` with two profile-selected beans:
- `AgentCoreInvoker` (profile `default`/prod) — `BedrockAgentCoreClient.invokeAgentRuntime` against `AGENT_RUNTIME_ARN` (the Python Strands runtime). Returns `{response, agent, session_id}`.
- `BedrockDirectInvoker` (profiles `local`,`e2e`) — calls **Bedrock Nova Lite 2 directly** via
  `BedrockRuntimeClient.converse(modelId="us.amazon.nova-2-lite-v1:0", ...)`, mapping the chat `type`→a system prompt
  (reuse the tutor/grader/planner prompts from `Backend/agents/prompts.py`) and returning the same `{response, agent, session_id}` contract.
  This lets local dev + the k3s e2e exercise the REAL model and the full chat-service plumbing WITHOUT deploying the
  managed Python AgentCore runtime. **VERIFIED 2026-06-30**: `aws bedrock-runtime converse --model-id us.amazon.nova-2-lite-v1:0` works on this account (returned a live completion). Select via `rosettacloud.chat.invoker=agentcore|bedrock-direct`.

## Files
- `service/ChatService`, `service/AgentInvoker` (+ `AgentCoreInvoker`, `BedrockDirectInvoker`), `service/RedisSessionStore`, `service/RedisRateLimiter`, `service/ImageValidator`.
- `client/UserServiceClient` (`@HttpExchange`: getAiQuota, incrementAiMessages).
- `web/ChatController` + `ChatRequest`/`ChatResponse` records.
- `config/application.yml` (port 8084, AGENT_RUNTIME_ARN, AWS_REGION, REDIS_HOST/PORT), Dockerfile, k8s/ (IRSA: bedrock-agentcore:InvokeAgentRuntime).
- Dependency: `spring-boot-starter-data-redis`.

## Tests
- `ImageValidatorTest` (unit) — valid/invalid JPEG, oversize.
- `RedisRateLimiterTest`/`RedisSessionStoreIT` — Testcontainers Redis.
- `ChatControllerTest` (`@WebMvcTest`) — AgentCore via WireMock/mock invoker; quota 403 shape; type routing; image 400.
- `ChatServiceIT` — Testcontainers Redis + WireMock (AgentCore + user-service): full chat turn updates history + increments quota.

## Acceptance
- Build GREEN; quota gate + image validation + Redis session/rate-limit covered; AgentCore call shape matches boto3 payload.
