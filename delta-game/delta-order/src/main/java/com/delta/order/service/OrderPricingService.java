package com.delta.order.service;

import com.delta.common.domain.PlayerPriceConfig;
import com.delta.common.exception.BusinessException;
import com.delta.common.mapper.CrossModuleMapper;
import com.delta.common.utils.Money;
import com.delta.order.dto.OrderQuote;
import com.delta.product.entity.Product;
import com.delta.product.service.ProductService;
import com.delta.system.service.SysConfigService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;

@Service
@RequiredArgsConstructor
public class OrderPricingService {
    private final ProductService products;
    private final CrossModuleMapper crossModuleMapper;
    private final SysConfigService configs;

    public OrderQuote quote(Long productId,Long playerId,Integer levelId) {
        if(productId==null || productId<=0 || playerId!=null&&playerId<=0 || levelId!=null&&levelId<=0)
            throw new BusinessException(400,"请选择有效的商品和打手");
        if(playerId!=null && levelId!=null) throw new BusinessException(400,"指定打手和指定等级不能同时选择");
        Product product=products.getById(productId);
        if(product==null) throw new BusinessException(404,"商品不存在");
        if(!Integer.valueOf(1).equals(product.getStatus())) throw new BusinessException(400,"商品已下架");
        BigDecimal base=Money.positive(product.getPrice()).setScale(2,RoundingMode.UNNECESSARY);
        PlayerPriceConfig config=null;
        if(playerId!=null) {
            config=crossModuleMapper.selectOrderablePlayerPrice(playerId);
            if(config==null) throw new BusinessException(400,"指定打手暂不可接单，请重新选择");
            int max=Integer.parseInt(configs.getConfigValue("order.max_active_per_player","5"));
            if(crossModuleMapper.selectPlayerActiveOrders(playerId)>=max)
                throw new BusinessException(400,"指定打手当前订单已满，请重新选择");
        } else if(levelId!=null) {
            config=crossModuleMapper.selectEnabledLevelPrice(levelId);
            if(config==null) throw new BusinessException(400,"打手等级已停用，请重新选择");
        }
        BigDecimal rate=config==null?BigDecimal.ZERO:config.getPriceIncreaseRate();
        if(rate==null || rate.signum()<0 || rate.compareTo(new BigDecimal("100"))>0 || rate.stripTrailingZeros().scale()>2)
            throw new BusinessException(400,"打手涨价设置异常，请联系客服");
        BigDecimal extra=base.multiply(rate).movePointLeft(2).setScale(2,RoundingMode.HALF_UP);
        OrderQuote quote=new OrderQuote();
        quote.setProductId(productId);quote.setProductName(product.getName());
        quote.setDesignatedPlayerId(playerId);quote.setPlayerLevelId(levelId);
        quote.setPlayerLevelName(config==null?null:config.getLevelName());
        quote.setBaseAmount(base);quote.setPriceIncreaseRate(rate);quote.setPriceIncreaseAmount(extra);
        quote.setAmount(Money.positive(base.add(extra)));
        return quote;
    }
}
