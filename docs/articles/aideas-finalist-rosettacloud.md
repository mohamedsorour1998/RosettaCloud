# AIdeas Finalist: RosettaCloud

App Category: **Social Impact**

Team: Mohamed Sorour (@mohamedsorour1998)

`#aideas-2025` `#aideas-2025-finalist` `#social-impact` `#EMEA`

---

## My Vision

There is a moment that every programming tutorial skips over.

You have watched the video. You understand the concept well enough to explain it. Then you open the terminal and the error message isn't in the tutorial. The container doesn't start the way the slide promised. The cluster behaves differently from the one the instructor was using. You are on your own, and the gap between knowing and doing is suddenly enormous.

That moment is where most students in developing countries give up — not because they lack ability, but because they don't have access to the environment where real learning happens. A CS graduate in Cairo or Lagos or Karachi can watch the same Kubernetes tutorials as a student at Stanford. They cannot afford the same infrastructure to practice on.

I built RosettaCloud because content is not the barrier. Infrastructure is.

The platform provisions a fresh Kubernetes cluster, a Docker daemon, and a full VS Code IDE in the browser in under ten seconds. Not a shared sandbox. Not a pre-built environment. A clean, isolated environment owned completely by the student for their session — where `docker build` works, `kubectl apply` works, and the exit code is the only grade that matters.

Three AI agents guided by Amazon Nova 2 Lite power the tutoring. The Tutor teaches through hints before answers, forcing the student to reason rather than copy. The Grader validates practical exercises by running the student's command inside the live environment and checking the result. The Planner tracks progress across modules and recommends what to study next. Cross-session memory means the tutor remembers what each student struggled with last week.

The curriculum starts with software engineering — Python, scripting, building APIs — and progresses naturally to containerisation with Docker, orchestration with Kubernetes, and cloud infrastructure. DevOps is not the product. Employable engineering skills are the product.

---

## Why This Matters

The standard path to a software engineering career in a developing country looks like this: watch tutorials, collect certificates, hope the interviewer doesn't ask you to build something live.

That path fails at the practical step. AWS Skill Builder costs $29 per month and teaches AWS console navigation — not portable skills. GitHub Codespaces blocks privileged containers by policy, so you cannot run `docker run` inside one. KodeKloud, the best existing hands-on platform, connects students to shared pre-existing Kubernetes sandboxes — you don't own the daemon, and you certainly don't own the cluster. None of them provision real infrastructure from scratch. None of them include a hint-first AI tutor in the base price.

The economic barrier compounds the technical one. For a student in Egypt or Nigeria, $29 per month is a meaningful percentage of monthly income. AWS Skill Builder, Coursera Plus, and A Cloud Guru are priced for employed professionals whose employers reimburse them — not for students trying to enter the industry.

RosettaCloud's answer: AWS spot instances make the cost of a dedicated lab environment approximately $0.04 per hour. Free tier is two hours of real lab time per week — no credit card, ever. Pro tier is $19 per month. University bulk licensing starts at $7 per student per month, which is accessible to bootcamps and universities in every region. The margin on Pro is approximately 98% on compute — free users are subsidised by paying ones, and at scale Karpenter bins multiple labs per node, which reduces costs further.

The social impact is direct: a student who can run `kubectl apply` against real infrastructure gets hired. A student who can only describe what the command does does not.

---

## How I Built This

RosettaCloud is deployed in production with 17 AWS services and 6 automated CI/CD pipelines. This is not a prototype.

**The lab environment**: Each student lab is a privileged Kubernetes pod on EKS Auto Mode. Inside the pod, a Docker daemon starts alongside a Kind cluster provisioned from scratch. VS Code (code-server) loads in the background. Students see a working IDE in approximately eight seconds and a ready Kubernetes cluster within thirty. Istio service mesh handles per-student routing — every lab gets a unique subdomain. No two students share compute or network space.

This is the gap no competitor has crossed. GitHub Codespaces cannot run privileged containers. KodeKloud connects students to pre-existing clusters. AWS Innovation Sandbox provides empty AWS accounts with no curriculum. RosettaCloud provisions a fresh, isolated, production-equivalent environment per student, per session.

