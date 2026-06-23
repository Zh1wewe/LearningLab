import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.learninglab.app',
  appName: 'LearningLab',
  webDir: 'dist',
  server: {
    url: 'http://localhost:8000',
    cleartext: true,
  },
};

export default config;