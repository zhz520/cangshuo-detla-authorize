package com.delta.admin.platform;

import com.delta.common.annotation.OpLog;
import com.delta.common.domain.R;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/admin/platform")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class PlatformController {
    private final PlatformService platform;
    private final IncomeAnalysisService analysis;
    public record EnableRequest(@NotNull Boolean enabled) {}

    @GetMapping("/overview") public R<PlatformService.Overview> overview() { return R.ok(platform.overview()); }
    @GetMapping("/features") public R<List<PlatformService.FeatureView>> features() { return R.ok(platform.features()); }
    @GetMapping("/updates") public R<PlatformService.UpdateInfo> updates() { return R.ok(platform.updates()); }

    // License payloads are deliberately excluded from the generic request-body operation logger.
    @PostMapping("/license/import")
    public R<PlatformService.Overview> importLicense(@Valid @RequestBody PlatformLicense.Envelope body) {
        return R.ok(platform.importLicense(body));
    }
    @PutMapping("/features/{id}/enabled")
    @OpLog(module="platform", operation="调整扩展功能启用状态")
    public R<List<PlatformService.FeatureView>> enabled(@PathVariable String id, @Valid @RequestBody EnableRequest body) {
        return R.ok(platform.setEnabled(id, body.enabled()));
    }
    @GetMapping("/reports/income")
    public R<IncomeAnalysisService.Comparison> income(
            @RequestParam @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate endDate) {
        return R.ok(analysis.compare(startDate, endDate));
    }
}