**The AI layer**: AgentCore Runtime hosts three specialized agents. The Tutor's system prompt is deliberately constructed to withhold direct answers — it asks questions back, surfaces the next principle the student needs, and guides discovery rather than delivering conclusions. The Grader runs automated shell scripts inside the live cluster and checks exit codes: zero is correct, everything else triggers a context-specific hint. The MCP Gateway connects agents to a Lambda-backed tool layer for knowledge search, progress retrieval, and question metadata. AgentCore Memory persists learning history across sessions.

**Fraud prevention — what is already running**: Amazon Cognito requires a confirmed email before any lab can launch. Redis enforces a single active lab per account — no parallel abuse. Every lab has a hard TTL and terminates automatically. Karpenter's node cap prevents unbounded provisioning even under coordinated pressure. Per-user rate limits on lab creation and AI requests are enforced at the API level, not the UI. Free-tier lab hours are tracked per calendar week in DynamoDB and enforced server-side. None of these are roadmap items. All six are live.

The cost of a malicious actor farming free labs: they get two hours per week, one cluster at a time, confirmed by email. The abuse surface is small by design.

---

## Demo

[Watch the full demo — 4-minute live session with AI tutor]
**https://youtu.be/EzsJ9wofGOo**

---

## What I Learned

The judges in the first round were right about everything. They identified five gaps — no business model, no fraud prevention, no user validation, crowded competitive landscape, unclear path to scale — and every one of those gaps was real. This section is about what happened when I took each one seriously.

**On user validation**: I ran three informal sessions with students after the first round. Each one changed the platform in a specific way.

The first student — a Python developer, not a systems person — opened the lab and went silent. I watched him look at a Kubernetes manifest as his starting point and feel immediately out of his depth. The problem was sequencing, not ability. The curriculum began with orchestration because I built it as a cloud engineer. Someone learning software engineering needs to start with code — scripting, containerising an application they wrote, understanding why Docker exists before they need to understand why Kubernetes exists. I reorganised the curriculum. Software engineering first. Cloud as the natural next layer.

The second student completed the first practical question without using the AI tutor at all. The chat was visible in the sidebar. She didn't know what it was for. She worked by trial and error, got the correct exit code, moved on. The tutor's first message now arrives before the first question — it introduces itself, explains the hint-first approach, and asks what the student already knows about the topic. If students don't know to use the tutor, it doesn't exist.

The third session was the hardest to watch. A student running the platform on a throttled connection in a low-bandwidth area loaded the lab, saw the provisioning spinner, waited, refreshed. The refresh re-initiated the cluster. She refreshed again. Three clusters were provisioned and discarded before she realised what had happened. I added explicit progress messaging — "Setting up your environment... Cluster starting (this takes about 20 seconds)... Almost ready" — with estimated times at each stage. It would never have occurred to me without watching someone outside my network use the product on a connection I wasn't optimising for.

**On the business model**: The math is now explicit. A free user costs approximately $0.35 per month to serve — two hours per week at $0.04 per hour. A Pro subscriber at $19 per month generates roughly $18.63 in gross margin on compute. At steady state, one Pro subscriber subsidises approximately 53 free users. University bulk deals at $7-9 per student per month maintain similar margins at volume. The freemium model is standard for developer tools. The unit economics here are favourable because the variable cost is compute, not people.

**On the competitive landscape**: The competitive analysis forced clarity about what RosettaCloud is not. It is not certification prep — Skill Builder does that better at scale. It is not course breadth — Coursera has 10,000 options. It is not DevOps-only — KodeKloud owns that niche and does it well. The position is narrow and defensible: software engineering education with real, isolated infrastructure per student and a hint-first AI tutor built in at every price point. That combination does not exist anywhere else. The moat is not a feature list — it is a provisioning architecture that no content platform can replicate without becoming an infrastructure company.

**On what I still don't know**: Whether hint-first pedagogy produces measurably better learning outcomes than validate-after approaches. The research on productive failure supports it, and every user session I have observed suggests students retain more when they reason first. I have not run a controlled comparison. That is the work that comes next, and saying otherwise would be dishonest.

The infrastructure gap in software engineering education is real, solvable, and until now unsolved. Every other platform gives students content. RosettaCloud gives students a place to build.

---

*Live platform: [dev.rosettacloud.app](https://dev.rosettacloud.app)*

`#aideas-2025` `#aideas-2025-finalist` `#social-impact` `#EMEA`
