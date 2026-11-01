package com.delta.player.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.delta.common.exception.BusinessException;
import com.delta.common.mapper.CrossModuleMapper;
import com.delta.player.dto.PublicPlayerVO;
import com.delta.player.entity.Player;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class PlayerDirectoryService {
    private final PlayerService players;
    private final PlayerLevelService levels;
    private final CrossModuleMapper crossModuleMapper;

    public LambdaQueryWrapper<Player> visibleQuery() {
        return new LambdaQueryWrapper<Player>().eq(Player::getStatus,"ACTIVE")
                .inSql(Player::getLevel,"SELECT id FROM player_level WHERE status=1 AND deleted=0");
    }
    public Player requireVisible(Long id) {
        Player player=players.getOne(visibleQuery().eq(Player::getId,id));
        if(player==null) throw new BusinessException(404,"打手不存在或暂未开放展示");
        return player;
    }
    public PublicPlayerVO view(Player player) {
        PublicPlayerVO vo=PublicPlayerVO.from(player);
        vo.setLevelName(levels.name(player.getLevel()));
        var level=levels.getById(player.getLevel());
        java.math.BigDecimal rate=player.getPriceIncreaseRate();
        vo.setPriceIncreaseRate(rate!=null&&rate.signum()>=0?rate:
                level!=null&&level.getPriceIncreaseRate()!=null?level.getPriceIncreaseRate():java.math.BigDecimal.ZERO);
        return vo;
    }
    public PublicPlayerVO detail(Long id) {
        Player player=requireVisible(id);
        PublicPlayerVO vo=view(player);
        int max=1;
        try { max=Math.max(1,Integer.parseInt(crossModuleMapper.selectConfigValue("order.max_active_per_player"))); } catch(Exception ignored) {}
        boolean online=Integer.valueOf(1).equals(player.getIsOnline());
        boolean full=crossModuleMapper.selectPlayerActiveOrders(id)>=max;
        vo.setCanOrder(online&&!full);
        vo.setOrderUnavailableReason(!online?"打手暂未上线接单":full?"打手当前订单已满，请稍后再来":"");
        return vo;
    }
}
