# RosettaCloud — Three AI Agents That Teach Engineers

App Category: **Social Good — Education Technology**

Team: Mohamed Sorour (@mohamedsorour1998)

`#aideas-2025` `#social-good` `#europe-middle-east-africa` `Amazon-Nova`

**Description (for form):** Three Amazon Nova 2 Lite agents teach cloud computing through real lab environments in the browser — hints before answers, automated grading, 17 AWS services.

---

A computer science student in a developing country wants to become a cloud engineer. She watches tutorials. She reads documentation. She passes the theory exam. But she has never deployed an application to a real server.

She cannot afford a cloud account for practice. Her university has no lab infrastructure. Every online course ends the same way: a wall of text, a diagram, and the words "try it yourself" — with nowhere to try.

This is the reality for millions of students across the developing world. The demand for software engineers who understand cloud computing and DevOps is growing faster than any other technical field. But the learning path is broken — not because content is missing, but because hands-on practice requires infrastructure that most students cannot access.

RosettaCloud changes that.

She opens the platform. Clicks "Start Lab." Ten seconds later, she has a real cloud environment running in her browser — a full IDE, a terminal, Docker, and a Kubernetes cluster. Not a simulation. A real environment where she can build, break, and fix things herself.

She types in the chat: "What is a container?" The AI does not paste a definition. It responds: "Think about what problem running applications inside isolated environments might solve." She thinks. She answers. Now the AI explains — and she actually understands, because she worked through the reasoning herself.

