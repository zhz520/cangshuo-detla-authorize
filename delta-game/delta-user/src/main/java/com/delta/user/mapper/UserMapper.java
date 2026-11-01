package com.delta.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.delta.user.entity.User;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface UserMapper extends BaseMapper<User> {
    @org.apache.ibatis.annotations.Select("SELECT COUNT(*) FROM `user` WHERE phone=#{phone} AND (#{excludeId,jdbcType=BIGINT} IS NULL OR id != #{excludeId,jdbcType=BIGINT})")
    long countReservedPhone(@org.apache.ibatis.annotations.Param("phone") String phone,@org.apache.ibatis.annotations.Param("excludeId") Long excludeId);
    @org.apache.ibatis.annotations.Select("SELECT COUNT(*) FROM player_reward WHERE status='REVERSAL_PENDING' AND (user_id=#{userId} OR player_id=#{playerId,jdbcType=BIGINT})")
    long countPendingRewards(@org.apache.ibatis.annotations.Param("userId") Long userId,@org.apache.ibatis.annotations.Param("playerId") Long playerId);
}
