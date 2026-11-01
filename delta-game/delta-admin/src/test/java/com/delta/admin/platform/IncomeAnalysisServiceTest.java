package com.delta.admin.platform;

import com.delta.common.exception.BusinessException;
import com.delta.common.mapper.StatsMapper;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class IncomeAnalysisServiceTest {
    @Test void deniesUnlicensedRequestsBeforeReadingBusinessData() {
        var platform = mock(PlatformService.class); var stats = mock(StatsMapper.class);
        doThrow(new BusinessException(403,"Not licensed")).when(platform).requireFeature("advanced_income_reports");
        assertThatThrownBy(() -> new IncomeAnalysisService(platform,stats).compare(LocalDate.now(),LocalDate.now())).isInstanceOf(BusinessException.class);
        verifyNoInteractions(stats);
    }
    @Test void comparesEqualPeriodsFillsMissingDaysAndNeverInventsPercentFromZero() {
        var platform = mock(PlatformService.class); var stats = mock(StatsMapper.class);
        var start = LocalDate.of(2026,10,1); var end = start.plusDays(1);
        when(stats.incomeDailyStatsByRange(start.atStartOfDay(),end.plusDays(1).atStartOfDay())).thenReturn(List.of(Map.of("statDate",start.toString(),"orderCount",2,"orderAmount",new BigDecimal("100.10"),"playerIncome",new BigDecimal("80.08"),"commissionIncome",new BigDecimal("20.02"))));
        when(stats.incomeDailyStatsByRange(start.minusDays(2).atStartOfDay(),start.atStartOfDay())).thenReturn(List.of());
        var report = new IncomeAnalysisService(platform,stats).compare(start,end);
        assertThat(report.current().summary().averageOrderAmount()).isEqualByComparingTo("50.05");
        assertThat(report.current().days()).hasSize(2); assertThat(report.current().days().get(1).orderCount()).isZero();
        assertThat(report.previous().startDate()).isEqualTo(start.minusDays(2)); assertThat(report.previous().endDate()).isEqualTo(start.minusDays(1));
        assertThat(report.changePercent().get("commissionIncome")).isNull();
    }
    @Test void rejectsReversedFutureAndExcessiveRangesWithoutQueries() {
        var stats = mock(StatsMapper.class); var service = new IncomeAnalysisService(mock(PlatformService.class),stats);
        assertThatThrownBy(() -> service.compare(LocalDate.now(),LocalDate.now().minusDays(1))).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> service.compare(LocalDate.now(),LocalDate.now().plusDays(1))).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> service.compare(LocalDate.now().minusDays(366),LocalDate.now())).isInstanceOf(BusinessException.class);
        verifyNoInteractions(stats);
    }
}
