-- Insert default categories
INSERT OR IGNORE INTO categories (id, name, slug, description) VALUES
('cat1', 'Technology', 'technology', 'Tech news and tutorials'),
('cat2', 'Web Development', 'web-development', 'Frontend and backend development'),
('cat3', 'Cloud Computing', 'cloud-computing', 'Cloud platforms and services'),
('cat4', 'Database', 'database', 'Database management systems');

-- Insert default settings
INSERT OR REPLACE INTO settings (key, value) VALUES
('site_title', 'My Blog'),
('site_description', 'A modern blog built with Cloudflare Pages'),
('posts_per_page', '10'),
('allow_comments', 'true'),
('require_comment_approval', 'true'),
('default_theme', 'light'),
('social_facebook', ''),
('social_twitter', ''),
('social_instagram', '');
