# Amazon Nova AI Hackathon — Devpost Submission

## Submitter Type
Professional Developer (Individual)

## Category
**Agentic AI** — Build solutions where agents use Amazon Nova reasoning capabilities to tackle complex, real-world problems.

---

## Text Description

### What it does

RosettaCloud is a multi-agent AI platform that democratizes software engineering education — specifically cloud computing and DevOps. Three specialized agents — Tutor, Grader, and Planner — powered by Amazon Nova 2 Lite collaborate to teach students through real cloud lab environments provisioned on-demand in the browser.

When a student asks a question, Nova 2 Lite classifies the intent and routes it to the right agent. The Tutor uses RAG (Amazon Titan embeddings + LanceDB) to provide curriculum-grounded hints before giving direct answers. The Grader validates practical exercises by running automated scripts inside the student's live environment and explains results using Nova's reasoning. The Planner checks the student's DynamoDB progress and recommends next steps.

Each student gets their own isolated cloud environment (VS Code in browser + Docker + Kubernetes) provisioned in ~10 seconds on EKS Auto Mode.

<!-- INSERT IMAGE: Lab environment showing code-server (VS Code in browser) with terminal open — the student's real cloud workspace -->

### How it uses Amazon Nova

**Amazon Nova 2 Lite** (`amazon.nova-2-lite-v1:0`) is the core reasoning engine for all three agents:

- **Message classification**: Nova 2 Lite classifies every incoming message to route it to the correct specialized agent (tutor/grader/planner). Uses a single-turn `converse()` call with a classifier prompt — returns the agent name in under 200ms.

- **Agent reasoning**: Each agent uses Nova 2 Lite through the Strands Agents SDK (`BedrockModel`). The model performs multi-turn reasoning with tool calls — it decides when to search the knowledge base, check student progress, or fetch exercise details.

- **Multimodal vision**: Students can screenshot their terminal and send it to the Tutor. Nova 2 Lite analyzes the image alongside the text question using its vision capabilities (`{"image": {"format": "jpeg", "source": {"bytes": ...}}}`).

- **RAG grounding**: Amazon Titan Embed Text v2 creates vector embeddings of course materials. Nova 2 Lite uses the retrieved context to generate curriculum-specific responses rather than generic knowledge.

<!-- INSERT IMAGE: AI chatbot conversation showing hint-first teaching — Tutor gives a guiding question before explaining the answer -->

### Technical architecture

- **Agent framework**: Strands Agents SDK (AWS open-source) with AgentCore Runtime for managed deployment
- **Tool dispatch**: AgentCore Gateway using MCP (Model Context Protocol) — 6 tools backed by Lambda
- **Memory**: In-process session history (4h TTL, 20 turns) + AgentCore Memory for cross-session persistence
- **Infrastructure**: EKS Auto Mode (k8s 1.33), ALB (target-type: ip), Istio service mesh, CloudFront CDN
- **Auth**: Cognito User Pool + API Gateway JWT authorizer
- **CI/CD**: 6 GitHub Actions workflows (OIDC, no static credentials)
- **Data**: DynamoDB (users/progress), S3 (exercises/vectors), LanceDB (RAG), Redis (cache)

### 17 AWS services in production

Amazon Bedrock (Nova 2 Lite), Bedrock AgentCore, Amazon Titan Embed v2, Amazon Cognito, API Gateway HTTP API, Amazon EKS, Application Load Balancer, CloudFront, Route 53, AWS Lambda (x2), Amazon DynamoDB, Amazon S3, Amazon ECR, Amazon EventBridge, IAM (IRSA), CloudWatch.

### What makes it different

1. **Production-deployed** — live at dev.rosettacloud.app with real users, not a hackathon prototype
2. **Hint-first pedagogy** — the AI teaches thinking, not just answers
3. **Real infrastructure** — students get actual cloud environments, not simulations
4. **Multi-agent specialization** — three agents with distinct roles and tools, not one generic chatbot
5. **Multimodal** — screenshot analysis for terminal errors using Nova 2 Lite vision

<!-- INSERT IMAGE: Snap & Ask feature — student sends a terminal screenshot and the AI analyzes it visually -->

<!-- INSERT IMAGE: Practical exercise check — student clicks "Check Solution" and gets specific grading feedback -->

---

## Demo Video
[YouTube link — ~3 minutes, #AmazonNova]

## Code Repository
https://github.com/mohamedsorour1998/RosettaCloud

## Blog Post (Bonus Prize)
[builder.aws.com article link — tagged Amazon-Nova]
