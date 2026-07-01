package app.rosettacloud.shared.error;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

class ErrorHandlingTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void apiExceptionMapsToProblemDetailWithCodeAndPayload() {
        var ex = new ApiException(HttpStatus.BAD_REQUEST, "bad thing", "SOME_CODE", "extra");
        ResponseEntity<ProblemDetail> resp = handler.handleApi(ex);
        assertThat(resp.getStatusCode().value()).isEqualTo(400);
        ProblemDetail pd = resp.getBody();
        assertThat(pd).isNotNull();
        assertThat(pd.getStatus()).isEqualTo(400);
        assertThat(pd.getDetail()).isEqualTo("bad thing");
        assertThat(pd.getProperties()).containsEntry("code", "SOME_CODE").containsEntry("payload", "extra");
    }

    @Test
    void conflictExceptionMapsTo409() {
        ResponseEntity<ProblemDetail> resp = handler.handleApi(new ConflictException("dup"));
        assertThat(resp.getStatusCode().value()).isEqualTo(409);
    }

    @Test
    void genericExceptionMapsTo500WithInternalCode() {
        ResponseEntity<ProblemDetail> resp = handler.handleGeneric(new RuntimeException("boom"));
        assertThat(resp.getStatusCode().value()).isEqualTo(500);
        assertThat(resp.getBody().getProperties()).containsEntry("code", "INTERNAL_ERROR");
    }

    @Test
    void exceptionSubclassesCarryTheirStatus() {
        assertThat(new ConflictException("x").getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(new ResourceNotFoundException("x").getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(new BadRequestException("x").getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
    }
}
