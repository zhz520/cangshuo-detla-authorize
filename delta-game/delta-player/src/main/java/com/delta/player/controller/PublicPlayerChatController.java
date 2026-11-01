package com.delta.player.controller;

import com.delta.common.chat.domain.entity.ChatSession;
import com.delta.common.chat.service.ChatSessionService;
import com.delta.common.chat.util.ChatParticipantId;
import com.delta.common.domain.R;
import com.delta.common.security.utils.SecurityUtils;
import com.delta.player.entity.Player;
import com.delta.player.service.PlayerDirectoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/app/players")
@RequiredArgsConstructor
public class PublicPlayerChatController {
    private final PlayerDirectoryService directory;
    private final ChatSessionService sessions;

    @PostMapping("/{id}/chat")
    @PreAuthorize("hasRole('USER')")
    public R<ChatSession> chat(@PathVariable Long id) {
        if(!"USER".equals(SecurityUtils.getUserType())) return R.fail(403,"请在用户端发起私聊");
        Player player=directory.requireVisible(id);
        long target=ChatParticipantId.encodePlayer(id);
        ChatSession session=sessions.findOrCreate(ChatParticipantId.encodeUser(SecurityUtils.getUserId()),target);
        session.setTargetId(target);session.setTargetName(player.getNickname());session.setAvatar(player.getAvatar());
        return R.ok(session);
    }
}
