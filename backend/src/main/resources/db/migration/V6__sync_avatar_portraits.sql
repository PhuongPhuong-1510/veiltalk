UPDATE users AS user_profile
SET avatar_url = '/models/avatar-thumbnails/' || avatar_profile.model_id || '.png'
FROM avatar_profiles AS avatar_profile
WHERE avatar_profile.user_id = user_profile.id
  AND (user_profile.avatar_url IS NULL OR BTRIM(user_profile.avatar_url) = '');
