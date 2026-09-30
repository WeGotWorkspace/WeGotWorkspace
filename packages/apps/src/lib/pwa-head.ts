type PwaHeadConfig = {
  title: string;
  description: string;
  themeColor: string;
  appTitle: string;
  manifest: string;
  /**
   * 180×180 PNG for `<link rel="apple-touch-icon">`.
   * WebKit uses that link when it is in the document head, and only then falls
   * back to manifest icons. This shell injects the link from the router, so a
   * client that reads the raw HTML still depends on the manifest PNGs.
   */
  appleTouchIcon: string;
  /** Vector favicon for browser tabs. Not a manifest icon — those are PNGs. */
  iconSvg: string;
};

export function createPwaHead(config: PwaHeadConfig) {
  return {
    meta: [
      { title: config.title },
      { name: "description", content: config.description },
      { name: "theme-color", content: config.themeColor },
      { name: "apple-mobile-web-app-title", content: config.appTitle },
    ],
    links: [
      { rel: "manifest", href: config.manifest },
      { rel: "apple-touch-icon", sizes: "180x180", href: config.appleTouchIcon },
      { rel: "icon", type: "image/svg+xml", href: config.iconSvg },
    ],
  };
}
