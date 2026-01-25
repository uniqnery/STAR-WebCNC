-- Star-WebCNC Database Initialization
-- TimescaleDB Extension

-- Enable TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create schemas
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS logs;

-- Grant permissions
GRANT ALL PRIVILEGES ON SCHEMA app TO starwebcnc;
GRANT ALL PRIVILEGES ON SCHEMA logs TO starwebcnc;

-- Info message
DO $$
BEGIN
    RAISE NOTICE 'Star-WebCNC database initialized successfully';
END $$;
