package com.delta.admin.platform;

import com.delta.common.exception.BusinessException;
import com.delta.common.mapper.StatsMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
@RequiredArgsConstructor
public class IncomeAnalysisService {
    private final PlatformService platform;
    private final StatsMapper statistics;
    public record Daily(LocalDate date, long orderCount, BigDecimal orderAmount,
                        BigDecimal playerIncome, BigDecimal commissionIncome) {}
    public record Totals(long orderCount, BigDecimal orderAmount, BigDecimal playerIncome,
                         BigDecimal commissionIncome, BigDecimal averageOrderAmount) {}
    public record Period(LocalDate startDate, LocalDate endDate, Totals summary, List<Daily> days) {}
    public record Comparison(Period current, Period previous, Map<String, BigDecimal> changePercent, String basis) {}

    public Comparison compare(LocalDate startDate, LocalDate endDate) {
        platform.requireFeature("advanced_income_reports");
        if (startDate == null || endDate == null || startDate.isBefore(LocalDate.of(2000, 1, 1))
                || endDate.isAfter(LocalDate.now()) || startDate.isAfter(endDate))
            throw new BusinessException(400, "请选择从 2000 年起至今天的有效日期范围");
        long days = ChronoUnit.DAYS.between(startDate, endDate) + 1;
        if (days > 366) throw new BusinessException(400, "一次最多查询 366 天");
        var current = period(startDate, endDate);
        var previous = period(startDate.minusDays(days), startDate.minusDays(1));
        Map<String, BigDecimal> change = new LinkedHashMap<>();
        change.put("orderCount", percent(BigDecimal.valueOf(current.summary().orderCount()), BigDecimal.valueOf(previous.summary().orderCount())));
        change.put("orderAmount", percent(current.summary().orderAmount(), previous.summary().orderAmount()));
        change.put("playerIncome", percent(current.summary().playerIncome(), previous.summary().playerIncome()));
        change.put("commissionIncome", percent(current.summary().commissionIncome(), previous.summary().commissionIncome()));
        change.put("averageOrderAmount", percent(current.summary().averageOrderAmount(), previous.summary().averageOrderAmount()));
        return new Comparison(current, previous, change, "按已确认或已评价订单的结算日期统计；上一周期为紧邻的等长周期。上期为零时变化率不计算。");
    }

    private Period period(LocalDate start, LocalDate end) {
        var raw = statistics.incomeDailyStatsByRange(start.atStartOfDay(), end.plusDays(1).atStartOfDay());
        Map<LocalDate, Map<String, Object>> byDate = new HashMap<>();
        for (var row : raw) byDate.put(LocalDate.parse(String.valueOf(value(row, "statDate"))), row);
        List<Daily> daily = new ArrayList<>();
        long count = 0;
        BigDecimal amount = BigDecimal.ZERO, player = BigDecimal.ZERO, commission = BigDecimal.ZERO;
        for (LocalDate date = start; !date.isAfter(end); date = date.plusDays(1)) {
            var row = byDate.getOrDefault(date, Map.of());
            long dayCount = number(value(row, "orderCount")).longValueExact();
            BigDecimal dayAmount = number(value(row, "orderAmount"));
            BigDecimal dayPlayer = number(value(row, "playerIncome"));
            BigDecimal dayCommission = number(value(row, "commissionIncome"));
            daily.add(new Daily(date, dayCount, dayAmount, dayPlayer, dayCommission));
            count += dayCount; amount = amount.add(dayAmount); player = player.add(dayPlayer); commission = commission.add(dayCommission);
        }
        return new Period(start, end, new Totals(count, amount, player, commission,
                count == 0 ? BigDecimal.ZERO : amount.divide(BigDecimal.valueOf(count), 2, RoundingMode.HALF_UP)), daily);
    }

    private Object value(Map<String, Object> row, String name) {
        return row.entrySet().stream().filter(entry -> entry.getKey().equalsIgnoreCase(name)).map(Map.Entry::getValue).findFirst().orElse(null);
    }
    private BigDecimal number(Object value) { return value == null ? BigDecimal.ZERO : new BigDecimal(String.valueOf(value)); }
    private BigDecimal percent(BigDecimal current, BigDecimal previous) {
        return previous.signum() == 0 ? null : current.subtract(previous).multiply(BigDecimal.valueOf(100)).divide(previous.abs(), 2, RoundingMode.HALF_UP);
    }
}
