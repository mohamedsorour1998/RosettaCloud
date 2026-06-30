package app.rosettacloud.shared.error;

import org.springframework.http.HttpStatus;

/** 409 — request conflicts with current state (e.g., duplicate email). */
public class ConflictException extends ApiException {
    public ConflictException(String detail) {
        super(HttpStatus.CONFLICT, detail);
    }
}
