CREATE TABLE IF NOT EXISTS visits (
  site_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  path TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (site_id, event_id)
);
CREATE INDEX IF NOT EXISTS visits_daily ON visits(site_id,day,visitor);
CREATE INDEX IF NOT EXISTS visits_retention ON visits(day);
CREATE TABLE IF NOT EXISTS site_state (
  site_id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS visit_metadata (
  site_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  day TEXT NOT NULL,
  device TEXT NOT NULL,
  browser TEXT NOT NULL,
  referrer TEXT NOT NULL,
  PRIMARY KEY (site_id,event_id)
);
CREATE INDEX IF NOT EXISTS metadata_daily ON visit_metadata(site_id,day);
CREATE TABLE IF NOT EXISTS product_events (
  site_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (site_id,event_id)
);
CREATE INDEX IF NOT EXISTS events_daily ON product_events(site_id,day,name,visitor);
CREATE TABLE IF NOT EXISTS admin_settings (
  site_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS page_engagement (
  site_id TEXT NOT NULL,
  visit_id TEXT NOT NULL,
  path TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  active_ms INTEGER NOT NULL,
  state TEXT NOT NULL,
  flags INTEGER NOT NULL,
  device TEXT NOT NULL,
  referrer TEXT NOT NULL,
  PRIMARY KEY (site_id,visit_id)
);
CREATE INDEX IF NOT EXISTS engagement_updated ON page_engagement(site_id,updated_at);
