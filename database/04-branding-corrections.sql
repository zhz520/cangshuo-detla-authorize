-- Preserve any client-edited values; correct only the source scaffold defaults.
SET NAMES utf8mb4;

UPDATE sys_config
SET config_value = '斜阳电竞提供技术支持'
WHERE config_key = 'site.tech_support_text'
  AND config_value = 'KK云网络提供技术支持';

UPDATE sys_config
SET config_value = '斜阳电竞服务'
WHERE config_key = 'wx.pay.h5-app-name'
  AND config_value = '三角洲服务';

DELETE FROM sys_config
WHERE config_key = 'wx.pay.h5-app-name'
  AND (config_value IS NULL OR TRIM(config_value) = '');

INSERT INTO sys_config (config_key,config_name,config_value,value_type,config_group)
VALUES ('wx.pay.h5-app-name','H5 应用名称','斜阳电竞服务','text','微信支付配置')
ON DUPLICATE KEY UPDATE config_key=VALUES(config_key);
