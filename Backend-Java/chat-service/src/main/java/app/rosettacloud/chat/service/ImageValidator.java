package app.rosettacloud.chat.service;

import app.rosettacloud.shared.error.BadRequestException;
import org.springframework.stereotype.Component;

import java.util.Base64;

/** Validates a base64-encoded JPEG (data-url tolerated) — JPEG magic bytes FF D8 FF + size cap. */
@Component
public class ImageValidator {

    private static final int MAX_BYTES = 2_000_000;

    /** Returns the decoded bytes if valid; throws {@link BadRequestException} otherwise. */
    public byte[] validateJpeg(String base64Image) {
        String raw = base64Image.contains(",")
                ? base64Image.substring(base64Image.indexOf(',') + 1)
                : base64Image;
        byte[] decoded;
        try {
            decoded = Base64.getDecoder().decode(raw);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("image must be valid base64 JPEG");
        }
        if (decoded.length > MAX_BYTES) {
            throw new BadRequestException("image exceeds maximum size");
        }
        if (decoded.length < 3
                || (decoded[0] & 0xFF) != 0xFF
                || (decoded[1] & 0xFF) != 0xD8
                || (decoded[2] & 0xFF) != 0xFF) {
            throw new BadRequestException("image must be a JPEG");
        }
        return decoded;
    }
}