**This is not a prototype. RosettaCloud is live at [dev.rosettacloud.app](https://dev.rosettacloud.app) with real users.**

<!-- INSERT IMAGE: Landing page of RosettaCloud (dev.rosettacloud.app) showing the hero section and "Start Lab" button -->

---

## My Vision

RosettaCloud is a production-deployed, AI-powered platform that democratizes software engineering education — specifically cloud computing and DevOps — by giving every student three things:

1. **Their own real cloud environment** — a full workspace with VS Code in the browser, a terminal, Docker, Kubernetes, and 27 pre-installed developer tools, provisioned in seconds
2. **Three AI agents powered by Amazon Nova 2 Lite** — a Tutor that teaches through guided hints, a Grader that validates practical work and gives specific feedback, and a Planner that builds personalized learning paths
3. **Real practical exercises** — automated scripts that run inside the student's live environment and validate their work, not multiple-choice quizzes

The mission: replace expensive bootcamps and dead-end video tutorials with an affordable, AI-guided, hands-on learning experience that anyone with a browser can access.

---

## Why This Matters

The software engineering skills gap is a global crisis. Cloud computing, DevOps, and platform engineering roles are among the fastest-growing and highest-paying jobs in technology. But the path to getting these skills is broken for most of the world.

The problem is not a shortage of content. There are thousands of tutorials online. The problem is that watching someone else type commands teaches you almost nothing. You need to do it yourself — deploy a service, watch it fail, read the logs, fix the configuration. That requires real infrastructure, and infrastructure costs money.

Traditional options are not accessible:

- **Cloud certifications**: study guides and multiple-choice exams — no hands-on practice
- **Bootcamps**: $10,000–$20,000 USD — out of reach for most of the world
- **Free tier accounts**: complex setup, risk of unexpected billing, no guided learning path
- **Browser sandboxes**: pre-scripted playgrounds where you follow instructions but never make real decisions

For students in developing countries — across Africa, the Middle East, South Asia, and Latin America — these barriers are even higher. A computer science graduate in these regions has the talent and motivation but lacks access to the tools that students at well-funded universities take for granted.

RosettaCloud removes that barrier. Every student gets:

- A **real cloud environment** running in the browser. Not a locked-down playground — a full workspace where you can run real commands, deploy real services, break things, and debug them yourself.
- An **AI tutor that teaches thinking, not answers**. The three agents guide students through the reasoning process, check their work with real automated validation, and adapt the learning path to their progress.
- **Radically affordable**. The platform runs on spot instances. Each lab session costs approximately $0.04 per hour to operate — a fraction of what any bootcamp or cloud certification charges.

This is education technology for social good. Not another chatbot wrapper — a complete learning platform that gives every student in the world the same tools a professional cloud engineer uses.

---

## How I Built This

### Architecture Overview

```
Browser
  |
Route 53 --> CloudFront --> ALB (EKS Auto Mode) --> Istio Service Mesh
                                                        |
                                          +-------------+-------------+
                                          |             |             |
                                     Frontend Pod   Backend Pod   Lab Pods
                                     (Angular 19)   (FastAPI)    (code-server
                                                       |          + Docker + K8s)
                                                       |
                                          Amazon Bedrock AgentCore
                                          (Tutor / Grader / Planner)
                                                       |
                                          +-------------+-------------+
                                          |             |             |
                                    Nova 2 Lite    Titan Embed   LanceDB
                                    (reasoning)    (vectors)     (RAG on S3)

API Gateway HTTP API --> JWT Authorizer (Cognito) --> ALB --> Backend
```

RosettaCloud is a full production system, not a single Lambda function calling Bedrock. The platform runs on **17 AWS services** working together.

<!-- INSERT IMAGE: The /docs architecture page from RosettaCloud showing the full system diagram (dark blueprint design) -->

### AWS Services Used

| Service | What It Does in RosettaCloud |
|---------|----------------------------|
| **Amazon Bedrock (Nova 2 Lite)** | Core reasoning engine for all 3 AI agents — classifies questions, generates hints, grades answers, plans learning paths |
| **Bedrock AgentCore** | Managed multi-agent runtime — deploys tutor/grader/planner agents as containers (ARM64, CodeBuild) |
| **Strands Agents SDK** | AWS open-source framework for building tool-using agents with session management |
| **Amazon Titan Embed v2** | Converts course materials and scripts into vectors for semantic search (RAG) |
| **Amazon Cognito** | User authentication — email sign-up, 6-digit verification codes, JWT token issuance (1h TTL) |
| **API Gateway HTTP API** | JWT-authorized REST API at `api.dev.rosettacloud.app` — validates Cognito tokens on every request |
| **Amazon EKS (Auto Mode)** | Kubernetes cluster running all workloads including dynamically provisioned lab environments |
| **Application Load Balancer** | EKS Auto Mode provisions internet-facing ALB; routes to Istio ingress pods via target-type: ip |
| **CloudFront** | CDN for frontend SPA, origin points to ALB |
| **Route 53** | DNS for `rosettacloud.app`, `api.dev.rosettacloud.app`, `*.labs.dev.rosettacloud.app` (wildcard for lab subdomains) |
| **AWS Lambda** | 2 container-based functions: document indexer (S3 scripts into LanceDB) and AgentCore Gateway tool handler |
| **Amazon DynamoDB** | User profiles, learning progress, lab state tracking |
| **Amazon S3** | Exercise script bank, LanceDB vector store backend, Terraform remote state |
| **Amazon ECR** | Docker registry for 4 container images (frontend, backend, labs, Lambda) |
| **EventBridge** | S3 notifications trigger document indexing pipeline automatically |
| **IAM with IRSA** | Pod-level AWS credentials using IAM Roles for Service Accounts — no static keys anywhere |
| **CloudWatch** | Logging and monitoring for all services |

Not 5 services. Not 8. **Seventeen.** Every service serves a specific purpose in the production architecture.

### The Multi-Agent AI Brain

This is the core of RosettaCloud. Three specialized agents work together, each with a distinct educational role. All three are powered by Amazon Nova 2 Lite, built with the Strands Agents SDK, and deployed on Bedrock AgentCore.

**1. The Tutor — "Makes you think before it answers."**

When a student asks "What is a container?", most chatbots paste a Wikipedia definition. The Tutor does not. It responds with a guiding question first: "What problem do you think running applications inside isolated environments might solve?"

This is hint-first pedagogy. The student engages with the concept before receiving the explanation. Only after the student tries — or asks again — does the Tutor explain directly.

The Tutor also uses RAG (Retrieval-Augmented Generation). When a student asks about a specific topic, the agent searches a vector database of indexed course materials using Amazon Titan embeddings. It retrieves the most relevant passages from LanceDB (stored on S3) and uses them as context for its response. The student gets answers grounded in the actual curriculum, not generic internet knowledge.

<!-- INSERT IMAGE: AI chatbot conversation showing the hint-first teaching approach — student asks a question, Tutor responds with a guiding hint first, then explains after the student engages -->

**2. The Grader — "Tells you exactly why you are right or wrong."**

After a student completes a practical exercise — for example, creating a file, writing a script, or deploying a service inside their live lab environment — an automated script runs inside the environment to check the answer. The Grader agent receives the result, fetches the student's progress from DynamoDB, and generates specific feedback.

No generic "Good job!" messages. If the student got it right, the Grader explains why the approach works. If wrong, it explains the gap and suggests what to try next.

<!-- INSERT IMAGE: Practical exercise check — student completes a task in their lab, clicks "Check Solution", and the Grader gives specific feedback on what they did right or wrong -->

**3. The Planner — "Knows where you are and where you should go next."**

When a student starts a new session, the Planner checks their progress across all modules. It identifies gaps, considers exercise difficulty, and recommends what to tackle next. Students do not have to figure out the learning path themselves — the Planner adapts it to their current state.

Here is the actual routing logic from the production code:

```python
# Multi-agent classification — runs on every message
def _classify(message: str, msg_type: str) -> str:
    if msg_type == "grade":          return "grader"
    if msg_type == "hint":           return "tutor"
    if msg_type == "session_start":  return "planner"
    # Free-form messages: Nova 2 Lite classifies intent
    return nova_2_lite_classify(message)
```

The agents communicate with backend tools through the AgentCore Gateway, which uses the MCP (Model Context Protocol) standard. Six tools are exposed — `search-knowledge-base`, `get-user-progress`, `get-question-details`, `get-attempt-result`, `list-available-modules`, and `get-question-metadata` — all backed by a Lambda function that reads from DynamoDB and S3.

### The Interactive Labs

When a student clicks "Start Lab," the backend creates a fully isolated cloud environment in seconds:

1. **A workspace** — VS Code running in the browser (code-server), with a full terminal, Docker, Kubernetes (Kind), and 27 pre-installed extensions and tools including Python, Node.js, AWS CLI, Helm, and kubectl.
2. **A network identity** — each lab gets its own subdomain: `{lab-id}.labs.dev.rosettacloud.app`, routed through Istio service mesh.
3. **Complete isolation** — every student's environment is independent. Break something, and only your lab is affected.

The student starts working immediately in the IDE. The environment is ready in 6–10 seconds. A full Kubernetes cluster initializes in the background and is available by the time the student needs it.

<!-- INSERT IMAGE: Lab environment showing code-server (VS Code in browser) with the terminal open, split view — the student's workspace where they write and run real commands -->

**Resource efficiency:** Each lab runs on a spot instance. The backend automatically terminates labs after 1 hour of inactivity to prevent cost waste. Total cost per student session: ~$0.04.

### Multimodal: Snap & Ask

Students often hit cryptic errors in their terminal. Instead of trying to describe the error in text, they can take a screenshot and ask "What does this mean?"

The screenshot is captured using the browser's `getDisplayMedia()` API, compressed to JPEG, and sent to the AI tutor alongside the student's question.

Nova 2 Lite analyzes the terminal output visually and provides targeted help. A student struggling with an error can show the AI exactly what they see and get a specific explanation — not a generic troubleshooting guide.

<!-- INSERT IMAGE: Snap & Ask feature — student takes a screenshot of a terminal error and sends it to the chatbot, which analyzes the image and provides a specific explanation -->

### Development with Kiro

I used Kiro for implementing the Cognito authentication flow and API Gateway integration. Kiro's AI-powered coding assistance was especially useful for scaffolding the JWT validation middleware, wiring up the Cognito SDK in the Angular frontend, and writing the Terraform module for the API Gateway HTTP API with JWT authorizer. The spec-driven approach helped me keep the authentication architecture clean across frontend, backend, and infrastructure layers.

I also used Kiro for writing and refining the architecture documentation, including the `/docs` page redesign — a custom dark blueprint design system built with Syne, Figtree, and JetBrains Mono fonts.

### CI/CD Pipeline

Six GitHub Actions workflows automate the entire deployment:

| Workflow | Trigger | What It Does |
|----------|---------|-------------|
| Backend Build | Push to `Backend/app/**` | Docker build, push to ECR, rolling restart on EKS |
| Frontend Build | Push to `Frontend/src/**` | Angular production build, Docker (nginx), push to ECR, restart |
| Agent Deploy | Push to `Backend/agents/**` | AgentCore `launch` via CodeBuild (ARM64 container) |
| Lambda Deploy | Push to `Backend/serverless/**` | Container Lambda deployment for indexer and tools |
| Questions Sync | Push to `Backend/questions/**` | Syncs exercise scripts to S3, triggers EventBridge indexing |
| Interactive Labs | Push to `DevSecOps/interactive-labs/**` | Builds 1.86 GB lab container image |

All workflows use GitHub OIDC federation. No static AWS credentials stored anywhere.

---

## Demo

**Live:** [dev.rosettacloud.app](https://dev.rosettacloud.app)

<!-- INSERT IMAGE: Full-page screenshot of the landing page (logged-out view) showing what new visitors see -->

<!-- INSERT IMAGE: Dashboard or module selection page — what a logged-in student sees before starting a lab -->

[Demo video: ~3 minutes walkthrough with #AmazonNova]

---

## What I Learned

**Multi-agent AI is harder than single-agent.** The biggest challenge was not getting Nova to answer questions — it is good at that out of the box. The hard part was routing. Which agent should handle "My deployment is failing"? The Tutor (teaching moment) or the Grader (checking exercise)? I spent weeks tuning the classifier prompt and the routing logic until the handoffs felt natural.

**Real infrastructure is worth the engineering cost.** I could have built a fake terminal simulator in JavaScript. It would have been faster to develop and cheaper to run. But students would learn to type commands into a simulator — not to work with real systems. The complexity of managing live cloud environments is significant. But when a student runs a command and sees a real result, the learning is incomparable.

**Nova 2 Lite is fast enough for education.** Response time matters. If a student waits 10 seconds for a hint, they lose focus and switch tabs. Nova 2 Lite on Bedrock delivers responses in 1–2 seconds consistently. That keeps the learning flow unbroken. For an education platform, latency is a pedagogy issue, not just a UX issue.

**Hint-first pedagogy works better than direct answers.** When the AI immediately gives the answer, students copy and forget. When it hints first, students think. I can see this in the conversation patterns — students who get hints first ask more follow-up questions, which means they are engaging deeper with the material.

**Serverless and containers can coexist.** Lambda handles event-driven workloads (document indexing, tool dispatch). EKS handles long-running workloads (lab environments, backend, frontend). Each compute model serves the workload that fits it. Trying to force everything into one model would have been a mistake.

---

## The Bigger Picture

Software engineering is becoming a foundational skill for the global economy. Cloud computing and DevOps are at the center of that transformation. But the people who need these skills the most — students in developing countries, career changers without access to expensive training, self-taught developers without lab infrastructure — are the ones least able to access hands-on practice.

RosettaCloud is my attempt to democratize that access. Every student who opens the platform gets the same tools a professional cloud engineer uses — a real environment, a real IDE, and an AI tutor that teaches them to think like an engineer.

It runs today. And it is built entirely on AWS.

`dev.rosettacloud.app`
