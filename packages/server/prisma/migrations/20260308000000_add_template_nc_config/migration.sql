-- Migration: add_template_nc_config
-- Adds topBarInterlock, offsetConfig, counterConfig, toolLifeConfig,
-- schedulerConfig, panelLayout columns to templates table
-- Also adds deprecated interlock columns for backward compatibility

ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "top_bar_interlock"        JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "offset_config"            JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "counter_config"           JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "tool_life_config"         JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "scheduler_config"         JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "panel_layout"             JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "interlock_config"         JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "interlock_modules"        JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "remote_control_interlock" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "virtual_panel"            JSONB NOT NULL DEFAULT '{}';
