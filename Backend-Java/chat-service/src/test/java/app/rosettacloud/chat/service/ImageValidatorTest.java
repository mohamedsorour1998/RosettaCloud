package app.rosettacloud.chat.service;

import app.rosettacloud.shared.error.BadRequestException;
import org.junit.jupiter.api.Test;

import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ImageValidatorTest {

    private final ImageValidator validator = new ImageValidator();

    private static String b64(byte... bytes) {
        return Base64.getEncoder().encodeToString(bytes);
    }

    @Test
    void acceptsValidJpegMagicBytes() {
        byte[] decoded = validator.validateJpeg(b64((byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, (byte) 0x00));
        assertThat(decoded).hasSizeGreaterThanOrEqualTo(3);
    }

    @Test
    void toleratesDataUrlPrefix() {
        String dataUrl = "data:image/jpeg;base64," + b64((byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0x11);
        assertThat(validator.validateJpeg(dataUrl)).isNotEmpty();
    }

    @Test
    void rejectsNonJpegBytes() {
        assertThatThrownBy(() -> validator.validateJpeg(b64((byte) 0x00, (byte) 0x01, (byte) 0x02)))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("JPEG");
    }

    @Test
    void rejectsInvalidBase64() {
        assertThatThrownBy(() -> validator.validateJpeg("!!!not-base64!!!"))
                .isInstanceOf(BadRequestException.class);
    }
}
