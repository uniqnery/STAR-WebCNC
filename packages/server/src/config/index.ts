// Star-WebCNC Server Configuration

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://starwebcnc:starwebcnc123@localhost:5432/starwebcnc',

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // MQTT
  mqttBrokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',

  // JWT
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  // CORS
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  // Cookie
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    refreshTokenName: 'refresh_token',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  },
};

export default config;
