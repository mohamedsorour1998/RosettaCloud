# Multi-Agent Education Platform Design

**Date**: 2026-02-24
**Target**: Amazon Nova AI Hackathon (Devpost, deadline Mar 17) + 10,000 AIdeas Competition (AWS Builder Center, article due Mar 13)
**Category**: Agentic AI
**Required tech**: Amazon Nova 2 Lite, Amazon Bedrock AgentCore Runtime, Strands Agents SDK

## Overview

Transform RosettaCloud from a RAG-chatbot education platform into a multi-agent education platform where specialized AI agents collaborate to teach, grade, and plan learning paths for DevOps students.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    STUDENT BROWSER                       │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐ │
│  │ Lab IDE  │  │ Lessons  │  │ AI Assistant Panel     │ │
│  │ (code-   │  │ & Quizzes│  │ ┌──────────────────┐  │ │
│  │  server) │  │          │  │ │ Agent Cards UI   │  │ │
│  │          │  │          │  │ │ 🎓 Tutor         │  │ │
│  │          │  │          │  │ │ ✅ Grader        │  │ │
│  │          │  │          │  │ │ 🗺️ Planner      │  │ │
│  └──────────┘  └──────────┘  │ └──────────────────┘  │ │
│                               └────────────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket
                         ▼
              ┌─────────────────────┐
              │  API Gateway (WSS)  │
              └──────────┬──────────┘
                         ▼
         ┌───────────────────────────────┐
         │  Orchestrator Agent           │
         │  (AgentCore Runtime)          │
         │  Nova 2 Lite                  │
         │                               │
         │  Classifies intent → routes   │
         │  to specialist agent          │
         └───┬──────────┬───────────┬────┘
             │          │           │
             ▼          ▼           ▼
      ┌──────────┐ ┌──────────┐ ┌──────────────┐
      │ Tutor    │ │ Grader   │ │ Curriculum   │
      │ Agent    │ │ Agent    │ │ Planner Agent│
      │ Nova 2   │ │ Nova 2   │ │ Nova 2 Lite  │
      │ Lite     │ │ Lite     │ │              │
      └────┬─────┘ └────┬─────┘ └──────┬───────┘
           │             │              │
           ▼             ▼              ▼
    ┌─────────────────────────────────────────┐
    │           Shared Tools (via Gateway)     │
    │  • RAG Search (LanceDB)                 │
    │  • User Progress (DynamoDB)             │
    │  • Course Content (S3)                  │
    │  • Chat History (AgentCore Memory)      │
    └─────────────────────────────────────────┘
```

## Agents

### Orchestrator Agent
- **Model**: Nova 2 Lite
- **Role**: Classifies student intent, routes to specialist, returns response with agent card label
- **Intent categories**:
  - Concept questions → Tutor
  - Question attempt results / "grade my work" → Grader
  - "What next?" / progress inquiries → Curriculum Planner
- **No tools** — pure routing logic

### Tutor Agent
- **Model**: Nova 2 Lite
- **System prompt**: DevOps education specialist. Hints-first pedagogy — give hints on first ask, direct answer on second ask. Reject non-DevOps questions.
- **Tools**:
  - `search_knowledge_base(query)` — RAG search over LanceDB shell scripts vector store
  - `get_chat_history(session_id)` — retrieve prior conversation from AgentCore Memory
  - `get_current_question(user_id)` — fetch the question the student is currently working on

### Grader Agent
- **Model**: Nova 2 Lite
- **System prompt**: Educational assessor. Give constructive feedback, explain mistakes, suggest improvements. Be encouraging.
- **Tools**:
  - `get_question_details(module, lesson, question_num)` — fetch question text, correct answer, difficulty from S3
  - `get_user_progress(user_id)` — fetch all completed/failed questions from DynamoDB
  - `get_attempt_result(user_id, question)` — get the pass/fail result from the latest check
- **Triggers**:
  - Auto: Frontend sends question attempt result → Orchestrator → Grader → detailed feedback
  - On-demand: Student asks "how am I doing?" → Orchestrator → Grader → comprehensive summary

### Curriculum Planner Agent
- **Model**: Nova 2 Lite
- **System prompt**: Learning path advisor. Analyze progress, identify knowledge gaps, recommend next steps based on DevOps skill progression.
- **Tools**:
  - `get_user_progress(user_id)` — full progress across all modules/lessons
  - `list_available_modules()` — list all modules and lessons from S3
  - `get_question_metadata(module, lesson)` — difficulty levels, topics covered

## Frontend UI: Agent Cards

Single chat interface with agent card headers showing which agent is responding:

- Each agent response wrapped in a colored card with agent name + icon
- 🎓 Tutor Agent (blue), ✅ Grader Agent (green), 🗺️ Curriculum Planner (purple)
- Auto-grading messages appear automatically after question attempts
- Single input box — Orchestrator handles routing behind the scenes
- Existing features preserved: code blocks, copy button, source references, auto-scroll

## Data Flow

### Student asks a question
```
Student types "What is a Docker volume?"
  → WebSocket → API Gateway → Orchestrator Agent
  → Orchestrator classifies: concept question → Tutor Agent
  → Tutor calls search_knowledge_base("Docker volume")
  → Tutor generates educational response with hints
  → Response sent back with {agent: "tutor"} metadata
  → Frontend renders with 🎓 Tutor Agent card
