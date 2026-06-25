import fs from "fs";
import path from "path";
import webpush from "web-push";

const keyPath = path.join(process.cwd(), "vapid.json");

export async function getOrGenerateVapidKeys() {
  if (fs.existsSync(keyPath)) {
    try {
      const data = fs.readFileSync(keyPath, "utf-8");
      const keys = JSON.parse(data);
      if (keys.publicKey && keys.privateKey) {
        return keys;
      }
    } catch (err) {
      console.warn("Failed to read VAPID keys file, regenerating...", err);
    }
  }

  // Generate new keys
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(keyPath, JSON.stringify(keys, null, 2), "utf-8");
  return keys;
}
