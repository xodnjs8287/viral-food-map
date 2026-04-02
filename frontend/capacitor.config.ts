import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.yozmeat.app",
  appName: "요즘뭐먹",
  webDir: "out",
  server: {
    url: "https://www.yozmeat.com",
    cleartext: false,
  },
  ios: {
    backgroundColor: "#FAFAFA",
    contentInset: "never",
    preferredContentMode: "mobile",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