```

### Auto-grading after question attempt
```
Student checks answer on Q3
  → Frontend calls POST /questions/.../check (existing Backend endpoint)
  → Backend runs check script → returns pass/fail
  → Frontend sends over WebSocket: {type: "grade", question_id, result, user_id}
  → Orchestrator → Grader Agent
  → Grader calls get_question_details + get_user_progress
  → Returns detailed feedback: why correct/wrong, what to learn
  → Frontend renders with ✅ Grader Agent card
```

### On-demand progress summary
```
Student asks "What should I study next?"
  → Orchestrator → Curriculum Planner Agent
  → Planner calls get_user_progress + list_available_modules
  → Returns: progress per module, weak areas, recommended next lesson
  → Frontend renders with 🗺️ Curriculum Planner card
```

## What Changes vs What Stays

### Removed
| Component | Reason |
|-----------|--------|
| `Backend/app/services/ai_service.py` | Replaced by AgentCore agents |
| `Backend/app/backends/ai_backends.py` | Replaced by AgentCore agents |
| `Backend/app/services/feedback_service.py` | Replaced by Grader Agent |
| `Backend/app/backends/cache_events_backends.py` | SQS pub/sub + Redis glue removed |
| `Backend/serverless/Lambda/feedback_request/` | Grader Agent replaces SQS feedback pipeline |
| `Backend/serverless/Lambda/ai_chatbot/` | Replaced by AgentCore agents |
| Redis K8s deployment | Replaced by DynamoDB + in-memory cache |
| SQS queue `rosettacloud-feedback-requested` | No longer needed |

### Stays (unchanged)
| Component | Why |
|-----------|-----|
| `labs_service` + `labs_backends` | Lab lifecycle (K8s pods, services, VirtualService) |
| `users_service` + `users_backends` | DynamoDB user CRUD |
| `questions_service` + `questions_backends` | S3 shell scripts + kubectl exec for checks |
| FastAPI Backend on EKS | Serves lab/question/user APIs |
| LanceDB on S3 | Vector store for Tutor Agent RAG |
| DynamoDB `rosettacloud-users` | User data + progress (adds `active_lab` attribute) |
| S3 `rosettacloud-shared-interactive-labs` | Shell script questions source |
| API Gateway WebSocket | Same endpoint, agents replace Lambda handler |
| CloudFront + Istio | Frontend/backend routing unchanged |

### Modified
| Component | Change |
|-----------|--------|
| Frontend chatbot component | Add agent card rendering, auto-grade messages, new WS message types |
| Frontend feedback component | Remove SQS polling, feedback comes through agent chat |
| DynamoDB users table | Add `active_lab` attribute (replaces Redis `active_labs:{user_id}`) |
| Questions backends | Replace Redis cache with in-memory TTL dict |

### New
| Component | Purpose |
|-----------|---------|
| 4x AgentCore Runtime endpoints | Orchestrator, Tutor, Grader, Planner agents |
| AgentCore Memory store | Chat history (replaces DynamoDB SessionTable) |
| AgentCore Gateway | Exposes DynamoDB/S3/LanceDB as MCP tools for agents |
| `Backend/agents/` directory | Strands agent code for all 4 agents |
| CDK stack for AgentCore | Infrastructure as code for agent deployment |
| IAM roles | AgentCore → Bedrock Nova 2 Lite, DynamoDB, S3, LanceDB |

## Infrastructure

### AgentCore Runtime
- 4 agent endpoints (Orchestrator, Tutor, Grader, Planner)
- Serverless — no node capacity concerns
- Framework: Strands Agents SDK
- Model: Amazon Nova 2 Lite (`amazon.nova-2-lite`) for all agents

### AgentCore Gateway
- Converts Backend REST APIs into MCP-compatible tools
- Agents call tools through Gateway → Gateway calls DynamoDB/S3/LanceDB

### AgentCore Memory
- Manages chat history per session
- Replaces DynamoDB `SessionTable`

### Deployment
- CDK for AgentCore resources (following logistics agent sample pattern)
- Agent code in `Backend/agents/`

## Hackathon Strategy

### Amazon Nova AI Hackathon (Devpost, Mar 17)
- **Category**: Agentic AI
- **Submission**: Code repo + 3-min demo video + builder.aws.com blog post
- **Demo story**: Student launches lab → asks Tutor about Docker → answers question → Grader gives feedback → asks "what next?" → Planner recommends path
- **Judging strengths**: Multi-agent architecture (60% technical), education for MENA region (20% impact), novel agent-per-role approach (20% creativity)

### 10,000 AIdeas Competition (Mar 13 article)
- **Track**: Social Impact (education technology)
- **Article**: Builder Center article showcasing multi-agent architecture
- **Demo**: Simplified demo within AWS Free Tier constraints
- **Tool**: Use Kiro for part of development

## Timeline (21 days to Mar 17)

| Days | Task |
|------|------|
| 1-3 | Set up AgentCore Runtime, deploy hello-world Strands agent, confirm it works |
| 4-6 | Build Orchestrator + Tutor Agent with RAG tool (replaces chatbot) |
| 7-9 | Build Grader Agent with progress/question tools, wire auto-grading |
| 10-12 | Build Curriculum Planner Agent, wire frontend agent cards UI |
| 13 | **AIdeas article due** — publish Builder Center article |
| 13-15 | Integration testing, fix bugs, end-to-end flow working |
| 16-17 | AgentCore Observability setup (traces for demo), polish |
| 18-19 | Record 3-min demo video |
| 20 | Write builder.aws.com blog post (bonus prize) |
| 21 | **Submit to Devpost** (Mar 17 deadline) |
