package app.rosettacloud.shared.resilience;

import org.junit.jupiter.api.Test;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.ResourceAccessException;

import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class HttpRetryTest {

    @Test
    void returnsImmediatelyOnSuccess() {
        AtomicInteger calls = new AtomicInteger();
        String result = HttpRetry.withRetry(3, 1, () -> {
            calls.incrementAndGet();
            return "ok";
        });
        assertThat(result).isEqualTo("ok");
        assertThat(calls.get()).isEqualTo(1);
    }

    @Test
    void retriesTransientFailureThenSucceeds() {
        AtomicInteger calls = new AtomicInteger();
        String result = HttpRetry.withRetry(3, 1, () -> {
            if (calls.incrementAndGet() < 2) {
                throw new ResourceAccessException("connection refused");
            }
            return "recovered";
        });
        assertThat(result).isEqualTo("recovered");
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test
    void exhaustsRetriesAndRethrowsTransient() {
        AtomicInteger calls = new AtomicInteger();
        assertThatThrownBy(() -> HttpRetry.withRetry(2, 1, () -> {
            calls.incrementAndGet();
            throw new ResourceAccessException("timeout");
        })).isInstanceOf(ResourceAccessException.class);
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test
    void doesNotRetryHttpStatusErrors() {
        AtomicInteger calls = new AtomicInteger();
        assertThatThrownBy(() -> HttpRetry.withRetry(3, 1, () -> {
            calls.incrementAndGet();
            throw HttpClientErrorException.create(org.springframework.http.HttpStatus.BAD_REQUEST,
                    "bad", org.springframework.http.HttpHeaders.EMPTY, new byte[0], null);
        })).isInstanceOf(HttpClientErrorException.class);
        assertThat(calls.get()).isEqualTo(1);
    }
}
