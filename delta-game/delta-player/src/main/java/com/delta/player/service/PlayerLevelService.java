package com.delta.player.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.delta.player.entity.PlayerLevel;
import com.delta.player.mapper.PlayerLevelMapper;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class PlayerLevelService extends ServiceImpl<PlayerLevelMapper, PlayerLevel> {
    public List<PlayerLevel> ordered(boolean enabledOnly) {
        return list(new LambdaQueryWrapper<PlayerLevel>().eq(enabledOnly, PlayerLevel::getStatus, 1)
                .orderByAsc(PlayerLevel::getSortOrder).orderByAsc(PlayerLevel::getId));
    }
    public String name(Integer id) {
        PlayerLevel level = id == null ? null : getById(id);
        return level == null ? "Lv." + (id == null ? 1 : id) : level.getName();
    }
}
