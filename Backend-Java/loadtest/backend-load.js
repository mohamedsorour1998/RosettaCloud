// k6 load test for the RosettaCloud backend (run against a deployed/staged stack).
//   BASE_URL=https://api.dev.rosettacloud.app TOKEN=<jwt> k6 run Backend-Java/loadtest/backend-load.js
//
// Scenarios ramp to 50 VUs; thresholds gate p95 latency and error rate.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:8081";
const ANALYTICS = __ENV.ANALYTICS_URL || "http://localhost:8085";
const TOKEN = __ENV.TOKEN || "";
const USER_ID = __ENV.USER_ID || "loadtest-user";

export const options = {
  scenarios: {
    quota_reads: { executor: "ramping-vus", startVUs: 1,
      stages: [{ duration: "30s", target: 25 }, { duration: "1m", target: 50 }, { duration: "30s", target: 0 }] },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

export default function () {
  const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };

  const pub = http.get(`${ANALYTICS}/public/stats`);
  check(pub, { "public/stats 200": (r) => r.status === 200 });

  if (TOKEN) {
    const q = http.get(`${BASE}/users/${USER_ID}/lab-quota`, auth);
    check(q, { "lab-quota 200": (r) => r.status === 200 });
  }
  sleep(1);
}
