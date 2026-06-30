package app.rosettacloud.shared.error;

import org.springframework.http.HttpStatus;

/** 429 — rate limit exceeded. */
public class TooManyRequestsException extends ApiException {
    public TooManyRequestsException(String detail) {
        super(HttpStatus.TOO_MANY_REQUESTS, detail);
    }
}
