package com.delta.common.file.service;

import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.IIOImage;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Path;

public final class ImageEncoding {
    private ImageEncoding() {}

    public static BufferedImage resize(BufferedImage source, int maxWidth, int maxHeight) {
        double scale = Math.min(1d, Math.min((double) maxWidth / source.getWidth(), (double) maxHeight / source.getHeight()));
        if (scale >= 1d) return source;
        BufferedImage result = new BufferedImage(Math.max(1, (int) Math.round(source.getWidth() * scale)),
                Math.max(1, (int) Math.round(source.getHeight() * scale)),
                source.getColorModel().hasAlpha() ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        var graphics = result.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            graphics.drawImage(source, 0, 0, result.getWidth(), result.getHeight(), null);
        } finally { graphics.dispose(); }
        return result;
    }

    public static boolean hasTransparency(BufferedImage image) {
        if (!image.getColorModel().hasAlpha()) return false;
        for (int y = 0; y < image.getHeight(); y++)
            for (int x = 0; x < image.getWidth(); x++)
                if ((image.getRGB(x, y) >>> 24) != 255) return true;
        return false;
    }

    public static void write(BufferedImage image, Path target, boolean transparent) throws IOException {
        if (transparent) {
            if (!ImageIO.write(image, "png", target.toFile())) throw new IOException("Image encoding failed");
            return;
        }
        BufferedImage rgb = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_RGB);
        var graphics = rgb.createGraphics();
        try { graphics.drawImage(image, 0, 0, null); } finally { graphics.dispose(); }
        var writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        try (var output = ImageIO.createImageOutputStream(target.toFile())) {
            writer.setOutput(output);
            var params = writer.getDefaultWriteParam();
            params.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            params.setCompressionQuality(0.85f);
            writer.write(null, new IIOImage(rgb, null, null), params);
        } finally { writer.dispose(); }
    }
}
