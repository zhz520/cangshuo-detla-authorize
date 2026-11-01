package com.delta.order.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.delta.order.entity.Review;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.delta.order.dto.ReviewView;

@Mapper
public interface ReviewMapper extends BaseMapper<Review> {
    @Select("<script>SELECT r.id,r.player_id,p.nickname AS player_name,r.rating,r.content,r.images,r.created_at, " +
            "CONCAT(LEFT(COALESCE(NULLIF(u.nickname,''),'用户'),1),'**') AS user_nickname, " +
            "u.avatar AS user_avatar,o.product_name FROM review r " +
            "LEFT JOIN `user` u ON u.id=r.user_id AND u.deleted=0 " +
            "LEFT JOIN player p ON p.id=r.player_id " +
            "LEFT JOIN `order` o ON o.id=r.order_id WHERE r.deleted=0 " +
            "<if test='playerId != null'>AND r.player_id=#{playerId}</if> " +
            "ORDER BY r.created_at DESC,r.id DESC</script>")
    Page<ReviewView> selectViews(Page<ReviewView> page, @Param("playerId") Long playerId);

    @Update("UPDATE product SET avg_rating=(SELECT COALESCE(AVG(rating),0) FROM review WHERE product_id=#{productId} AND deleted=0), " +
            "review_count=(SELECT COUNT(*) FROM review WHERE product_id=#{productId} AND deleted=0) WHERE id=#{productId}")
    int refreshProductRating(@Param("productId") Long productId);
}
