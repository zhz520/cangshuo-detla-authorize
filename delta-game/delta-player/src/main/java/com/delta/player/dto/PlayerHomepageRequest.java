package com.delta.player.dto;

import com.alibaba.fastjson2.JSON;
import com.delta.player.entity.Player;
import jakarta.validation.constraints.*;
import lombok.Data;
import java.util.List;

@Data
public class PlayerHomepageRequest {
    public static final String MEDIA_URL = "^(?:https?://[^\\s]+|/(?!/)[^\\s]*)?$";
    @Size(max=32) private String nickname;
    @Size(max=512) @Pattern(regexp=MEDIA_URL) private String avatar;
    @Size(max=1000) private String introduction;
    @Size(max=512) @Pattern(regexp=MEDIA_URL) private String coverImage;
    @Size(max=9) private List<@NotBlank @Size(max=512) @Pattern(regexp=MEDIA_URL) String> albumImages;
    @Size(max=5000) private String story;
    @Size(max=512) @Pattern(regexp=MEDIA_URL) private String voiceUrl;
    @Min(0) @Max(60) private Integer voiceDuration;

    public void applyTo(Player player) {
        player.setNickname(nickname == null ? null : nickname.trim());
        player.setAvatar(avatar);
        player.setIntroduction(introduction == null ? null : introduction.trim());
        player.setCoverImage(coverImage);
        player.setAlbumImages(albumImages == null ? null : JSON.toJSONString(albumImages));
        player.setStory(story == null ? null : story.trim());
        player.setVoiceUrl(voiceUrl);
        player.setVoiceDuration("".equals(voiceUrl) ? Integer.valueOf(0) : voiceDuration);
    }
}
