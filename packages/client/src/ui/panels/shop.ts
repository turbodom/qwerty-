import type { ShopItem } from "@korony/shared";
import { isPiBrowser, purchase } from "../../pi";
import { t } from "../../i18n";
import { shopItemDesc, shopItemName } from "../../i18n/catalog";
import type { I18nKey } from "../../i18n";
import { h } from "../dom";
import type { AppApi, PanelSpec } from "./types";

let buying: string | null = null;

function priceText(n: number): string {
  return t("shop.price", { price: String(n) });
}

/** Shop: SHOP_ITEMS with Pi prices. Buying goes through Pi payments (only inside Pi Browser). */
export function shopPanel(app: AppApi): PanelSpec {
  app.loadShop();
  const { items, fromServer } = app.shopCatalog();
  const user = app.user();
  const inPi = isPiBrowser();
  const body = h("div", { class: "stack" });
  if (!inPi) body.append(h("p", { class: "fx", testid: "shop-only-pi" }, t("shop.onlyPi")));
  else if (!user) body.append(h("p", { class: "fx" }, t("shop.needLogin")));
  if (!fromServer) body.append(h("p", { class: "fx" }, t("shop.offline")));

  const buy = async (item: ShopItem): Promise<void> => {
    if (buying) return;
    buying = item.id;
    app.rerender();
    const res = await purchase(item.id);
    buying = null;
    if (res.status === "completed") {
      app.toast(t("shop.success", { name: shopItemName(item) }));
      await app.refreshUser().catch(() => undefined);
    } else if (res.status === "cancelled") {
      app.toast(t("shop.cancelled"));
    } else {
      app.toast(t("shop.failed", { message: res.message }), "error");
    }
    app.rerender();
  };

  for (const item of items) {
    const owned = !!user?.owned.includes(item.id) && item.kind !== "premium";
    const canBuy = inPi && !!user && !owned && buying === null;
    body.append(
      h(
        "div",
        { class: "item-row", testid: `shop-${item.id}` },
        h(
          "div",
          { class: "grow" },
          h("div", { class: "inline" }, h("b", null, shopItemName(item)), h("span", { class: "badge ghost" }, t(`shop.kind.${item.kind}` as I18nKey))),
          h("div", { class: "fx" }, shopItemDesc(item)),
        ),
        owned
          ? h("span", { class: "badge" }, t("shop.owned"))
          : h(
              "button",
              { class: "btn small", disabled: !canBuy, onClick: () => void buy(item) },
              buying === item.id ? t("shop.processing") : priceText(item.pricePi),
            ),
      ),
    );
  }
  body.append(h("p", { class: "fx" }, t("shop.loadoutNote")));
  return { id: "shop", title: t("shop.title"), body };
}
