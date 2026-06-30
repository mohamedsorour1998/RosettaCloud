package app.rosettacloud.shared.error;

import org.springframework.http.HttpStatus;

/** 404 — requested resource does not exist. */
public class ResourceNotFoundException extends ApiException {
    public ResourceNotFoundException(String detail) {
        super(HttpStatus.NOT_FOUND, detail);
    }
}
