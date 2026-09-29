import "./ui/styles.css";
import { getLang, t } from "./i18n";
import { App } from "./ui/app";

document.documentElement.lang = getLang();
document.title = t("app.title");

const app = new App();
void app.start();
