// Local development only. Cloud builds replace this file with public AWS settings.
window.STRATUS_CONFIG = {
  apiUrl: '/api',
  region: 'us-east-1',
  local: ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
};
