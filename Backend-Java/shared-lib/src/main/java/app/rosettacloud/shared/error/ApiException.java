package app.rosettacloud.shared.error;

import org.springframework.http.HttpStatus;

/**
 * Base application exception carrying an HTTP status, an optional machine-readable
 * {@code code}, and an optional {@code payload} merged into the RFC-7807 response.
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final transient Object payload;

    public ApiException(HttpStatus status, String detail, String code, Object payload) {
        super(detail);
        this.status = status;
        this.code = code;
        this.payload = payload;
    }

    public ApiException(HttpStatus status, String detail) {
        this(status, detail, null, null);
    }

    public ApiException(HttpStatus status, String detail, String code) {
        this(status, detail, code, null);
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public Object getPayload() {
        return payload;
    }
}
