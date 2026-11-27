// Public connection settings only. Build variables can override this deployment.
window.STRATUS_CONFIG = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  ? { apiUrl: '/api', region: 'us-east-1', local: true }
  : {
      apiUrl: 'https://dhajsrfama.execute-api.ap-southeast-2.amazonaws.com/prod',
      region: 'ap-southeast-2',
      clientId: '6j8l1n8onu8cb366miesb73tag',
      cognitoDomain: 'https://stratus-automl-866160682379.auth.ap-southeast-2.amazoncognito.com',
      inferenceMode: 'ec2',
      local: false
    };
