package app.rosettacloud.chat.web;

import app.rosettacloud.chat.service.ChatService;
import app.rosettacloud.chat.web.dto.ChatRequest;
import app.rosettacloud.chat.web.dto.ChatResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ChatController {

    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    private static String resolvedId(Jwt jwt) {
        String custom = jwt.getClaimAsString("custom:user_id");
        return (custom != null && !custom.isBlank()) ? custom : jwt.getSubject();
    }

    @PostMapping("/chat")
    public ChatResponse chat(@RequestBody ChatRequest req, @AuthenticationPrincipal Jwt jwt) {
        return chatService.handle(resolvedId(jwt), req);
    }
}
