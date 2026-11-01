package com.delta.common.file.controller;

import com.delta.common.domain.R;
import com.delta.common.file.service.FileService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.security.access.prepost.PreAuthorize;
import com.delta.common.exception.BusinessException;
import java.util.Locale;
import java.util.Set;

@RestController
@RequestMapping("/common/file")
@RequiredArgsConstructor
public class FileController {
    private final FileService fileService;
    private final com.delta.common.security.service.RateLimitService limits;

    @PostMapping("/upload")
    public R<String> upload(@RequestParam("file") MultipartFile file) throws Exception {
        limits.check("upload:"+com.delta.common.security.utils.SecurityUtils.getUserType()+":"+com.delta.common.security.utils.SecurityUtils.getUserId(),30,60);
        String url = fileService.upload(file);
        return R.ok(url);
    }

    @PostMapping("/profile-audio")
    @PreAuthorize("hasAnyRole('ADMIN','PLAYER')")
    public R<String> profileAudio(@RequestParam("file") MultipartFile file) throws Exception {
        limits.check("upload:"+com.delta.common.security.utils.SecurityUtils.getUserType()+":"+com.delta.common.security.utils.SecurityUtils.getUserId(),30,60);
        String name=file.getOriginalFilename()==null?"":file.getOriginalFilename().toLowerCase(Locale.ROOT);
        String ext=name.substring(name.lastIndexOf('.')+1);
        if(file.isEmpty()||file.getSize()>10*1024*1024) throw new BusinessException(400,"语音文件大小须在10MB以内");
        if(!Set.of("mp3","m4a","wav","aac","ogg","webm").contains(ext)) throw new BusinessException(400,"请上传mp3、m4a、wav、aac、ogg或webm音频");
        byte[] bytes;
        try(var input=file.getInputStream()) { bytes=input.readNBytes(16); }
        boolean audio=bytes.length>=4 && (
            bytes[0]=='I'&&bytes[1]=='D'&&bytes[2]=='3' ||
            (bytes[0]&255)==255&&((bytes[1]&224)==224) ||
            bytes[0]=='R'&&bytes[1]=='I'&&bytes[2]=='F'&&bytes[3]=='F'&&bytes.length>=12&&bytes[8]=='W'&&bytes[9]=='A'&&bytes[10]=='V'&&bytes[11]=='E' ||
            bytes.length>=8&&bytes[4]=='f'&&bytes[5]=='t'&&bytes[6]=='y'&&bytes[7]=='p' ||
            bytes[0]=='O'&&bytes[1]=='g'&&bytes[2]=='g'&&bytes[3]=='S' ||
            (bytes[0]&255)==26&&(bytes[1]&255)==69&&(bytes[2]&255)==223&&(bytes[3]&255)==163);
        if(!audio) throw new BusinessException(400,"无法识别该音频文件");
        return R.ok(fileService.upload(file));
    }
}
