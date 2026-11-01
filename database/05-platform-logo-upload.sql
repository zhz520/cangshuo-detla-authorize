-- Platform logo is an image field so the admin UI renders ImageUpload.
SET NAMES utf8mb4;

UPDATE sys_config
SET value_type = 'image'
WHERE config_key = 'site_logo'
  AND (value_type IS NULL OR value_type <> 'image');
