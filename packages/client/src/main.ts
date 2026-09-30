import "./ui/styles.css";
import { getLang, t } from "./i18n";
import { bridge } from "./game/bridge";
import { App } from "./ui/app";
import { hideSplash, initSplash } from "./ui/splash";

document.documentElement.lang = getLang();
document.title = t("app.title");

initSplash();
const app = new App();
void app.start();
// the splash stays until the art is baked, but never longer than a few seconds on a slow network
void bridge.booted.then(hideSplash);
setTimeout(hideSplash, 12000);
