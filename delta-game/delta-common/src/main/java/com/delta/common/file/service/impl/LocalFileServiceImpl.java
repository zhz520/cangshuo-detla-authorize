package com.delta.common.file.service.impl;

import com.delta.common.file.service.FileService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

@Service
public class LocalFileServiceImpl implements FileService {
    @Value("${file.upload.path:/data/upload}")
    private String uploadPath;
    @Value("${file.upload.url-prefix:/upload/}")
    private String urlPrefix;

    @Override
    public String upload(MultipartFile file) throws Exception {
        if(file==null || file.isEmpty() || file.getSize()>10*1024*1024)
            throw new com.delta.common.exception.BusinessException(400,"上传文件须在10MB以内");
        String original=file.getOriginalFilename()==null?"":file.getOriginalFilename().toLowerCase(java.util.Locale.ROOT);
        String extension=original.contains(".")?original.substring(original.lastIndexOf('.')+1):"";
        boolean image=java.util.Set.of("jpg","jpeg","png","gif").contains(extension);
        boolean audio=java.util.Set.of("mp3","m4a","wav","aac","ogg","webm").contains(extension);
        if(!image && !audio) throw new com.delta.common.exception.BusinessException(400,"仅支持JPG、PNG、GIF图片或受支持的语音文件");
        String datePath = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy/MM/dd"));
        Path dir = Paths.get(uploadPath, datePath);
        Files.createDirectories(dir);

        String originalName = file.getOriginalFilename();
        String ext = image?".png":"."+extension;
        String fileName = UUID.randomUUID().toString().replace("-", "") + ext;

        Path target = dir.resolve(fileName);
        if(image) {
            try(var input=javax.imageio.ImageIO.createImageInputStream(file.getInputStream())) {
                var readers=javax.imageio.ImageIO.getImageReaders(input);
                if(!readers.hasNext()) throw new com.delta.common.exception.BusinessException(400,"图片内容无效");
                var reader=readers.next();
                try {
                    reader.setInput(input,true,true);
                    int width=reader.getWidth(0),height=reader.getHeight(0);
                    if(width<1 || height<1 || (long)width*height>16_000_000L) throw new com.delta.common.exception.BusinessException(400,"图片分辨率过大");
                    java.awt.image.BufferedImage decoded=reader.read(0);
                    decoded = com.delta.common.file.service.ImageEncoding.resize(decoded, 1920, 1920);
                    boolean transparent = com.delta.common.file.service.ImageEncoding.hasTransparency(decoded);
                    fileName = UUID.randomUUID().toString().replace("-", "") + (transparent ? ".png" : ".jpg");
                    target = dir.resolve(fileName);
                    com.delta.common.file.service.ImageEncoding.write(decoded, target, transparent);
                } finally {reader.dispose();}
            }
        } else {
            byte[] bytes;
            try(var input=file.getInputStream()){bytes=input.readNBytes(16);}
            boolean recognized=bytes.length>=4 && (bytes[0]=='I'&&bytes[1]=='D'&&bytes[2]=='3'
                    ||(bytes[0]&255)==255&&((bytes[1]&224)==224)
                    ||bytes.length>=12&&bytes[0]=='R'&&bytes[1]=='I'&&bytes[2]=='F'&&bytes[3]=='F'&&bytes[8]=='W'&&bytes[9]=='A'&&bytes[10]=='V'&&bytes[11]=='E'
                    ||bytes.length>=8&&bytes[4]=='f'&&bytes[5]=='t'&&bytes[6]=='y'&&bytes[7]=='p'
                    ||bytes[0]=='O'&&bytes[1]=='g'&&bytes[2]=='g'&&bytes[3]=='S'
                    ||(bytes[0]&255)==26&&(bytes[1]&255)==69&&(bytes[2]&255)==223&&(bytes[3]&255)==163);
            if(!recognized) throw new com.delta.common.exception.BusinessException(400,"音频内容无效");
            file.transferTo(target.toFile());
        }
        return urlPrefix + datePath + "/" + fileName;
    }
}
