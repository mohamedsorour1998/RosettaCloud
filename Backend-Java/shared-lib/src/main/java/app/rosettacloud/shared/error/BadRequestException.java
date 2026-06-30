package app.rosettacloud.shared.error;

import org.springframework.http.HttpStatus;

/** 400 — malformed or invalid request. */
public class BadRequestException extends ApiException {
    public BadRequestException(String detail) {
        super(HttpStatus.BAD_REQUEST, detail);
    }
}
