package app.rosettacloud.shared.error;

import org.springframework.http.HttpStatus;

/**
 * 403 — a weekly free-tier quota is exhausted. Carries a machine code (e.g.
 * {@code AI_QUOTA_EXHAUSTED}) and a payload (the quota snapshot) so the RFC-7807
 * body matches the legacy FastAPI contract consumed by the Angular frontend.
 */
public class QuotaExceededException extends ApiException {
    public QuotaExceededException(String detail, String code, Object quota) {
        super(HttpStatus.FORBIDDEN, detail, code, quota);
    }
}
