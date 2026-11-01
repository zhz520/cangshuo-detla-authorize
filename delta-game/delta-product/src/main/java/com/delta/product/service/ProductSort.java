package com.delta.product.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.delta.product.entity.Product;

/** Only known fields and directions reach SQL; ID breaks ties for stable pagination. */
public final class ProductSort {
    private ProductSort() {}

    public static void apply(LambdaQueryWrapper<Product> query, String field, String direction) {
        switch (field == null ? "sort" : field) {
            case "sales" -> query.orderByDesc(Product::getSalesCount);
            case "newest" -> query.orderByDesc(Product::getCreatedAt);
            case "price", "price_asc", "price_desc" -> query.orderBy(true,
                    !"price_desc".equals(field) && ("price_asc".equals(field) || !"desc".equalsIgnoreCase(direction)), Product::getPrice);
            default -> query.orderByAsc(Product::getSortOrder);
        }
        query.orderByDesc(Product::getId);
    }
}
