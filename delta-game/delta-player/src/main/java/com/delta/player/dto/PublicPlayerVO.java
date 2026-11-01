package com.delta.player.dto;

import com.delta.player.entity.Player;
import lombok.Data;
import java.math.BigDecimal;

/** Public directory fields only: never expose identity, phone or wallet data. */
@Data
public class PublicPlayerVO {
    private Long id;
    private String nickname;
    private String avatar;
    private Integer level;
    private String levelName;
    private BigDecimal priceIncreaseRate;
    private String introduction;
    private String coverImage;
    private java.util.List<String> albumImages;
    private String story;
    private String voiceUrl;
    private Integer voiceDuration;
    private Boolean canOrder;
    private String orderUnavailableReason;
    private String skillTags;
    private String gameLevel;
    private String serviceTypes;
    private BigDecimal avgRating;
    private Integer orderCount;
    private BigDecimal completeRate;
    private Integer isOnline;

    public static PublicPlayerVO from(Player player) {
        PublicPlayerVO vo = new PublicPlayerVO();
        vo.setId(player.getId());
        vo.setNickname(player.getNickname());
        vo.setAvatar(player.getAvatar());
        vo.setLevel(player.getLevel() == null ? 1 : player.getLevel());
        vo.setIntroduction(player.getIntroduction());
        vo.setCoverImage(player.getCoverImage());
        try { vo.setAlbumImages(com.alibaba.fastjson2.JSON.parseArray(player.getAlbumImages(),String.class)); }
        catch(Exception ignored) { vo.setAlbumImages(java.util.List.of()); }
        if(vo.getAlbumImages()==null) vo.setAlbumImages(java.util.List.of());
        vo.setStory(player.getStory());
        vo.setVoiceUrl(player.getVoiceUrl());
        vo.setVoiceDuration(player.getVoiceDuration());
        vo.setSkillTags(player.getSkillTags());
        vo.setGameLevel(player.getGameLevel());
        vo.setServiceTypes(player.getServiceTypes());
        vo.setAvgRating(player.getAvgRating());
        vo.setOrderCount(player.getOrderCount());
        vo.setCompleteRate(player.getCompleteRate());
        vo.setIsOnline(player.getIsOnline());
        return vo;
    }
}
