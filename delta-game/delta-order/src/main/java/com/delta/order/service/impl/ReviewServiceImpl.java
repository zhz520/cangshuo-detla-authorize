package com.delta.order.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.delta.order.entity.Review;
import com.delta.order.mapper.ReviewMapper;
import com.delta.order.service.ReviewService;
import org.springframework.stereotype.Service;
import com.delta.common.mapper.CrossModuleMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ReviewServiceImpl extends ServiceImpl<ReviewMapper, Review> implements ReviewService {
    private final CrossModuleMapper crossModuleMapper;

    @Override
    public void refreshRatings(Long productId, Long playerId) {
        if (productId != null) baseMapper.refreshProductRating(productId);
        if (playerId != null) crossModuleMapper.updatePlayerAvgRating(playerId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean deleteAndRefreshRatings(Long id) {
        Review review = getById(id);
        if (review == null || !removeById(id)) return false;
        refreshRatings(review.getProductId(), review.getPlayerId());
        return true;
    }
}
