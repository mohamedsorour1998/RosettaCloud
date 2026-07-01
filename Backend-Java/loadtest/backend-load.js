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

// CI-tunable knobs (defaults suit a staged/prod target; CI passes smaller values for a 2-core runner).
const VUS_PEAK = Number(__ENV.VUS_PEAK || 50);
const VUS_MID = Math.max(1, Math.round(VUS_PEAK / 2));
const P95_MS = Number(__ENV.P95_MS || 800);
const ERR_RATE = Number(__ENV.ERR_RATE || 0.01);

export const options = {
  scenarios: {
    quota_reads: { executor: "ramping-vus", startVUs: 1,
      stages: [{ duration: "30s", target: VUS_MID }, { duration: "1m", target: VUS_PEAK }, { duration: "30s", target: 0 }] },
  },
  thresholds: {
    http_req_failed: [`rate<${ERR_RATE}`],
    http_req_duration: [`p(95)<${P95_MS}`],
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
