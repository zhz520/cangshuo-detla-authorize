package com.delta.common.config;

import com.delta.common.chat.handler.ChatWebSocketHandler;
import com.delta.common.security.service.TokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketConfigurer {
    private final ChatWebSocketHandler chatWebSocketHandler;
    private final com.delta.common.websocket.ChatHandshakeInterceptor handshakeInterceptor;
    @org.springframework.beans.factory.annotation.Value("${app.allowed-origins:http://127.0.0.1:17420,http://127.0.0.1:17421}")
    private String allowedOrigins;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatWebSocketHandler, "/ws/chat").addInterceptors(handshakeInterceptor)
                .setAllowedOrigins(allowedOrigins.split(","));
    }
}
