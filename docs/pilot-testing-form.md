# RosettaCloud Pilot Testing — Google Form Questions

**Purpose**: Collect user feedback and testimonials from 3-5 pilot testers before April 12, 2026.
**Target testers**: Engineering students, bootcamp peers, DevOps community members.
**Platform URL**: https://dev.rosettacloud.app
**Metrics endpoint**: https://api.dev.rosettacloud.app/admin/metrics

---

## Form Title

**RosettaCloud Pilot Testing — Feedback Form**

## Form Description

Thank you for testing RosettaCloud! This takes ~5 minutes. Your feedback helps us improve and will be referenced (with your permission) in our competition submission. Please complete at least one lab session before filling this out.

---

## Section 1: About You

**Q1. What is your name?**
- Short text (required)

**Q2. What best describes your current role?**
- CS/Engineering student
- Bootcamp student/graduate
- Junior developer
- Career changer into tech
- DevOps/Cloud engineer
- Other (please specify)

**Q3. How would you rate your experience with Docker and Kubernetes before using RosettaCloud?**
- No experience (never used them)
- Beginner (watched tutorials, read docs)
- Intermediate (used them in personal projects)
- Advanced (use them at work)

**Q4. What country are you based in?**
- Short text (required)

---

## Section 2: Platform Experience

**Q5. How long did it take for your lab environment to load after clicking "Start Lab"?**
- Less than 10 seconds
- 10-30 seconds
- 30-60 seconds
- More than 1 minute
- It didn't load

**Q6. Were you able to run Docker and Kubernetes commands in your lab?**
- Yes, everything worked
- Partially — some commands worked, others didn't
- No, I couldn't run them
- I didn't try Docker/K8s commands

**Q7. How would you rate the overall lab experience (VS Code in browser, terminal, tools)?**
- 1 — Very poor
- 2 — Poor
- 3 — Average
- 4 — Good
- 5 — Excellent

---

## Section 3: AI Tutor Experience

**Q8. Did you interact with the AI chatbot?**
- Yes
- No (skip to Section 4)

**Q9. When you asked the AI a question, did it guide you toward the answer (hints) or just give you the answer directly?**
- It gave hints and guided me to think
- It gave the answer directly
- A mix of both
- I'm not sure

**Q10. How helpful was the AI tutor in understanding the material?**
- 1 — Not helpful at all
- 2 — Slightly helpful
- 3 — Moderately helpful
- 4 — Very helpful
- 5 — Extremely helpful

**Q11. Did the AI tutor feel different from ChatGPT or other AI chatbots? How?**
- Long text (optional)

---

## Section 4: Learning Effectiveness

**Q12. After using RosettaCloud, do you feel more confident about Docker, Kubernetes, or Linux?**
- Yes, significantly more confident
- Yes, somewhat more confident
- No change
- I was already confident before

**Q13. Compared to watching YouTube tutorials or reading documentation, how effective was learning on RosettaCloud?**
- Much more effective
- Somewhat more effective
- About the same
- Less effective
- I haven't tried other methods

**Q14. Would you use RosettaCloud again for learning?**
- Yes, definitely
- Probably
- Unsure
- Probably not
- No

---

## Section 5: Value & Pricing

**Q15. If RosettaCloud offered a paid plan with unlimited lab time and full AI tutoring, what monthly price would you consider fair?**
- Free only — I wouldn't pay
- $5-10/month
- $10-15/month
- $15-25/month
- $25+/month

**Q16. How does RosettaCloud compare to other learning platforms you've used (e.g., Coursera, Udemy, AWS Skill Builder, KodeKloud)?**
- Long text (optional)

---

## Section 6: Testimonial (Optional but Valuable)

**Q17. In 1-2 sentences, how would you describe your experience with RosettaCloud to a friend?**
- Long text (optional)
- *Example: "I got a real Kubernetes cluster in my browser in 10 seconds. The AI didn't just give me answers — it made me think through the problem first."*

**Q18. May we quote your feedback (with first name only) in our competition submission?**
- Yes, you can use my first name
- Yes, but keep it anonymous
- No, please don't quote me

---

## Section 7: Open Feedback

**Q19. What was the best part of RosettaCloud?**
- Long text (optional)

**Q20. What needs the most improvement?**
- Long text (optional)

**Q21. Any other comments or suggestions?**
- Long text (optional)

---

## After Collecting Responses

1. Pull aggregate metrics from `/admin/metrics` endpoint
2. Combine with form responses to create pilot data summary
3. Key stats needed for article:
   - Number of testers
   - Average lab load time
   - Question accuracy rate
   - AI tutor helpfulness rating (average of Q10)
   - % who felt more confident (Q12)
   - % who found it more effective than videos (Q13)
   - 2-3 quotable testimonials from Q17
   - Willingness to pay distribution (Q15)
